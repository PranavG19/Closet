-- UP Migration
-- The dedupe keep-one MERGE as ONE plpgsql function (docs/06 §7 prescribes exactly
-- this: "re-point wear_log.item_id and outfit_items.item_id ... then delete the
-- now-unreferenced item in one plpgsql fn"). It exists because the moat is
-- structurally append-only: app_user has NO UPDATE grant on wear_log (0006), so an
-- inline CTE running as app_user cannot re-point wear rows. A SECURITY DEFINER
-- function is the sanctioned, narrow capability that performs the controlled
-- re-point WITHOUT granting the client blanket mutate on the moat — a DIRECT client
-- UPDATE/DELETE on wear_log still 42501s (the append-only guarantee is intact); only
-- this owner-audited function can move a wear row, and only among the CALLER'S OWN
-- items.
--
-- SECURITY DEFINER HARDENING (mandatory — this fn bypasses RLS by running as its
-- owner; on the test container the owner is the `postgres` superuser, on hosted
-- Supabase it is the non-superuser migration role — either way the guards below are
-- what make it safe, NOT the owner's privilege level):
--   * SET search_path = '' and EVERY object reference is fully schema-qualified
--     (public.*, pg_catalog for ROW_COUNT via GET DIAGNOSTICS is a plpgsql builtin).
--     Without this, a caller could create a malicious object in an earlier
--     search-path schema and hijack an unqualified reference, executing it as the
--     definer — the classic privilege-escalation vector.
--   * Identity comes from auth.uid() read INSIDE the fn (never a user_id argument),
--     and an UP-FRONT ownership assertion RAISEs if either keep or discard is not
--     owned by the caller — a cross-tenant id fails LOUD, it does not silently match
--     0 rows.
--   * REVOKE ALL FROM PUBLIC (Postgres grants EXECUTE to PUBLIC by default) then
--     GRANT EXECUTE only to app_user.
--
-- Returns true iff the discard existed and was deleted; false is impossible here
-- (a missing/foreign discard RAISEs), so the caller reads true=merged. wear_log's
-- ON DELETE RESTRICT still protects the moat: the final delete only succeeds because
-- the re-point ran first, in the same function/transaction.

CREATE OR REPLACE FUNCTION public.merge_keep_one(p_keep uuid, p_discard uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '28000';
  END IF;

  -- Cross-tenant guard (fails LOUD) vs. idempotent no-op (returns false), a
  -- distinction only this SECURITY DEFINER fn can make (RLS hides other tenants'
  -- rows from a direct query, but the definer sees the whole table):
  --   * If either id EXISTS but is owned by ANOTHER user, it is a true cross-tenant
  --     probe → RAISE 42501 (rolls back; the victim's rows are provably untouched).
  --   * If an id is simply ABSENT (never existed, or the discard was already merged
  --     away on a prior call), that is the idempotent case → RETURN false, no error
  --     (docs/06 §7 / task-10 §3.4: a retried resolution must not error).
  IF EXISTS (
    SELECT 1 FROM public.wardrobe_items
     WHERE id = p_keep AND user_id <> v_uid
  ) THEN
    RAISE EXCEPTION 'keep item % owned by another tenant', p_keep USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.wardrobe_items
     WHERE id = p_discard AND user_id <> v_uid
  ) THEN
    RAISE EXCEPTION 'discard item % owned by another tenant', p_discard USING ERRCODE = '42501';
  END IF;
  -- keep must be the caller's OWN, present target. Merging INTO a nonexistent /
  -- foreign keep is always a bug (the "owned by another tenant" case is caught
  -- above; this catches keep absent entirely) → RAISE, never a silent no-op.
  IF NOT EXISTS (
    SELECT 1 FROM public.wardrobe_items
     WHERE user_id = v_uid AND id = p_keep
  ) THEN
    RAISE EXCEPTION 'keep item % not found for caller', p_keep USING ERRCODE = '42501';
  END IF;
  -- discard absent (own, already merged away / never existed) → idempotent no-op.
  -- (Note: the "owned by another tenant" RAISE above is technically a cross-tenant
  -- EXISTENCE oracle — probing an id that RAISEs reveals it exists under some user.
  -- Non-exploitable: ids are random gen_random_uuid() (122 bits, unguessable) AND
  -- keep must be the caller's own. We accept this over the alternative, which would
  -- lose the ability to distinguish a real cross-tenant bug/attack from a no-op.)
  IF NOT EXISTS (
    SELECT 1 FROM public.wardrobe_items
     WHERE user_id = v_uid AND id = p_discard
  ) THEN
    RETURN false;
  END IF;

  -- Re-point wear_log rows from discard to keep. Append-only for direct clients;
  -- this definer fn is the only sanctioned mutator, scoped to the caller's own rows.
  UPDATE public.wear_log SET item_id = p_keep
   WHERE user_id = v_uid AND item_id = p_discard;

  -- Drop the discard membership in any outfit that already contains keep, so the
  -- re-point below cannot violate UNIQUE(outfit_id, item_id).
  DELETE FROM public.outfit_items d
   WHERE d.user_id = v_uid AND d.item_id = p_discard
     AND EXISTS (
       SELECT 1 FROM public.outfit_items k
        WHERE k.user_id = v_uid AND k.item_id = p_keep
          AND k.outfit_id = d.outfit_id
     );

  -- Re-point the remaining outfit memberships.
  UPDATE public.outfit_items SET item_id = p_keep
   WHERE user_id = v_uid AND item_id = p_discard;

  -- Delete the now-unreferenced discard item. wear_log's ON DELETE RESTRICT holds:
  -- this only succeeds because the re-point above already moved the wear rows.
  DELETE FROM public.wardrobe_items
   WHERE user_id = v_uid AND id = p_discard;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.merge_keep_one(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_keep_one(uuid, uuid) TO app_user;

-- DOWN Migration
REVOKE EXECUTE ON FUNCTION public.merge_keep_one(uuid, uuid) FROM app_user;
DROP FUNCTION IF EXISTS public.merge_keep_one(uuid, uuid);
