// Independent oracle for makePaletteRepo (task-09b). 1:1 upsert + isolation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PaletteProfileRow } from '@closet/shared';
import { makePaletteRepo } from '../src/repos/palette.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('makePaletteRepo — 1:1 upsert', () => {
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

  it('upsert is 1:1 — second upsert updates in place, one row (differential)', async () => {
    const repo = makePaletteRepo(execA);
    const first = await repo.upsert(USER_A, ['red', 'coral']);
    expect(() => PaletteProfileRow.parse(first)).not.toThrow();
    await repo.upsert(USER_A, ['blue']);
    const readBack = await repo.getByUser(USER_A);
    expect(readBack?.hues).toEqual(['blue']);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.palette_profile WHERE user_id = $1`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('cross-tenant read control — B never sees A hues', async () => {
    await makePaletteRepo(execA).upsert(USER_A, ['green']);
    await makePaletteRepo(execB).upsert(USER_B, ['violet']);
    const bRow = await makePaletteRepo(execB).getByUser(USER_B);
    expect(bRow?.hues).toEqual(['violet']);
    // B reading A's user_id row → null under RLS.
    expect(await makePaletteRepo(execB).getByUser(USER_A)).toBeNull();
  });
});
