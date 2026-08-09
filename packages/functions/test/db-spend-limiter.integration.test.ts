// Independent oracle for `dbSpendLimiter` — THE ONLY limiter production actually runs.
//
// WHY THIS FILE EXISTS: a review found that dbSpendLimiter had ZERO test coverage. The repo
// beneath it is well covered (rate-limit.repo.integration.test.ts, including a 25×12 concurrent
// burst against the real 0015 upsert), and the handler above it is covered
// (parse-photo-throttle.integration.test.ts) — but that suite injects an IN-MEMORY FAKE
// limiter. So the adapter joining them was the one unexercised link on the paid-provider spend
// path, and it is precisely the link where a mistake is invisible: the repo speaks Postgres
// (positional args, an `interval` STRING, an `{ admitted }` row) while the handler speaks HTTP
// (windowSeconds as a NUMBER, `{ allowed, retryAfterSeconds }`). Every one of those four
// translations is a place to be silently wrong.
//
// Two of them have already been wrong in this repo's history: the handler was once bound to a
// limiter that threw (500 on every parse), and the repo returned `{ admitted }` where a report
// claimed a bare boolean. Neither was caught by a test — one by tsc, one by reading.
//
// The oracle here is the REAL repo against REAL Postgres under a REAL app_user tenant executor
// (SET LOCAL ROLE app_user + request.jwt.claim.sub, so RLS is genuinely enforced; the container
// superuser BYPASSES RLS and would prove nothing).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { dbSpendLimiter } from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const BUCKET = 'parse';

