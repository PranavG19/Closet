-- UP Migration
-- wear_log: the moat. One row per item-wear. Structurally APPEND-ONLY — INSERT +
-- SELECT policies ONLY, no UPDATE/DELETE policy and no UPDATE/DELETE grant, so the
-- wear history cannot be rewritten or silently cascaded away. The item FK is
-- ON DELETE RESTRICT so a worn item cannot be silently deleted (dedupe keep-one
-- must re-point these rows first). No updated_at/trigger — nothing mutates it.

CREATE TABLE IF NOT EXISTS public.wear_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  item_id     uuid NOT NULL,
  outfit_id   uuid,
  worn_at     timestamptz NOT NULL DEFAULT now(),
  client_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wear_log_item_fk
    FOREIGN KEY (user_id, item_id) REFERENCES public.wardrobe_items (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT wear_log_outfit_fk
    FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits (user_id, id) ON DELETE SET NULL
);

ALTER TABLE public.wear_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wear_log FORCE ROW LEVEL SECURITY;

-- INSERT + SELECT ONLY. No UPDATE, no DELETE policy ⇒ append-only by construction.
CREATE POLICY wear_log_select_own ON public.wear_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY wear_log_insert_own ON public.wear_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.wear_log TO app_user;

-- Retry dedup: caller mints client_id at tap time; partial UNIQUE dedups retries.
CREATE UNIQUE INDEX IF NOT EXISTS wear_log_user_client_id_key
  ON public.wear_log (user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wear_log_worn_at_idx
  ON public.wear_log (user_id, worn_at DESC);
-- FK-child index so the ON DELETE RESTRICT check + merge re-point don't seq-scan.
CREATE INDEX IF NOT EXISTS wear_log_item_id_idx ON public.wear_log (item_id);

-- DOWN Migration
DROP INDEX IF EXISTS public.wear_log_item_id_idx;
DROP INDEX IF EXISTS public.wear_log_worn_at_idx;
DROP INDEX IF EXISTS public.wear_log_user_client_id_key;
DROP POLICY IF EXISTS wear_log_insert_own ON public.wear_log;
DROP POLICY IF EXISTS wear_log_select_own ON public.wear_log;
REVOKE SELECT, INSERT ON public.wear_log FROM app_user;
DROP TABLE IF EXISTS public.wear_log;
