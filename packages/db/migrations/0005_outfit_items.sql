-- UP Migration
-- outfit_items: member garments of an outfit. user_id is denormalized so RLS is a
-- column check, not a join. Composite FKs to outfits(user_id,id) and
-- wardrobe_items(user_id,id) make a cross-tenant reference UNREPRESENTABLE — you
-- cannot insert (me, another user's item) because no matching parent row exists.

CREATE TABLE IF NOT EXISTS public.outfit_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  item_id     uuid NOT NULL,
  slot        text,
  position    int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outfit_items_outfit_fk
    FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits (user_id, id) ON DELETE CASCADE,
  CONSTRAINT outfit_items_item_fk
    FOREIGN KEY (user_id, item_id) REFERENCES public.wardrobe_items (user_id, id) ON DELETE CASCADE,
  CONSTRAINT outfit_items_outfit_id_item_id_key UNIQUE (outfit_id, item_id)
);

ALTER TABLE public.outfit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outfit_items FORCE ROW LEVEL SECURITY;

CREATE POLICY outfit_items_select_own ON public.outfit_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY outfit_items_insert_own ON public.outfit_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY outfit_items_update_own ON public.outfit_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER outfit_items_set_updated_at
  BEFORE UPDATE ON public.outfit_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.outfit_items TO app_user;

-- FK-child index for the merge/delete path (avoid seq-scan on re-point/cascade).
CREATE INDEX IF NOT EXISTS outfit_items_item_id_idx ON public.outfit_items (item_id);

-- DOWN Migration
DROP INDEX IF EXISTS public.outfit_items_item_id_idx;
DROP TRIGGER IF EXISTS outfit_items_set_updated_at ON public.outfit_items;
DROP POLICY IF EXISTS outfit_items_update_own ON public.outfit_items;
DROP POLICY IF EXISTS outfit_items_insert_own ON public.outfit_items;
DROP POLICY IF EXISTS outfit_items_select_own ON public.outfit_items;
REVOKE SELECT, INSERT, UPDATE ON public.outfit_items FROM app_user;
DROP TABLE IF EXISTS public.outfit_items;
