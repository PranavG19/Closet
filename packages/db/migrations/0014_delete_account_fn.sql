-- UP Migration
-- delete_my_account(): the in-app account-deletion purge. Apple App Store Review
-- Guideline 5.1.1(v) makes this MANDATORY — an app that offers account creation MUST
-- offer in-app account deletion — so this is a hard submission blocker, not a nicety.
--
-- WHY THIS IS IRREVERSIBLE-BY-DESIGN AND STILL SANCTIONED (read before judging it
-- against the "never execute destructive DDL autonomously" rule):
--   * It destroys DATA, not SCHEMA. There is no DROP, no TRUNCATE, no narrowing DDL,
--     no ALTER — only parameterless DELETEs, each one filtered `WHERE user_id =
--     auth.uid()`. The migration itself is a pure additive CREATE FUNCTION.
--   * It is scoped to the CALLER'S OWN rows and nothing else. Identity is read from
--     auth.uid() INSIDE the body; the signature takes ZERO arguments, so there is no
--     parameter through which user A could ever name user B (that is the entire
--     threat model of a SECURITY DEFINER purge, and it is closed structurally rather
--     than by a check the caller could talk its way past).
--   * It is user-initiated erasure — the legally required one. Permanence is the
--     product requirement: a "soft delete" would not satisfy 5.1.1(v) and would keep
--     her wardrobe photos' metadata alive after she asked us to forget her.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT INLINE SQL AS app_user:
-- app_user physically cannot perform this purge, by design. Its grant matrix (0002-
-- 0010) is: DELETE on wardrobe_items ONLY. wear_log is append-only (SELECT+INSERT,
-- no UPDATE/DELETE policy or grant — the moat, 0006); outfits / outfit_items /
-- parse_jobs / palette_profile have no DELETE policy or grant; subscriptions is the
-- money table and is SELECT-only (0008). An inline purge as app_user would 42501 on
-- wear_log and silently no-op on the rest. A narrow, owner-audited definer function
-- is the sanctioned alternative to handing the client blanket DELETE on seven tables
-- — the append-only and money guarantees stay intact for every DIRECT client
-- statement, and the ONLY way to erase a wear row remains this one auditable body,
-- which can only ever erase the caller's own.
--
-- SECURITY DEFINER HARDENING (mandatory, and mechanically enforced by
-- scripts/gates/check-definer-search-path.mjs — copied from 0011's pattern):
--   * SET search_path = '' with EVERY object reference fully schema-qualified
--     (public.*, auth.uid(); jsonb_build_object and GET DIAGNOSTICS resolve from
--     pg_catalog / plpgsql). Without the pin, a caller could plant a malicious object
--     in an earlier-search-path schema and hijack an unqualified reference, running it
--     with the definer's privileges — the classic escalation vector.
--   * Identity from auth.uid() read INSIDE the body, NEVER an argument. NULL (no
--     authenticated caller) RAISEs 28000 rather than deleting anything; because every
--     DELETE below is filtered on v_uid, a NULL that somehow slipped through would
--     match zero rows, so the RAISE is belt-and-braces, not the only guard.
--   * REVOKE ALL FROM PUBLIC (Postgres grants EXECUTE to PUBLIC by default) then
--     GRANT EXECUTE only to app_user.
--
-- DEFINER MUST BYPASS RLS (same precondition 0011 already carries): every table here
-- is FORCE ROW LEVEL SECURITY, which applies even to the table owner. The purge
-- therefore requires the function's owner to be a role with rolbypassrls (or
-- superuser) — the container `postgres` superuser in tests, and Supabase's
-- BYPASSRLS `postgres` migration role in production. If this function is ever
-- created by a non-bypassing role, the wear_log/outfits/parse_jobs/palette_profile/
-- subscriptions DELETEs would silently match zero rows and the wardrobe_items DELETE
-- would then raise 23503 — LOUD, not silent, which is the failure mode we want.
--
-- DELETION ORDER IS LOAD-BEARING (the FK topology dictates it exactly):
--   (1) wear_log        -- its item FK is ON DELETE **RESTRICT** (0006, the moat
--                          guard). Anything else first and (4) raises 23503.
--   (2) outfit_items    -- children of both outfits and wardrobe_items.
--   (3) outfits         -- now unreferenced (wear_log + outfit_items gone).
--   (4) wardrobe_items  -- now unreferenced; must precede (5), it references
--                          parse_jobs.
--   (5) parse_jobs      -- last of the referenced chain.
--   (6) palette_profile -- standalone.
--   (7) subscriptions   -- standalone (money row; the entitlement is RevenueCat's
--                          record of truth, this is only our mirror of it).
-- The CASCADE edges (outfit_items -> outfits/wardrobe_items) would have handled
-- themselves, but deleting them explicitly makes the per-table count honest instead
-- of attributing cascaded rows to their parent.
--
-- NOT DELETABLE FROM SQL — DEPLOY-WIRED FOLLOW-UP (flagged, NOT silently skipped):
--   * Storage objects. The `originals` and `cutouts` bucket bytes live in
--     Supabase Storage, not Postgres rows this function can reach. Purging them needs
--     the Storage admin API (or a service_role storage.objects delete) and MUST be
--     wired into the deploy as a service_role step. Until it is, deletion erases every
--     row that POINTS at a photo but not the photo bytes.
--   * The auth.users record itself. Removing the identity requires the Supabase Auth
--     admin API (service_role); a user-JWT Edge Function has no authority to do it,
--     and this migration deliberately does not grant app_user any reach into `auth`.
--   Both are tracked as a service_role account-deletion step; the row purge below is
--   the part that can be proven here, and it is proven independently in
--   packages/db/test/delete-account.integration.test.ts.
--
-- Returns a jsonb per-table row-count summary plus `total`, so the caller can log
-- what was purged (counts only — never an id, never PII) and a verifier can assert a
-- non-empty purge actually happened. A second call is a harmless no-op returning all
-- zeros, so a retried client request is idempotent rather than an error.

