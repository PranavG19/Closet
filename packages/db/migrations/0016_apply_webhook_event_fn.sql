-- UP Migration
-- apply_webhook_event(): the RevenueCat dedup-and-apply as ONE plpgsql function, so
-- the replay-dedup ledger row and the entitlement write COMMIT OR FAIL TOGETHER.
--
-- THE BUG THIS CLOSES (a silent money-loss poison pill, Audit-R2 blocker B):
-- The executor runs each query() in its OWN transaction (CLAUDE.md "one tx per
-- query()"). The webhook therefore used to do:
--     tx1:  INSERT INTO webhook_events ... ON CONFLICT DO NOTHING   -- COMMITTED
--     tx2:  INSERT INTO subscriptions ... ON CONFLICT DO UPDATE     -- may FAIL
-- Once tx1 commits, the event id is DURABLY recorded as "seen". If tx2 then fails for
-- any reason — a transient connection drop, a 42501 from a misconfigured service_role
-- pool, a statement timeout — the entitlement never flips, and RevenueCat's retry of
-- the same event id now hits the committed ledger row, is classified a REPLAY, and is
-- discarded with a 200. The retry that should have healed the account is the very
-- thing that throws the event away. A real paying customer is locked out of the
-- feature she paid for, permanently, with NO error surfaced anywhere: the handler
-- returned 200 both times. Nothing in the system ever revisits it (RevenueCat gives
-- up after its retry window, and there is no reconciliation job).
--
-- WHY A FUNCTION AND NOT TWO STATEMENTS (same reasoning as 0012, different failure):
-- The two writes must share a FATE, and the executor gives one transaction per
-- query() call — so the only way to bind them is to put both inside a single call.
-- A plpgsql function body runs inside the CALLER'S transaction, so an exception
-- anywhere in it (or a failure of the surrounding COMMIT) rolls back BOTH the ledger
-- row and the entitlement write. The event then remains NOT-yet-consumed and the next
-- RevenueCat delivery of that id re-applies it cleanly. That is the invariant:
--   * a FAILED apply leaves the event unconsumed  ⇒ a retry still succeeds;
--   * a genuine DUPLICATE delivery still applies exactly once.
--
-- HOW EXACTLY-ONCE SURVIVES CONCURRENT DUPLICATE DELIVERIES (no extra lock needed):
-- webhook_events.event_id is the PRIMARY KEY, and the INSERT ... ON CONFLICT DO
-- NOTHING below is the mutual exclusion. Two simultaneous deliveries of the same id:
-- the first inserts (still uncommitted); the second BLOCKS on the unique index rather
-- than proceeding, because ON CONFLICT must know the outcome of the in-doubt row.
-- When the first commits, the second sees the conflict, returns zero rows, and reports
-- 'duplicate' WITHOUT touching entitlement. If instead the first ROLLS BACK, the
-- second's insert succeeds and it applies — which is precisely the retry semantics we
-- want. So the unique index alone serializes the pair; no advisory lock is required
-- (unlike 0012, whose hazard was a count-then-insert reading a stale snapshot — there
-- is no read-then-decide here, the conflict IS the decision).
--
-- SECURITY INVOKER (the DEFAULT — deliberately NOT definer): the sole caller is the
-- revenuecat-webhook running under the RLS-exempt service_role, which already holds
-- every privilege this body needs, so there is NOTHING to escalate and a definer fn
-- would only add an escalation surface. Running as the invoker also means the money
-- guarantee stays STRUCTURAL rather than resting on this function's discretion: if
-- app_user ever reached this fn, it has no INSERT/UPDATE grant on subscriptions and no
-- grant at all on webhook_events (0008/0009), so the body fails LOUD with 42501 — it
-- cannot mint itself entitlement. EXECUTE is additionally revoked from PUBLIC below so
-- app_user cannot even call it. search_path is pinned = '' with every reference fully
-- schema-qualified (defense in depth, matching 0011/0012/0014).
--
-- Returns the outcome the handler maps to its response, so the handler needs no second
-- query to find out what happened:
--   'applied'   — ledger row inserted AND entitlement written (both in this tx).
--   'duplicate' — the event id was already consumed by a COMMITTED prior delivery;
--                 entitlement untouched (the replay no-op).
--   'stale'     — consumed now, but the monotonic guard rejected an older event_ts, so
--                 the NEWER entitlement stands. A success, not a failure: the event was
--                 genuinely processed (its decision was "change nothing"), so keeping
--                 the ledger row is correct and a retry would decide the same.

CREATE OR REPLACE FUNCTION public.apply_webhook_event(
  p_event_id           text,
  p_user_id            uuid,
  p_rc_app_user_id     text,
  p_entitlement_active boolean,
  p_event_ts           timestamptz,
  p_expires_at         timestamptz
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $fn$
DECLARE
  v_event_id text;
  v_user_id  uuid;
BEGIN
  -- (1) Claim the event id. Zero rows back ⇒ a COMMITTED prior delivery already
  -- consumed it ⇒ replay: return WITHOUT touching the money table.
  INSERT INTO public.webhook_events (event_id)
  VALUES (p_event_id)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  -- (2) The entitlement write, in the SAME transaction as (1). The WHERE on DO UPDATE
  -- is the monotonic ordering guard: a late-arriving OLDER event must not revoke a
  -- newer entitlement. If it bites, zero rows come back and we report 'stale'.
  -- Should this statement RAISE, the whole function — including the ledger row from
  -- (1) — rolls back, leaving the event unconsumed for RevenueCat's retry.
  INSERT INTO public.subscriptions
    (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at, updated_at)
  VALUES (p_user_id, p_rc_app_user_id, p_entitlement_active, p_event_ts, p_expires_at, now())
  ON CONFLICT (user_id) DO UPDATE SET
    rc_app_user_id     = excluded.rc_app_user_id,
    entitlement_active = excluded.entitlement_active,
    event_ts           = excluded.event_ts,
    expires_at         = excluded.expires_at,
    updated_at         = now()
  WHERE public.subscriptions.event_ts IS NULL
     OR excluded.event_ts >= public.subscriptions.event_ts
  RETURNING user_id INTO v_user_id;

  IF v_user_id IS NULL THEN
    RETURN 'stale';
  END IF;

  RETURN 'applied';
END;
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default. Revoke it: the ONLY caller is the
-- service_role webhook. app_user must not be able to invoke the money path at all
-- (its missing table grants already make the body fail, but do not offer the call).
REVOKE ALL ON FUNCTION public.apply_webhook_event(text, uuid, text, boolean, timestamptz, timestamptz) FROM PUBLIC;

-- Grant to service_role where that role exists (hosted Supabase). On a bare test
-- container there is no service_role — the container superuser is its RLS-exempt
-- analog and needs no grant — so this is conditional rather than unconditional, the
-- same dual-target shape 0013 uses for `authenticated`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_webhook_event(text, uuid, text, boolean, timestamptz, timestamptz) TO service_role;
  END IF;
END $$;

-- DOWN Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE EXECUTE ON FUNCTION public.apply_webhook_event(text, uuid, text, boolean, timestamptz, timestamptz) FROM service_role;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.apply_webhook_event(text, uuid, text, boolean, timestamptz, timestamptz);
