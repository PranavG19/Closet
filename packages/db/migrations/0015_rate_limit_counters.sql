-- UP Migration
-- rate_limit_counters + consume_rate_token: the per-user PROVIDER-SPEND throttle
-- (LAUNCH-READINESS §6.3, docs/06 §8). TEASER_JOB_CAP caps LIFETIME teaser jobs but
-- NOTHING throttles kind='full' request RATE, so one authenticated account (or one
-- leaked token) can hammer the PAID OpenAI + Photoroom providers as fast as the
-- network allows. This is the DB half: a per-(user, scope) counter and an atomic
-- check-and-increment that answers "is this call admitted".
--
-- ALGORITHM: FIXED WINDOW. One row per (user_id, scope) holding the current
-- window's start and the count of calls consumed in it. A call whose row's
-- window_start is older than p_window resets the window to now() with count 1;
-- otherwise it increments. Admitted iff the POST-increment count <= p_limit.
--
-- Honest about what a fixed window is NOT: it is not a token bucket and does not
-- smooth traffic. Its known weakness is the BOUNDARY BURST — a caller can spend
-- p_limit at the very end of window k and another p_limit at the start of window
-- k+1, i.e. up to 2*p_limit in a span of one window. For a SPEND CEILING that is
-- acceptable (worst case is 2x the intended rate, still bounded and still ~O(limit)
-- per window on average, versus today's unbounded), and it costs one row and one
-- statement instead of a bucket's refill arithmetic. If smoothing is ever needed,
-- a later migration can swap the body for a leaky bucket without touching callers.
--
-- Second honest property: a REFUSED call still increments the counter. That means a
-- caller who keeps hammering after being refused keeps the count above the limit for
-- the remainder of the window (a self-inflicted penalty, not an extension of the
-- window — window_start never moves on the increment path, so the window still
-- expires on schedule). Counting refusals is what makes the RETURNING value a unique
-- strictly-increasing ticket per window, which is what makes the race provable.
--
-- WHY IT IS RACE-FREE UNDER READ COMMITTED (the whole point; migration 0012 exists
-- because the CTE version of this mistake BLEW the teaser cap — 12 admitted against
-- a cap of 3). Check-and-increment is ONE `INSERT ... ON CONFLICT (user_id, scope)
-- DO UPDATE` whose SET expression performs the increment and whose RETURNING reveals
-- the POST-increment count. That is not the broken pattern: the broken pattern reads
-- a count in one snapshot and writes based on it, and a `pg_advisory_xact_lock` taken
-- inside a CTE does not help because the statement's MVCC snapshot is fixed at
-- statement start, BEFORE the lock is granted. Here nothing is read from a snapshot
-- at all. ON CONFLICT DO UPDATE is documented to be atomic: the conflicting row is
-- ROW-LOCKED and the SET expression is applied to the LATEST row version, not to the
-- command's snapshot. So N concurrent callers serialize on that one row lock and each
-- one's `rlc.request_count + 1` reads its predecessor's just-committed value. The
-- RETURNING values are therefore 1, 2, 3, ... N with no duplicates, and exactly
-- p_limit of them satisfy `<= p_limit`. The first-insert race is covered by the same
-- mechanism: one caller wins the speculative insertion, the rest see a conflict and
-- take the locked DO UPDATE path. No advisory lock is needed or used.
--
-- SECURITY INVOKER (the DEFAULT — deliberately NOT definer), same reasoning as 0012:
-- the fn touches ONLY the caller's own row and needs no RLS bypass. Under INVOKER the
-- INSERT policy's WITH CHECK (auth.uid() = user_id) rejects a mismatched p_user_id
-- LOUD (42501), so identity is still enforced by RLS rather than trusted from an
-- argument. A DEFINER fn would be strictly WORSE here: the definer is the migration
-- role, which on a bare container is superuser and therefore BYPASSES RLS entirely,
-- turning p_user_id into unverified input. search_path is pinned = '' with every
-- reference schema-qualified anyway (defense-in-depth; pg_catalog builtins like now()
-- resolve implicitly).

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  user_id       uuid NOT NULL,
  -- Which paid surface is being throttled (e.g. 'parse_full'). Part of the key so
  -- one endpoint exhausting its budget cannot starve an unrelated one, and so two
  -- callers with different limits do not fight over one row.
  scope         text NOT NULL,
  window_start  timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (user_id, scope)
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters FORCE ROW LEVEL SECURITY;

-- Default-deny + own-row-only. SELECT/INSERT/UPDATE are exactly the three verbs the
-- upsert needs (INSERT ... ON CONFLICT DO UPDATE ... RETURNING reads the existing row
-- for the increment and reads back the result, so SELECT is required too). There is
-- deliberately NO DELETE policy and no DELETE grant: a client must not be able to
-- drop its own counter row to clear its spend window.
CREATE POLICY rate_limit_counters_select_own ON public.rate_limit_counters
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY rate_limit_counters_insert_own ON public.rate_limit_counters
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY rate_limit_counters_update_own ON public.rate_limit_counters
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER rate_limit_counters_set_updated_at
  BEFORE UPDATE ON public.rate_limit_counters
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.rate_limit_counters TO app_user;

CREATE OR REPLACE FUNCTION public.consume_rate_token(
  p_user_id uuid,
  p_scope   text,
  p_limit   integer,
  p_window  interval
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $fn$
DECLARE
  v_count integer;
BEGIN
  -- ONE atomic statement. The CASE picks reset-vs-increment from the LATEST row
  -- version under the ON CONFLICT row lock (see the header) — never from this
  -- command's snapshot, which is why concurrent racers cannot both read the same
  -- pre-increment count.
  INSERT INTO public.rate_limit_counters AS rlc (user_id, scope, window_start, request_count)
  VALUES (p_user_id, p_scope, now(), 1)
  ON CONFLICT (user_id, scope) DO UPDATE
    SET request_count = CASE
          WHEN rlc.window_start <= now() - p_window THEN 1
          ELSE rlc.request_count + 1
        END,
        window_start = CASE
          WHEN rlc.window_start <= now() - p_window THEN now()
          ELSE rlc.window_start
        END
  RETURNING rlc.request_count INTO v_count;

  -- Post-increment count: each racer holds a distinct ticket, so exactly p_limit of
  -- them are admitted.
  RETURN v_count <= p_limit;
END;
$fn$;

-- Default EXECUTE is granted to PUBLIC; narrow it to app_user (the only caller).
REVOKE ALL ON FUNCTION public.consume_rate_token(uuid, text, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_token(uuid, text, integer, interval) TO app_user;

-- DOWN Migration
REVOKE EXECUTE ON FUNCTION public.consume_rate_token(uuid, text, integer, interval) FROM app_user;
DROP FUNCTION IF EXISTS public.consume_rate_token(uuid, text, integer, interval);
DROP TRIGGER IF EXISTS rate_limit_counters_set_updated_at ON public.rate_limit_counters;
DROP POLICY IF EXISTS rate_limit_counters_update_own ON public.rate_limit_counters;
DROP POLICY IF EXISTS rate_limit_counters_insert_own ON public.rate_limit_counters;
DROP POLICY IF EXISTS rate_limit_counters_select_own ON public.rate_limit_counters;
REVOKE SELECT, INSERT, UPDATE ON public.rate_limit_counters FROM app_user;
DROP TABLE IF EXISTS public.rate_limit_counters;
