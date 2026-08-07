-- UP Migration
-- wardrobe_items: each user's garments. RLS FORCE default-deny keyed on
-- auth.uid()=user_id. Columns follow docs/06 §3 (authoritative). UNIQUE(user_id,id)
-- is the composite-FK anchor later-wave tables point at, making a cross-tenant
-- garment reference structurally unrepresentable.

CREATE TABLE IF NOT EXISTS public.wardrobe_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  category      text NOT NULL CHECK (category IN ('top','bottom','dress','outerwear','shoes','accessory')),
  color         text,
  pattern       text,
  attributes    jsonb,
  availability  text NOT NULL DEFAULT 'clean' CHECK (availability IN ('clean','dirty','unavailable')),
  cutout_path   text,
  parse_job_id  uuid,
  phash         bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wardrobe_items_user_id_id_key UNIQUE (user_id, id)
);

ALTER TABLE public.wardrobe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wardrobe_items FORCE ROW LEVEL SECURITY;

CREATE POLICY wardrobe_items_select_own ON public.wardrobe_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY wardrobe_items_insert_own ON public.wardrobe_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY wardrobe_items_update_own ON public.wardrobe_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER wardrobe_items_set_updated_at
  BEFORE UPDATE ON public.wardrobe_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.wardrobe_items TO app_user;

-- keyset (recency): serves WHERE user_id=$1 ORDER BY created_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS wardrobe_items_keyset_idx
  ON public.wardrobe_items (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS wardrobe_items_availability_idx
  ON public.wardrobe_items (user_id, availability);
CREATE INDEX IF NOT EXISTS wardrobe_items_category_idx
  ON public.wardrobe_items (user_id, category);

-- DOWN Migration
DROP INDEX IF EXISTS public.wardrobe_items_category_idx;
DROP INDEX IF EXISTS public.wardrobe_items_availability_idx;
DROP INDEX IF EXISTS public.wardrobe_items_keyset_idx;
DROP TRIGGER IF EXISTS wardrobe_items_set_updated_at ON public.wardrobe_items;
DROP POLICY IF EXISTS wardrobe_items_update_own ON public.wardrobe_items;
DROP POLICY IF EXISTS wardrobe_items_insert_own ON public.wardrobe_items;
DROP POLICY IF EXISTS wardrobe_items_select_own ON public.wardrobe_items;
REVOKE SELECT, INSERT, UPDATE ON public.wardrobe_items FROM app_user;
DROP TABLE IF EXISTS public.wardrobe_items;
