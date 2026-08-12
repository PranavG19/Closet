// Independent oracle for migration 0018 — the wear_log→outfits FK on delete.
// Tier-3 (migration reversibility on POPULATED data) + the F6 outfit-delete moat law.
//
// The bug 0018 fixes: the composite FK (user_id, outfit_id) ON DELETE SET NULL nulled
// EVERY referencing column under MATCH SIMPLE, so deleting a worn outfit tried to null
// wear_log.user_id (NOT NULL) → 23502 → the delete 500'd. The oracle here is the live
// Postgres error / row state after a real DELETE, plus a down→up round trip run with a
// wear_log row present (never an empty fixture — that would not prove the DOWN is safe
// on data). The section extractors run the migration's OWN up/down SQL, byte-identical
// to production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import { applyMigrations, upSection, downSection } from './helpers/applyMigrations.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = '11111111-1111-1111-1111-111111111111';
const MIGRATION_0018 = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '0018_wear_log_outfit_id_idx.sql',
);

// Seed a worn outfit and return { outfitId, wearId }. Superuser (bypasses RLS) so the
// test controls exactly one tenant's rows without threading auth.uid().
async function seedWornOutfit(pool: Pool): Promise<{ outfitId: string; wearId: string }> {
  const item = await pool.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
    [USER_A],
  );
  const outfit = await pool.query<{ id: string }>(
    `INSERT INTO public.outfits (user_id, name) VALUES ($1,'worn-look') RETURNING id`,
    [USER_A],
  );
  const wear = await pool.query<{ id: string }>(
    `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [USER_A, item.rows[0]!.id, outfit.rows[0]!.id, `c-${outfit.rows[0]!.id}`],
  );
  return { outfitId: outfit.rows[0]!.id, wearId: wear.rows[0]!.id };
}

describe('0018 wear_log outfit FK — delete-of-worn-outfit + populated DOWN round trip', () => {
  let harness: PgHarness;
  let pool: Pool;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('deleting a worn outfit nulls only outfit_id and preserves the wear row (moat is append-only)', async () => {
    const { outfitId, wearId } = await seedWornOutfit(pool);
    // The exact statement the delete handler runs — must NOT raise 23502.
    await expect(
      pool.query(`DELETE FROM public.outfits WHERE id = $1`, [outfitId]),
    ).resolves.toBeDefined();
    const wear = await pool.query<{ user_id: string; outfit_id: string | null }>(
      `SELECT user_id, outfit_id FROM public.wear_log WHERE id = $1`,
      [wearId],
    );
    expect(wear.rowCount).toBe(1); // history survives
    expect(wear.rows[0]!.outfit_id).toBeNull(); // outfit_id cleared
    expect(wear.rows[0]!.user_id).toBe(USER_A); // user_id NOT nulled — the whole fix
  });

  it('DOWN then UP round-trips cleanly with a wear_log row present, and the fix holds after re-UP', async () => {
    const content = await readFile(MIGRATION_0018, 'utf8');
    const { wearId } = await seedWornOutfit(pool); // populate BEFORE reverting

    // DOWN on populated data must not error (this restores the pre-0018 broken FK).
    await expect(pool.query(downSection(content))).resolves.toBeDefined();
    // The seeded wear row is untouched by the schema revert.
    const afterDown = await pool.query(`SELECT 1 FROM public.wear_log WHERE id = $1`, [wearId]);
    expect(afterDown.rowCount).toBe(1);

    // UP re-applies the fix on the same populated DB.
    await expect(pool.query(upSection(content))).resolves.toBeDefined();

    // And the fix is real again: a fresh worn outfit deletes without 23502.
    const { outfitId, wearId: wearId2 } = await seedWornOutfit(pool);
    await expect(
      pool.query(`DELETE FROM public.outfits WHERE id = $1`, [outfitId]),
    ).resolves.toBeDefined();
    const wear = await pool.query<{ outfit_id: string | null }>(
      `SELECT outfit_id FROM public.wear_log WHERE id = $1`,
      [wearId2],
    );
    expect(wear.rows[0]!.outfit_id).toBeNull();
  });

  it('the corrected FK nulls exactly the outfit_id column (catalog oracle)', async () => {
    // confdelsetcols lists the columns a SET NULL action nulls; it must name ONLY
    // outfit_id's attnum, never user_id's. Read straight from pg_constraint — the
    // catalog, not the migration text.
    const { rows } = await pool.query<{ nulled_cols: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY a.attname) AS nulled_cols
         FROM pg_constraint c
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)
        WHERE c.conname = 'wear_log_outfit_fk'`,
    );
    expect(rows[0]!.nulled_cols).toEqual(['outfit_id']);
  });
});