describe('dbSpendLimiter — the production spend throttle', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // A fresh scope per test so tests cannot bleed into each other's counters.
  const limiterFor = (userId: string) => dbSpendLimiter(makeTenantExecutor(pool, userId));

  it('admits up to the limit and then refuses — the whole point of the throttle', async () => {
    const limiter = limiterFor(USER_A);
    const args = { userId: USER_A, bucket: `${BUCKET}-basic`, limit: 3, windowSeconds: 3600 };

    // Three admits.
    for (let i = 0; i < 3; i += 1) {
      const decision = await limiter.consume(args);
      expect(decision.allowed, `call ${i + 1} of 3 should be admitted`).toBe(true);
      expect(decision.retryAfterSeconds).toBe(0);
    }
    // Fourth refused.
    const refused = await limiter.consume(args);
    expect(refused.allowed).toBe(false);
    // The hint is the window length — the honest upper bound on the wait, since a fixed window
    // cannot tell an individual caller when a slot frees without reading the row back.
    expect(refused.retryAfterSeconds).toBe(3600);
  });

  it('TRANSLATES windowSeconds (a number) into an interval the DB accepts', async () => {
    // The adapter builds `${windowSeconds} seconds` for a `$4::interval` parameter. The
    // observable proof the conversion is right is the persisted window_start: the row exists
    // with a window Postgres actually parsed.
    //
    // MEASURED LIMIT OF THIS TEST, recorded rather than glossed: I mutated the adapter to send
    // `String(windowSeconds)` — dropping the unit — and this suite STAYED GREEN. That is not a
    // coverage gap, it is Postgres being forgiving: I confirmed against the container that
    // `'3600'::interval` and `'3600 seconds'::interval` are BOTH `01:00:00` and compare equal,
    // because a bare number in an interval literal is read as seconds. So the mutant is
    // semantically identical to the original and there is nothing for a test to catch. The unit
    // stays in the adapter for readability, not correctness.
    const limiter = limiterFor(USER_A);
    const bucket = `${BUCKET}-window`;
    await limiter.consume({ userId: USER_A, bucket, limit: 5, windowSeconds: 60 });

    const { rows } = await superuser.query<{ request_count: number; window_start: string }>(
      `SELECT request_count, window_start::text FROM public.rate_limit_counters
       WHERE user_id = $1 AND scope = $2`,
      [USER_A, bucket],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.request_count).toBe(1);
    // A real timestamp, not an epoch-zero artefact of a bad cast.
    expect(new Date(rows[0]!.window_start).getFullYear()).toBeGreaterThan(2020);
  });

  it('is scoped PER USER — B is not throttled by A exhausting the bucket', async () => {
    const bucket = `${BUCKET}-scope`;
    const limitOne = { bucket, limit: 1, windowSeconds: 3600 };

    const a = limiterFor(USER_A);
    expect((await a.consume({ ...limitOne, userId: USER_A })).allowed).toBe(true);
    expect((await a.consume({ ...limitOne, userId: USER_A })).allowed).toBe(false);

    // B's first call must still be admitted. If the counter were global, this would refuse —
    // one user could deny every other user the product's core feature.
    const b = limiterFor(USER_B);
    expect((await b.consume({ ...limitOne, userId: USER_B })).allowed).toBe(true);
  });

  it('is scoped PER BUCKET — exhausting one bucket leaves another open', async () => {
    const limiter = limiterFor(USER_A);
    const base = { userId: USER_A, limit: 1, windowSeconds: 3600 };
    expect((await limiter.consume({ ...base, bucket: 'bucket-x' })).allowed).toBe(true);
    expect((await limiter.consume({ ...base, bucket: 'bucket-x' })).allowed).toBe(false);
    expect((await limiter.consume({ ...base, bucket: 'bucket-y' })).allowed).toBe(true);
  });

  it('a limit of ZERO refuses immediately — a closed gate is representable', async () => {
    // Guards against an off-by-one that would grant one free paid call per window.
    const limiter = limiterFor(USER_A);
    const decision = await limiter.consume({
      userId: USER_A,
      bucket: `${BUCKET}-zero`,
      limit: 0,
      windowSeconds: 3600,
    });
    expect(decision.allowed).toBe(false);
  });

  it('NEVER over-admits under a concurrent burst — the money-path race', async () => {
    // The reason 0015 exists. Under READ COMMITTED a count-then-increment fixes its snapshot
    // BEFORE an in-CTE advisory lock is granted, which once admitted 12 racers against a cap of
    // 3. This asserts the property THROUGH dbSpendLimiter rather than through the repo, because
    // the adapter is what production calls — a correct repo reached by a wrong adapter is still
    // an unmetered vendor bill.
    const LIMIT = 3;
    const RACERS = 12;
    const bucket = `${BUCKET}-burst`;

    // Each racer gets its OWN executor, so these are genuinely separate connections and
    // transactions rather than serialised calls on one client.
    const decisions = await Promise.all(
      Array.from({ length: RACERS }, () =>
        dbSpendLimiter(makeTenantExecutor(pool, USER_A)).consume({
          userId: USER_A,
          bucket,
          limit: LIMIT,
          windowSeconds: 3600,
        }),
      ),
    );

    const admitted = decisions.filter((d) => d.allowed).length;
    expect(admitted).toBeLessThanOrEqual(LIMIT);
    // And it must not under-admit either — a throttle that refuses everyone is also broken.
    expect(admitted).toBe(LIMIT);

    // Independent confirmation from the row itself, not from the return values — and note
    // carefully that the expected count is RACERS, not LIMIT.
    //
    // I initially asserted `request_count <= LIMIT` here and it failed with 12. That was MY
    // test being wrong, not the limiter: every racer takes a DISTINCT ticket (the increment is
    // unconditional) and only the first LIMIT of them get `allowed: true`. A counter that
    // stopped at 3 would mean increments were LOST — the exact snapshot-based bug migration
    // 0015 exists to prevent. So `=== RACERS` is the strong assertion and `<= LIMIT` would
    // have quietly demanded the broken behaviour.
    const { rows } = await superuser.query<{ request_count: number }>(
      `SELECT request_count FROM public.rate_limit_counters WHERE user_id = $1 AND scope = $2`,
      [USER_A, bucket],
    );
    expect(
      rows[0]?.request_count,
      'lost increments — the upsert is not serializing under concurrency',
    ).toBe(RACERS);
  });

  it('a caller cannot write a counter row for ANOTHER user (RLS on the throttle table)', async () => {
    // The throttle writes under the CALLER's own RLS context (0015's policies bind auth.uid()),
    // so a mismatched user_id must be refused by the database rather than quietly consuming
    // someone else's quota.
    const asA = makeTenantExecutor(pool, USER_A);
    await expect(
      dbSpendLimiter(asA).consume({
        userId: USER_B,
        bucket: `${BUCKET}-crosstenant`,
        limit: 5,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow();
  });
});
