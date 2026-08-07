-- UP Migration
-- parse_jobs: one row per submitted photo = the work unit AND resumability seam.
-- Columns follow docs/06 §3 (authoritative). The per-photo idempotency key
-- UNIQUE(user_id, source_photo_hash) lives HERE (one photo yields N garments), never
-- on wardrobe_items. UNIQUE(user_id,id) is the composite-FK anchor for provenance.

CREATE TABLE IF NOT EXISTS public.parse_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  source_photo_hash  text NOT NULL,
  source_photo_path  text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('teaser','full')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  claimed_at         timestamptz,
  error_reason       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parse_jobs_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT parse_jobs_user_id_source_photo_hash_key UNIQUE (user_id, source_photo_hash)
);

ALTER TABLE public.parse_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parse_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY parse_jobs_select_own ON public.parse_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY parse_jobs_insert_own ON public.parse_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY parse_jobs_update_own ON public.parse_jobs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER parse_jobs_set_updated_at
  BEFORE UPDATE ON public.parse_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.parse_jobs TO app_user;

CREATE INDEX IF NOT EXISTS parse_jobs_keyset_idx
  ON public.parse_jobs (user_id, created_at DESC, id DESC);

-- Cross-table composite FK: a garment can only link to a parse job with the SAME
-- user_id, so a cross-tenant provenance link cannot be written. Added here, after
-- parse_jobs and its UNIQUE(user_id,id) anchor exist. ON DELETE SET NULL: a pruned
-- job leaves the garment intact (docs/06 §3 keeps garments; provenance is optional).
ALTER TABLE public.wardrobe_items
  ADD CONSTRAINT wardrobe_items_parse_job_fk
  FOREIGN KEY (user_id, parse_job_id)
  REFERENCES public.parse_jobs (user_id, id) ON DELETE SET NULL;

-- DOWN Migration
ALTER TABLE public.wardrobe_items DROP CONSTRAINT IF EXISTS wardrobe_items_parse_job_fk;
DROP INDEX IF EXISTS public.parse_jobs_keyset_idx;
DROP TRIGGER IF EXISTS parse_jobs_set_updated_at ON public.parse_jobs;
DROP POLICY IF EXISTS parse_jobs_update_own ON public.parse_jobs;
DROP POLICY IF EXISTS parse_jobs_insert_own ON public.parse_jobs;
DROP POLICY IF EXISTS parse_jobs_select_own ON public.parse_jobs;
REVOKE SELECT, INSERT, UPDATE ON public.parse_jobs FROM app_user;
DROP TABLE IF EXISTS public.parse_jobs;
