-- UP Migration
-- wardrobe_items DELETE for app_user. The dedupe keep-one MERGE (docs/06 §7) must
-- delete the now-unreferenced DISCARD garment as the caller (app_user), AFTER
-- re-pointing its wear_log + outfit_items refs. Migration 0002 granted only
-- SELECT/INSERT/UPDATE, so the merge's final DELETE failed with 42501. This adds a
-- DELETE policy scoped to the owner (RLS keeps it confined to auth.uid()=user_id)
-- and the matching grant. Expand-only, no data touched.
--
-- This does NOT weaken the moat: wear_log's FK is ON DELETE RESTRICT (0006), so a
-- worn item still cannot be deleted until its wear rows are re-pointed — the merge
-- does exactly that first, in one atomic statement. A bare delete of a worn item
-- still raises 23503.

CREATE POLICY wardrobe_items_delete_own ON public.wardrobe_items
  FOR DELETE USING (auth.uid() = user_id);

GRANT DELETE ON public.wardrobe_items TO app_user;

-- DOWN Migration
REVOKE DELETE ON public.wardrobe_items FROM app_user;
DROP POLICY IF EXISTS wardrobe_items_delete_own ON public.wardrobe_items;
