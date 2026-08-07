-- UP Migration
-- palette_profile: per-user palette result (1:1). user_id is the PK (no separate
-- id). Only the RESULT hue-set is persisted, decoupled from derivation. RLS FORCE
-- default-deny; upsert on conflict (user_id).

CREATE TABLE IF NOT EXISTS public.palette_profile (
  user_id     uuid PRIMARY KEY,
  hues        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.palette_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.palette_profile FORCE ROW LEVEL SECURITY;

CREATE POLICY palette_profile_select_own ON public.palette_profile
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY palette_profile_insert_own ON public.palette_profile
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY palette_profile_update_own ON public.palette_profile
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER palette_profile_set_updated_at
  BEFORE UPDATE ON public.palette_profile
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.palette_profile TO app_user;

-- DOWN Migration
DROP TRIGGER IF EXISTS palette_profile_set_updated_at ON public.palette_profile;
DROP POLICY IF EXISTS palette_profile_update_own ON public.palette_profile;
DROP POLICY IF EXISTS palette_profile_insert_own ON public.palette_profile;
DROP POLICY IF EXISTS palette_profile_select_own ON public.palette_profile;
REVOKE SELECT, INSERT, UPDATE ON public.palette_profile FROM app_user;
DROP TABLE IF EXISTS public.palette_profile;
