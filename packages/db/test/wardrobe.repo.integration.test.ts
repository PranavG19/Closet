// Independent oracle for makeWardrobeRepo (task-09b). Tier-3: driven as app_user
// through makeTenantExecutor against a real Postgres with the FULL migration chain.
// The oracle is DB state observed from a vantage the writing statement does not
// control — a second tenant's executor and a superuser count — never the repo's
// own return value.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { WardrobeItemRow } from '@closet/shared';
import { makeWardrobeRepo } from '../src/repos/wardrobe.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const USER_C = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';

describe('makeWardrobeRepo — RLS-scoped as app_user', () => {
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

  it('create round-trips and matches WardrobeItemRow schema', async () => {
    const repo = makeWardrobeRepo(execA);
    const row = await repo.create(USER_A, { category: 'top', color: 'red' });
    expect(() => WardrobeItemRow.parse(row)).not.toThrow();
    expect(row.user_id).toBe(USER_A);
    // timestamps are ISO strings, not Date; phash null here (not set).
    expect(typeof row.created_at).toBe('string');
    const readBack = await repo.getById(USER_A, row.id);
    expect(readBack?.id).toBe(row.id);
  });

  it('cross-tenant read returns [] / null — B sees none of A rows', async () => {
    const a = makeWardrobeRepo(execA);
    const created = await a.create(USER_A, { category: 'bottom' });
    const b = makeWardrobeRepo(execB);
    expect(await b.getById(USER_A, created.id)).toBeNull();
    const bList = await b.listByUser(USER_B);
    expect(bList.every((r) => r.user_id === USER_B)).toBe(true);
    expect(bList.some((r) => r.id === created.id)).toBe(false);
  });

  it('setAvailability confines to owner; B toggling A row → null (RLS)', async () => {
    const a = makeWardrobeRepo(execA);
    const item = await a.create(USER_A, { category: 'shoes' });
    const toggled = await a.setAvailability(USER_A, item.id, 'dirty');
    expect(toggled?.availability).toBe('dirty');
    const b = makeWardrobeRepo(execB);
    // B cannot see or update A's row: 0 rows updated → null. Not a leak.
    expect(await b.setAvailability(USER_B, item.id, 'unavailable')).toBeNull();
    // superuser confirms A's row is still dirty (B's attempt changed nothing).
    const check = await superuser.query<{ availability: string }>(
      `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
      [item.id],
    );
    expect(check.rows[0]?.availability).toBe('dirty');
  });

  it('keyset listByUser clamps limit to <= 100 and pages without dupes/gaps', async () => {
    // A dedicated tenant so counts are clean.
    const seedUser = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    const execSeed = makeTenantExecutor(pool, seedUser);
    const repo = makeWardrobeRepo(execSeed);
    for (let i = 0; i < 120; i += 1) {
      await repo.create(seedUser, { category: 'top', color: `c${i}` });
    }
    // Clamp: ask for 100000, get <= 100.
    const clamped = await repo.listByUser(seedUser, { limit: 100_000 });
    expect(clamped.length).toBeLessThanOrEqual(100);
    expect(clamped.length).toBe(100);

    // Page through with a small page and assert every id appears exactly once.
    const seen = new Set<string>();
    let cursor: { createdAt: string; id: string } | undefined;
    for (;;) {
      const page: WardrobeItemRow[] = await repo.listByUser(seedUser, {
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      for (const r of page) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      if (page.length < 25) break;
      const last = page[page.length - 1]!;
      cursor = { createdAt: last.created_at, id: last.id };
    }
    expect(seen.size).toBe(120);
  });

  it('RLS-in-effect control — C sees 0 while superuser confirms rows exist', async () => {
    const superCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);
    const execC = makeTenantExecutor(pool, USER_C);
    const cList = await makeWardrobeRepo(execC).listByUser(USER_C);
    expect(cList.length).toBe(0);
  });
});