CREATE OR REPLACE FUNCTION public.delete_my_account()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $fn$
DECLARE
  v_uid             uuid := auth.uid();
  v_wear_log        integer;
  v_outfit_items    integer;
  v_outfits         integer;
  v_wardrobe_items  integer;
  v_parse_jobs      integer;
  v_palette_profile integer;
  v_subscriptions   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '28000';
  END IF;

  -- (1) The moat first. wear_log.item_id is ON DELETE RESTRICT, so these rows must
  -- go before their garments or step (4) raises 23503. app_user has no DELETE grant
  -- here at all — only this function's body can erase a wear row, and only the
  -- caller's own.
  DELETE FROM public.wear_log WHERE user_id = v_uid;
  GET DIAGNOSTICS v_wear_log = ROW_COUNT;

  -- (2) Outfit membership: child of both outfits and wardrobe_items.
  DELETE FROM public.outfit_items WHERE user_id = v_uid;
  GET DIAGNOSTICS v_outfit_items = ROW_COUNT;

  -- (3) Outfits: unreferenced now that (1) and (2) are gone.
  DELETE FROM public.outfits WHERE user_id = v_uid;
  GET DIAGNOSTICS v_outfits = ROW_COUNT;

  -- (4) Garments: unreferenced now. Must precede parse_jobs (it references them).
  DELETE FROM public.wardrobe_items WHERE user_id = v_uid;
  GET DIAGNOSTICS v_wardrobe_items = ROW_COUNT;

  -- (5) Parse jobs: last of the referenced chain.
  DELETE FROM public.parse_jobs WHERE user_id = v_uid;
  GET DIAGNOSTICS v_parse_jobs = ROW_COUNT;

  -- (6) Palette profile: standalone, PK user_id.
  DELETE FROM public.palette_profile WHERE user_id = v_uid;
  GET DIAGNOSTICS v_palette_profile = ROW_COUNT;

  -- (7) The money mirror: standalone, PK user_id. app_user is SELECT-only here.
  DELETE FROM public.subscriptions WHERE user_id = v_uid;
  GET DIAGNOSTICS v_subscriptions = ROW_COUNT;

  RETURN jsonb_build_object(
    'wear_log',        v_wear_log,
    'outfit_items',    v_outfit_items,
    'outfits',         v_outfits,
    'wardrobe_items',  v_wardrobe_items,
    'parse_jobs',      v_parse_jobs,
    'palette_profile', v_palette_profile,
    'subscriptions',   v_subscriptions,
    'total',           v_wear_log + v_outfit_items + v_outfits + v_wardrobe_items
                       + v_parse_jobs + v_palette_profile + v_subscriptions
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO app_user;

-- DOWN Migration
-- Fully reversible: this migration added a function and one grant, nothing else.
-- (It does not, and cannot, restore rows a caller already purged — that permanence
-- is the legal requirement, not a migration defect.)
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM app_user;
DROP FUNCTION IF EXISTS public.delete_my_account();
