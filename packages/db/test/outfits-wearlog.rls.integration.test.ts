// Independent oracle for task-03 (outfits, outfit_items, wear_log, palette_profile).
// Tier-2 adversarial cross-tenant penetration + structural-unwritability, on the
// Tier-3 real-Postgres substrate. The oracle is actual DB state observed from a
// vantage the inserting statement does not control — the response is never the oracle.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
// A tenant that NEVER writes — used by the RLS-in-effect control so its 0-row
// read cannot be confused with "it only sees its own (empty) rows".
const USER_C = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

async function insertItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category, cutout_path) VALUES ($1,'top','p') RETURNING id`,
    [userId],
  );
  if (!rows[0]?.id) throw new Error('no item id');
  return rows[0].id;
}

async function insertOutfit(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.outfits (user_id, name) VALUES ($1,'o') RETURNING id`,
    [userId],
  );
  if (!rows[0]?.id) throw new Error('no outfit id');
  return rows[0].id;
}

describe('0004-0007 outfits/outfit_items/wear_log/palette — cross-tenant + append-only', () => {
  let harness: PgHarness;
  let pool: Pool;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('happy path — own outfit_items insert succeeds and is visible to owner only', async () => {
    const itemId = await insertItem(execA, USER_A);
    const outfitId = await insertOutfit(execA, USER_A);
    await execA.query(
      `INSERT INTO public.outfit_items (user_id, outfit_id, item_id, slot, position)
       VALUES ($1,$2,$3,'top',0)`,
      [USER_A, outfitId, itemId],
    );
    const seenByA = await execA.query('SELECT id FROM public.outfit_items');
    expect(seenByA.rows.length).toBe(1);
    const seenByB = await execB.query('SELECT id FROM public.outfit_items');
    expect(seenByB.rows.length).toBe(0);
  });

  it('wear_log append + client_id dedup', async () => {
    const itemId = await insertItem(execA, USER_A);
    await execA.query(
      `INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'c1')`,
      [USER_A, itemId],
    );
    const dup = await execA.query(
      `INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'c1')
       ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id`,
      [USER_A, itemId],
    );
    expect(dup.rows.length).toBe(0);
  });

  it('palette_profile upsert on conflict (user_id) keeps one row with latest hues', async () => {
    await execA.query(
      `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,'["red"]'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET hues = excluded.hues`,
      [USER_A],
    );
    await execA.query(
      `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,'["blue"]'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET hues = excluded.hues`,
      [USER_A],
    );
    const { rows } = await execA.query<{ hues: string[] }>(
      `SELECT hues FROM public.palette_profile WHERE user_id = $1`,
      [USER_A],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.hues).toEqual(['blue']);
  });

  it('cross-tenant item_id in outfit_items raises a FK violation (unrepresentable)', async () => {
    const bItemId = await insertItem(execB, USER_B);
    const aOutfitId = await insertOutfit(execA, USER_A);
    // A names B's item under A's user_id: no wardrobe_items(A, bItemId) parent.
    await expect(
      execA.query(
        `INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`,
        [USER_A, aOutfitId, bItemId],
      ),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
  });

  it('cross-tenant outfit_id in outfit_items raises a FK violation (unrepresentable)', async () => {
    const aItemId = await insertItem(execA, USER_A);
    const bOutfitId = await insertOutfit(execB, USER_B);
    await expect(
      execA.query(
        `INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`,
        [USER_A, bOutfitId, aItemId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('superuser cross-owner join over outfit_items counts 0 — no foreign row landed', async () => {
    const item = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items oi
       JOIN public.wardrobe_items w ON w.id = oi.item_id AND w.user_id <> oi.user_id`,
    );
    expect(item.rows[0]?.n).toBe('0');
    const outfit = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items oi
       JOIN public.outfits o ON o.id = oi.outfit_id AND o.user_id <> oi.user_id`,
    );
    expect(outfit.rows[0]?.n).toBe('0');
  });

  it('append-only — UPDATE and DELETE on wear_log are denied, row unchanged', async () => {
    const itemId = await insertItem(execA, USER_A);
    await execA.query(
      `INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'append-test')`,
      [USER_A, itemId],
    );
    const before = await execA.query<{ id: string; worn_at: string }>(
      `SELECT id, worn_at::text AS worn_at FROM public.wear_log WHERE client_id = 'append-test'`,
    );
    const rowId = before.rows[0]?.id;
    // No UPDATE policy + no UPDATE grant ⇒ permission denied (mutant kill target:
    // adding a wear_log UPDATE/DELETE policy or grant would flip this exploitable).
    await expect(
      execA.query(`UPDATE public.wear_log SET worn_at = now() WHERE id = $1`, [rowId]),
    ).rejects.toThrow();
    await expect(
      execA.query(`DELETE FROM public.wear_log WHERE id = $1`, [rowId]),
    ).rejects.toThrow();
    const after = await execA.query<{ worn_at: string }>(
      `SELECT worn_at::text AS worn_at FROM public.wear_log WHERE id = $1`,
      [rowId],
    );
    expect(after.rows[0]?.worn_at).toBe(before.rows[0]?.worn_at);
  });

  it('RLS-in-effect control — C sees 0 outfits while superuser confirms rows exist', async () => {
    // The superuser sees A's (and B's) outfits — rows exist. Tenant C never wrote
    // any, so its 0-row read proves RLS is scoping to the caller (not that the
    // table is empty). If SET LOCAL ROLE were ever skipped, C would see them all.
    const superCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits`,
    );
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);
    const execC = makeTenantExecutor(pool, USER_C);
    const cSees = await execC.query('SELECT id FROM public.outfits');
    expect(cSees.rows.length).toBe(0);
  });
});
