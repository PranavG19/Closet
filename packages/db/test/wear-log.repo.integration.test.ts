// Independent oracle for makeWearLogRepo (task-09b + task-12 appendWear). Retry
// idempotency (partial UNIQUE), atomic flip, isolation — as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { WearLogRow } from '@closet/shared';
import { makeWearLogRepo } from '../src/repos/wear-log.repo.js';
import { makeWardrobeRepo } from '../src/repos/wardrobe.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';
import { expectRlsDenies } from './helpers/rls-oracle.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('makeWearLogRepo — idempotent append + atomic flip', () => {
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

  it('append is idempotent under retry — exactly one row for (user, client_id)', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const repo = makeWearLogRepo(execA);
    const first = await repo.appendWear({ userId: USER_A, itemId: item.id, clientId: 'k1', flipToDirty: false });
    expect(() => WearLogRow.parse(first)).not.toThrow();
    const retry = await repo.appendWear({ userId: USER_A, itemId: item.id, clientId: 'k1', flipToDirty: false });
    // Same canonical row on retry.
    expect(retry.id).toBe(first.id);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = 'k1'`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('flip=true dirties the worn item atomically; no-flip leaves it clean', async () => {
    const repo = makeWearLogRepo(execA);
    const cleanItem = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    await repo.appendWear({ userId: USER_A, itemId: cleanItem.id, clientId: 'noflip', flipToDirty: false });
    const stillClean = await makeWardrobeRepo(execA).getById(USER_A, cleanItem.id);
    expect(stillClean?.availability).toBe('clean');

    const flipItem = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    await repo.appendWear({ userId: USER_A, itemId: flipItem.id, clientId: 'doflip', flipToDirty: true });
    const nowDirty = await makeWardrobeRepo(execA).getById(USER_A, flipItem.id);
    expect(nowDirty?.availability).toBe('dirty');
    const wearCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = 'doflip'`,
      [USER_A],
    );
    expect(wearCount.rows[0]?.n).toBe('1');
  });

  // The 23503 half is a real structural proof and is untouched. The listByUser half is
  // NOT an RLS proof — USER_B is the repo's own `WHERE user_id = $1`, so it stayed green
  // with wear_log_select_own widened to USING (true) (fire-drilled). Kept as the repo
  // -predicate assertion it is; the RLS claim is measured by the unfiltered probe.
  it('cross-tenant item in append raises FK 23503; B listByUser excludes A rows + RLS denies unfiltered', async () => {
    const aItem = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    // B naming A's item under B's user_id → no wardrobe_items(B, aItem) parent.
    await expect(
      makeWearLogRepo(execB).appendWear({ userId: USER_B, itemId: aItem.id, clientId: 'bx', flipToDirty: false }),
    ).rejects.toMatchObject({ code: '23503' });
    await makeWearLogRepo(execA).appendWear({ userId: USER_A, itemId: aItem.id, clientId: 'ax', flipToDirty: false });
    const bList = await makeWearLogRepo(execB).listByUser(USER_B);
    expect(bList.some((r) => r.client_id === 'ax')).toBe(false);
    await expectRlsDenies(superuser, execB, 'wear_log', USER_A);
  });
});
