// Independent oracle for makeOutfitsRepo (task-09b + task-11 createWithItems).
// Idempotent create (D-001: ON CONFLICT (user_id,id)), cross-tenant isolation,
// composite-FK unrepresentability, as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { OutfitRow } from '@closet/shared';
import { makeOutfitsRepo } from '../src/repos/outfits.repo.js';
import { makeWardrobeRepo } from '../src/repos/wardrobe.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const USER_C = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';

describe('makeOutfitsRepo — idempotent create + isolation', () => {
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

  it('createWithItems round-trips + matches OutfitRow', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfit = await makeOutfitsRepo(execA).createWithItems(USER_A, {
      name: 'Monday',
      items: [{ item_id: item.id, slot: 'top', position: 0 }],
    });
    expect(() => OutfitRow.parse(outfit)).not.toThrow();
    const members = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfit.id],
    );
    expect(members.rows[0]?.n).toBe('1');
  });

  it('idempotent create with client-minted id — retry yields exactly one row (differential)', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'dress' });
    const outfitId = 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5';
    const repo = makeOutfitsRepo(execA);
    const first = await repo.createWithItems(USER_A, {
      id: outfitId,
      name: 'Fixed',
      items: [{ item_id: item.id }],
    });
    const retry = await repo.createWithItems(USER_A, {
      id: outfitId,
      name: 'Fixed',
      items: [{ item_id: item.id }],
    });
    expect(first.id).toBe(outfitId);
    expect(retry.id).toBe(outfitId);
    // Exactly one outfit row and one member (retry re-inserted nothing).
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(outfitCount.rows[0]?.n).toBe('1');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberCount.rows[0]?.n).toBe('1');
  });

  it('cross-tenant item_id in createWithItems raises FK 23503 (unrepresentable)', async () => {
    const bItem = await makeWardrobeRepo(execB).create(USER_B, { category: 'top' });
    // A names B's item under A's user_id: no wardrobe_items(A, bItem.id) parent.
    await expect(
      makeOutfitsRepo(execA).createWithItems(USER_A, {
        name: 'bad',
        items: [{ item_id: bItem.id }],
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('cross-tenant read control — B/C see none of A outfits', async () => {
    await makeOutfitsRepo(execA).createWithItems(USER_A, { name: 'A-only', items: [] });
    const bList = await makeOutfitsRepo(execB).listByUser(USER_B);
    expect(bList.some((r) => r.name === 'A-only')).toBe(false);
    const superCount = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits`);
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);
    const cList = await makeOutfitsRepo(makeTenantExecutor(pool, USER_C)).listByUser(USER_C);
    expect(cList.length).toBe(0);
  });
});
