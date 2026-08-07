-- UP Migration
-- outfits: a saved outfit, a first-class self-contained object. RLS FORCE
-- default-deny. UNIQUE(user_id,id) is the composite-FK anchor outfit_items and
-- wear_log point at.

CREATE TABLE IF NOT EXISTS public.outfits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outfits_user_id_id_key UNIQUE (user_id, id)
);

ALTER TABLE public.outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outfits FORCE ROW LEVEL SECURITY;

CREATE POLICY outfits_select_own ON public.outfits
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY outfits_insert_own ON public.outfits
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY outfits_update_own ON public.outfits
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER outfits_set_updated_at
  BEFORE UPDATE ON public.outfits
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.outfits TO app_user;

-- DOWN Migration
DROP TRIGGER IF EXISTS outfits_set_updated_at ON public.outfits;
DROP POLICY IF EXISTS outfits_update_own ON public.outfits;
DROP POLICY IF EXISTS outfits_insert_own ON public.outfits;
DROP POLICY IF EXISTS outfits_select_own ON public.outfits;
REVOKE SELECT, INSERT, UPDATE ON public.outfits FROM app_user;
DROP TABLE IF EXISTS public.outfits;
