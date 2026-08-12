-- UP Migration
-- F6 outfit delete. Outfits were write-once: SELECT/INSERT/UPDATE only, no way to
-- remove a saved look. This adds the missing self-service DELETE on the OWNER'S OWN
-- outfits, RLS-scoped exactly like the other policies (auth.uid() = user_id), plus the
-- table grant.
--
-- outfit_items needs NO new grant: its FK to outfits(user_id,id) is ON DELETE CASCADE
-- (migration 0005), and a cascade runs as the referential action, not as the caller's
-- DELETE privilege — so deleting an outfit row removes its members without app_user
-- holding DELETE on outfit_items. This keeps outfit_items append/update-only from the
-- app's own statements (a member is removed only by removing its outfit), which is the
-- narrower, safer grant.
--
-- This is additive + reversible (CREATE POLICY / GRANT ↔ DROP POLICY / REVOKE); no data
-- is dropped by the migration itself. A row DELETE is a normal tenant operation, not
-- destructive DDL — no approval token required.

CREATE POLICY outfits_delete_own ON public.outfits
  FOR DELETE USING (auth.uid() = user_id);

GRANT DELETE ON public.outfits TO app_user;

-- DOWN Migration
REVOKE DELETE ON public.outfits FROM app_user;
DROP POLICY IF EXISTS outfits_delete_own ON public.outfits;
