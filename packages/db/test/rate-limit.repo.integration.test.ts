// Independent oracle for the per-user provider-spend throttle (migration 0015 +
// rate-limit.repo). Drives the REAL repo through a real app_user tenant executor
// (SET LOCAL ROLE app_user + request.jwt.claim.sub, so RLS is genuinely enforced —
// the container superuser BYPASSES RLS and would prove nothing) against real
// Postgres.
//
// The load-bearing test is the CONCURRENT BURST. Migration 0012 exists because a
// count-then-insert wrapped in a CTE advisory lock admitted 12 racers against a cap
// of 3: under READ COMMITTED the statement's snapshot is fixed BEFORE an in-CTE lock
// is granted. 0015 avoids that by making check-and-increment ONE
// `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, where the increment expression
// is applied to the LATEST row version under the conflict row lock rather than to the
// command's snapshot. This suite loops the burst BURST_LOOPS times and asserts the
// admitted count NEVER exceeds the limit — a single green run of a race is not
// evidence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makeRateLimitRepo } from '../src/repos/rate-limit.repo.js';
import { applyMigrations, revertMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

const HOUR = '1 hour';

// The harness Pool uses pg's default max of 10, so a 12-wide burst runs ~10-wide in
// true parallel with 2 queued. That is the same width that BLEW the 0012 CTE version
// (12 racers, cap 3, all 12 admitted), so it is a width known to expose this class of
// race rather than a width chosen to look busy.
const BURST_RACERS = 12;
const BURST_LOOPS = 25;

async function counterRow(
  superuser: QueryExecutor,
  userId: string,
  scope: string,
): Promise<{ count: number; windowStart: string } | null> {
  const { rows } = await superuser.query<{ request_count: number; window_start: string }>(
    `SELECT request_count, window_start::text AS window_start
       FROM public.rate_limit_counters WHERE user_id = $1 AND scope = $2`,
    [userId, scope],
  );
  const row = rows[0];
  if (!row) return null;
  return { count: row.request_count, windowStart: row.window_start };
}

describe('rate-limit repo — per-user provider-spend throttle (fixed window, atomic upsert)', () => {
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

  it('(a) the Nth sequential call admits, N+1 refuses, and the counter keeps climbing', async () => {
    const repo = makeRateLimitRepo(execA);
    const scope = 'seq-limit';
    const limit = 3;

    for (let i = 1; i <= limit; i += 1) {
      const call = await repo.consume(USER_A, scope, limit, HOUR);
      expect(call.admitted, `call ${i} of ${limit} must be admitted`).toBe(true);
    }
    expect((await counterRow(superuser, USER_A, scope))?.count).toBe(limit);

    // N+1 and N+2 are both refused. A refused call still increments (documented in
    // 0015): the counter is a strictly-increasing per-window ticket, which is exactly
    // what makes the concurrent proof below sound.
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);
    expect((await counterRow(superuser, USER_A, scope))?.count).toBe(limit + 2);
  });

  it('(b) after the window elapses traffic flows again (window reset, not a leak)', async () => {
    const repo = makeRateLimitRepo(execA);
    const scope = 'window-reset';
    const limit = 2;

    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);

    const exhausted = await counterRow(superuser, USER_A, scope);
    expect(exhausted?.count).toBe(3);

    // Backdate the window instead of sleeping: the clock is the input under test, so
    // control it directly. 2 hours back is comfortably past the 1-hour window.
    await superuser.query(
      `UPDATE public.rate_limit_counters SET window_start = now() - interval '2 hours'
        WHERE user_id = $1 AND scope = $2`,
      [USER_A, scope],
    );

    // First call in the new window RESETS the count to 1 (it does not merely
    // decrement or carry over) and is admitted.
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    const reopened = await counterRow(superuser, USER_A, scope);
    expect(reopened?.count).toBe(1);
    expect(reopened?.windowStart).not.toBe(exhausted?.windowStart);

    // The fresh window enforces the same limit — the reset is a reset, not an amnesty.
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);
  });

  it('(b2) a still-open window is NOT reset by a call arriving inside it', async () => {
    const repo = makeRateLimitRepo(execA);
    const scope = 'window-hold';
    const limit = 1;

    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);

    // Backdate only PART-WAY (30 minutes into a 1-hour window) — still closed.
    await superuser.query(
      `UPDATE public.rate_limit_counters SET window_start = now() - interval '30 minutes'
        WHERE user_id = $1 AND scope = $2`,
      [USER_A, scope],
    );
    const backdated = await counterRow(superuser, USER_A, scope);
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);

    // window_start must NOT have jumped forward — a refused call cannot extend the
    // window, or a hammering caller would never get out of jail.
    expect((await counterRow(superuser, USER_A, scope))?.windowStart).toBe(
      backdated?.windowStart,
    );
    expect((await repo.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);
    expect((await counterRow(superuser, USER_A, scope))?.windowStart).toBe(
      backdated?.windowStart,
    );
  });

  it('(c) a genuine CONCURRENT burst admits AT MOST the limit — looped, with the distribution', async () => {
    const repo = makeRateLimitRepo(execA);
    const limit = 3;
    const admittedCounts: number[] = [];

    for (let loop = 0; loop < BURST_LOOPS; loop += 1) {
      // Fresh scope per loop = fresh counter row (PK is (user_id, scope)), so each
      // iteration is an independent race from zero rather than one long window.
      const scope = `burst-${loop}`;
      const results = await Promise.all(
        Array.from({ length: BURST_RACERS }, () => repo.consume(USER_A, scope, limit, HOUR)),
      );
      const admitted = results.filter((r) => r.admitted).length;
      admittedCounts.push(admitted);

      // Every racer took a distinct ticket: the post-increment count equals the
      // number of calls made. If the increment were snapshot-based (the 0012 bug)
      // racers would overwrite each other and this would land BELOW BURST_RACERS.
      expect(
        (await counterRow(superuser, USER_A, scope))?.count,
        `loop ${loop}: lost increments — the upsert is not serializing`,
      ).toBe(BURST_RACERS);
    }

    const distribution = admittedCounts.reduce<Record<number, number>>((acc, n) => {
      acc[n] = (acc[n] ?? 0) + 1;
      return acc;
    }, {});
    const over = admittedCounts.filter((n) => n > limit);

    // Reported so a reader can see the race really ran wide, not just that it passed.
    expect(
      over,
      `OVER-ADMISSION in ${over.length}/${BURST_LOOPS} loops. limit=${limit} racers=${BURST_RACERS} distribution=${JSON.stringify(distribution)}`,
    ).toEqual([]);
    // AT MOST the limit, and (because refusals also increment, so no ticket is
    // wasted) EXACTLY the limit every time.
    expect(
      admittedCounts,
      `admitted-per-loop distribution=${JSON.stringify(distribution)}`,
    ).toEqual(Array.from({ length: BURST_LOOPS }, () => limit));
  });

  it('(d) cross-user isolation: B never consumes A budget, and a mismatched p_user_id is refused by RLS', async () => {
    const repoA = makeRateLimitRepo(execA);
    const repoB = makeRateLimitRepo(execB);
    const scope = 'shared-scope-name';
    const limit = 2;

    // A exhausts its own budget for this scope.
    expect((await repoA.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repoA.consume(USER_A, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repoA.consume(USER_A, scope, limit, HOUR)).admitted).toBe(false);

    // B, on the SAME scope name, still has its full budget — the key is (user, scope).
    expect((await repoB.consume(USER_B, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repoB.consume(USER_B, scope, limit, HOUR)).admitted).toBe(true);
    expect((await repoB.consume(USER_B, scope, limit, HOUR)).admitted).toBe(false);

    // Two distinct rows exist (superuser control: the rows are really there, so B's
    // pass above is isolation and not a missing row).
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.rate_limit_counters WHERE scope = $1`,
      [scope],
    );
    expect(rows[0]?.n).toBe('2');

    // B's row was untouched by A's traffic and vice versa.
    expect((await counterRow(superuser, USER_A, scope))?.count).toBe(3);
    expect((await counterRow(superuser, USER_B, scope))?.count).toBe(3);

    // Identity is NOT trusted from the argument: SECURITY INVOKER means the INSERT
    // policy's WITH CHECK (auth.uid() = user_id) rejects a p_user_id that is not the
    // caller's sub — LOUD (42501), never a silent success on someone else's budget.
    await expect(repoA.consume(USER_B, 'spoof-scope', 10, HOUR)).rejects.toThrow(
      /row-level security/i,
    );
    expect(await counterRow(superuser, USER_B, 'spoof-scope')).toBeNull();
  });

  it('(d2) app_user cannot DELETE its counter row to clear its own spend window', async () => {
    const repo = makeRateLimitRepo(execA);
    const scope = 'no-delete';
    expect((await repo.consume(USER_A, scope, 1, HOUR)).admitted).toBe(true);
    expect((await repo.consume(USER_A, scope, 1, HOUR)).admitted).toBe(false);

    // No DELETE grant and no DELETE policy → the escape hatch is unrepresentable.
    await expect(
      execA.query(`DELETE FROM public.rate_limit_counters WHERE user_id = $1 AND scope = $2`, [
        USER_A,
        scope,
      ]),
    ).rejects.toThrow(/permission denied/i);
    expect((await counterRow(superuser, USER_A, scope))?.count).toBe(2);
  });

  it('(e) DOWN round-trips on POPULATED data (rows present -> down -> up)', async () => {
    // Populate deliberately, including a second tenant, so the DOWN is exercised on
    // real rows rather than an empty fixture.
    const repo = makeRateLimitRepo(execA);
    await repo.consume(USER_A, 'roundtrip', 5, HOUR);
    await makeRateLimitRepo(execB).consume(USER_B, 'roundtrip', 5, HOUR);
    const { rows: before } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.rate_limit_counters`,
    );
    expect(Number(before[0]?.n)).toBeGreaterThan(1);

    await revertMigrations(pool);

    // The table and the function are both gone after DOWN.
    const { rows: gone } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'rate_limit_counters'`,
    );
    expect(gone[0]?.n).toBe('0');
    const { rows: fnGone } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'consume_rate_token'`,
    );
    expect(fnGone[0]?.n).toBe('0');

    await applyMigrations(pool);

    // Redo rebuilds an empty, RLS-FORCED table and a working function.
    const { rows: rebuilt } = await superuser.query<{
      n: string;
      enabled: boolean;
      forced: boolean;
    }>(
      `SELECT (SELECT count(*)::text FROM public.rate_limit_counters) AS n,
              c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relname = 'rate_limit_counters'`,
    );
    expect(rebuilt[0]?.n).toBe('0');
    expect(rebuilt[0]?.enabled).toBe(true);
    expect(rebuilt[0]?.forced).toBe(true);
    expect((await makeRateLimitRepo(execA).consume(USER_A, 'roundtrip', 1, HOUR)).admitted).toBe(
      true,
    );
  });
});
