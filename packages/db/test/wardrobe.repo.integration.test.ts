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
import { expectRlsDenies } from './helpers/rls-oracle.js';

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

  // RENAMED. The old title said "(RLS)", but nothing here consulted a policy:
  // b.setAvailability(USER_B, ...) puts B's OWN id in the repo's `WHERE user_id = $1`,
  // so the UPDATE matches 0 rows and returns null even with RLS switched off. What it
  // honestly proves is that the repo's own predicate confines the write — worth
  // keeping, since a repo that dropped `user_id = $1` would become exploitable. The
  // RLS half is proven by expectRlsDenies below (and, for the UPDATE policy
  // specifically, by the unfiltered-UPDATE probe at the bottom of this file).
  it('setAvailability is repo-predicate-confined — B toggling A row → null (NOT an RLS proof)', async () => {
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
    // The actual boundary, independent of the repo's SQL: an unfiltered read through
    // B's tenant context, plus a fire-drill proving that read CAN see A.
    await expectRlsDenies(superuser, execB, 'wardrobe_items', USER_A);
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

  // RENAMED + STRENGTHENED. The old title claimed "RLS-in-effect"; the body called
  // listByUser(USER_C), whose `WHERE user_id = $1` is USER_C's own id, so the 0-row
  // result was produced by the repo predicate and would hold with RLS off. Both
  // original assertions are kept (they do show the repo returns an empty list for a
  // tenant with no rows), and the RLS claim in the title is now actually measured.
  it('RLS-in-effect — C unfiltered read excludes A, and DOES see A once RLS is off', async () => {
    // Seeded here rather than inherited from an earlier `it`: the superCount control
    // below only means something if A definitely owns a row, and relying on execution
    // order made this test collapse into "expected 0 to be greater than 0" whenever it
    // was run in isolation (`-t`).
    await makeWardrobeRepo(execA).create(USER_A, { category: 'accessory' });
    const superCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);
    const execC = makeTenantExecutor(pool, USER_C);
    const cList = await makeWardrobeRepo(execC).listByUser(USER_C);
    expect(cList.length).toBe(0);
    await expectRlsDenies(superuser, execC, 'wardrobe_items', USER_A);
  });

  // THE GAP THIS CLOSES. `wardrobe_items_update_own` had no test anywhere that could
  // fail: every UPDATE call site (setAvailability) carries `WHERE user_id = $1`, so
  // widening the policy to USING (true) left the whole wall green. Only an UNFILTERED
  // UPDATE through a tenant context reaches the policy.
  //
  // WHY THERE IS NO `WHERE` AND NO `RETURNING` — this is the whole trick, and getting
  // it wrong silently re-vacuates the test. Postgres also applies SELECT policies to
  // an UPDATE that has a WHERE or a RETURNING clause, so a probe written as
  // `UPDATE ... RETURNING id` is saved by wardrobe_items_select_own and stays GREEN
  // with the UPDATE policy at USING (true) — measured, not assumed (see the fire-drill
  // note in the run log). Stripped of both clauses the statement reads no column, so
  // the UPDATE policy's USING is the ONLY thing choosing the target rows.
  //
  // That forces the oracle to be external anyway: a superuser read of A's row, from a
  // vantage the UPDATE does not control.
  it('wardrobe_items_update_own — an UNFILTERED tenant UPDATE cannot touch another tenant row', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'outerwear' });
    await makeWardrobeRepo(execA).setAvailability(USER_A, item.id, 'clean');

    // B asks to mark EVERY row it is allowed to touch unavailable. No predicate, no
    // RETURNING: the UPDATE policy alone decides what that set is.
    await execB.query(`UPDATE public.wardrobe_items SET availability = 'unavailable'`);

    const after = await superuser.query<{ availability: string; user_id: string }>(
      `SELECT availability, user_id FROM public.wardrobe_items WHERE id = $1`,
      [item.id],
    );
    expect(after.rows[0]?.user_id).toBe(USER_A);
    expect(after.rows[0]?.availability).toBe('clean');
  });
});
