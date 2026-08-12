-- UP Migration
-- Fix outfit delete on the moat. migration 0017 made outfits deletable, but the
-- wear_log→outfits FK (0006) is a COMPOSITE (user_id, outfit_id) with a bare
-- ON DELETE SET NULL. MATCH SIMPLE SET NULL nulls EVERY referencing column, so deleting
-- a worn outfit tried to null wear_log.user_id too — which is NOT NULL — raising 23502
-- and 500ing the delete for any outfit that had ever been worn. (Proven by an integration
-- test that seeds a wear_log row then deletes its outfit.)
--
-- Fix: column-specific SET NULL (outfit_id) (Postgres 15+; prod + the postgres:17 test
-- container both support it). Now only outfit_id is nulled; user_id is preserved, and the
-- FK is satisfied because MATCH SIMPLE skips a row whose referencing set has a NULL. The
-- wear history row survives with outfit_id cleared — the append-only moat invariant.
--
-- Also add the FK-child index the SET NULL sweep needs: wear_log had a child index for the
-- item FK but none for the outfit FK, so nulling out an outfit's wear rows seq-scanned the
-- whole (only-ever-growing) moat table. Partial on non-null outfit_id, mirroring
-- wear_log_user_client_id_key's partial idiom — the FK cascade only ever probes with a
-- concrete non-null outfit id, and item-only wears store NULL here.
--
-- Reversible: DROP + re-ADD swaps only the referential ACTION (same columns, same parent,
-- same nullability), and the index is CREATE ↔ DROP. No data is dropped or narrowed.

ALTER TABLE public.wear_log DROP CONSTRAINT wear_log_outfit_fk;
ALTER TABLE public.wear_log
  ADD CONSTRAINT wear_log_outfit_fk
  FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits (user_id, id)
  ON DELETE SET NULL (outfit_id);

CREATE INDEX IF NOT EXISTS wear_log_outfit_id_idx
  ON public.wear_log (outfit_id) WHERE outfit_id IS NOT NULL;

-- DOWN Migration
DROP INDEX IF EXISTS public.wear_log_outfit_id_idx;
ALTER TABLE public.wear_log DROP CONSTRAINT wear_log_outfit_fk;
ALTER TABLE public.wear_log
  ADD CONSTRAINT wear_log_outfit_fk
  FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits (user_id, id) ON DELETE SET NULL;
