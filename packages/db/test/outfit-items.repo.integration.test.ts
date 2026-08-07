// Independent oracle for makeOutfitItemsRepo (task-09b). add() + listByOutfit,
// composite-FK unrepresentability, isolation — as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { OutfitItemRow } from '@closet/shared';
import { makeOutfitItemsRepo } from '../src/repos/outfit-items.repo.js';
import { makeOutfitsRepo } from '../src/repos/outfits.repo.js';
import { makeWardrobeRepo } from '../src/repos/wardrobe.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('makeOutfitItemsRepo — composite-FK isolation', () => {
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

  it('add round-trips + matches OutfitItemRow (position is a number)', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfit = await makeOutfitsRepo(execA).create(USER_A, 'o');
    const repo = makeOutfitItemsRepo(execA);
    const row = await repo.add(USER_A, outfit.id, { item_id: item.id, slot: 'top', position: 3 });
    expect(() => OutfitItemRow.parse(row)).not.toThrow();
    expect(row.position).toBe(3);
    const members = await repo.listByOutfit(USER_A, outfit.id);
    expect(members.length).toBe(1);
  });

  it('cross-tenant item raises FK 23503 (control that MUST fail)', async () => {
    const bItem = await makeWardrobeRepo(execB).create(USER_B, { category: 'top' });
    const aOutfit = await makeOutfitsRepo(execA).create(USER_A, 'a');
    await expect(
      makeOutfitItemsRepo(execA).add(USER_A, aOutfit.id, { item_id: bItem.id }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('B sees none of A outfit_items; superuser cross-owner join = 0', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfit = await makeOutfitsRepo(execA).create(USER_A, 'a2');
    await makeOutfitItemsRepo(execA).add(USER_A, outfit.id, { item_id: item.id });
    const bSees = await makeOutfitItemsRepo(execB).listByOutfit(USER_B, outfit.id);
    expect(bSees.length).toBe(0);
    const join = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items oi
       JOIN public.wardrobe_items w ON w.id = oi.item_id AND w.user_id <> oi.user_id`,
    );
    expect(join.rows[0]?.n).toBe('0');
  });
});
