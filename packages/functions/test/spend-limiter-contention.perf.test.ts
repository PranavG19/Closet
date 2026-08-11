// Tier-5 SPEND-LIMITER CONTENTION lane (docs/05 Tier-5) — the money path under a
// concurrent burst. The throttle's whole reason to exist is to admit AT MOST `limit`
// paid-provider calls per user+window; the reason it is a DB upsert (migration 0015)
// rather than a read-then-write is that N racers on one counter row must serialize so
// none over-admits (the 0012 lesson — a snapshot-based check-and-increment once let 12
// racers past a cap of 3). This lane measures that serialization has a PRICE that is
// bounded: firing MANY MORE than `limit` calls at ONE (user, bucket) in a single fixed
// window, all contending on one row, the per-call latency must stay cheap.
//
// This is the PERF/CONTENTION angle, deliberately NOT a duplicate of the correctness
// burst in db-spend-limiter.integration.test.ts / rate-limit.repo.integration.test.ts
// (which loop a 12-racer race and assert no over-admit). Those grade correctness once;
// this grades the CLOCK under a wide burst and states an SLO on the throttle's cost.
//
// TWO oracles, neither a handler self-report:
//   1. INDEPENDENT superuser SELECT of the one counter row: request_count == N (every
//      one of the N contending calls incremented — no lost increment under the row
//      lock, no dropped write when connections queue). Combined with the admitted
//      tally, this is the no-over-admit proof from the row itself: a refused call still
//      increments (docs/06), so a correct serialized upsert hands out tickets 1..N and
//      EXACTLY `limit` of them are <= limit. request_count < N would mean lost
//      increments (the snapshot bug); admitted != limit would mean over/under-admit.
//   2. the CLOCK — per-call p95 (nearest-rank, observed) under the burst, gated against
//      a STATED SLO. A deadlock / missing index / serialization pathology on the money
//      path blows far past this; honest queueing on one row stays under it.
//
// RED-FIRST (non-vacuous): a serial baseline on a fresh row is measured too, and the
// burst is asserted to have a MEANINGFULLY higher p95 than serial — if a "concurrent"
// burst timed the same as a serial loop, the contention would be a fiction. Both rows
// print in the rankedTable.
//
// NOT in the gate wall (its own `perf` vitest project, `pnpm test:perf`): sampling
// hundreds of real-Postgres transactions blows the synchronous gate budget (Rule 4).
// VM-gated like every container test — no runtime, no run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { dbSpendLimiter, PARSE_SPEND_BUCKET } from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';
import { measure, measureConcurrent, summarize, rankedTable, type PerfSummary } from '../../db/test/helpers/perf.js';

// Distinct subjects per test so no window bleeds across cases (each is a fresh counter
// row keyed (user_id, scope)); the serial baseline and the burst must not share a row.
const USER_SERIAL = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
const USER_BURST = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';

// The enforced per-user rate cap the burst exceeds. 20 is DEFAULT_PARSE_RATE_LIMIT.
const LIMIT = 20;
// The window is long so the whole burst lands inside ONE fixed window — the boundary
// smear (worst case 2x limit across a window edge, docs/06) is explicitly out of scope;
// this measures single-window contention, so exactly `limit` must be admitted.
const WINDOW_SECONDS = 3600;

// Serial-sample floor and the burst shape. N_BURST is 10x LIMIT so the vast majority
// are refusals contending for the SAME row — the throttle's hot path under abuse (a
// retry loop / stolen token). CONCURRENCY is set ABOVE the pg pool's default max (10)
// deliberately: below it the burst never queues on a connection and the row-lock
// contention is understated. This is the condition that reveals a serialization stall.
const N_SERIAL = 200;
const N_BURST = 200;
const CONCURRENCY = 24;

// NEW SLOs (ground: consume() is ONE indexed upsert on a (user_id, scope) PK, wrapped in
// the tenant executor's BEGIN / SET LOCAL ROLE / set_config / COMMIT). Two regimes,
// because concurrency on a SINGLE hot row legitimately inflates the tail — one number
// would be too loose to catch a serial regression or too tight to allow honest queueing
// (the same split, and the same reason, as api-load.perf.test.ts).
//   serial = the uncontended per-call ground. The upsert itself is single-digit ms
//            (measured p50 ~5-10ms), so the SLO is that cheap cost plus generous headroom
//            for the shared dev VM's scheduling jitter (the committed api-load lane uses
//            this same 150ms serial ceiling for the same reason). A regression toward the
//            ceiling here is a lost PK index or a fn recompile, not contention.
//   burst  = a generous-but-meaningful ceiling: 24 racers exceeding the pool's max (10)
//            each wait behind BOTH a pooled-connection queue AND the counter row's lock,
//            so honest queueing on a loaded VM clears low-hundreds-of-ms (measured p95
//            60-230ms depending on VM load). A deadlock or a serialization stall would
//            blow to SECONDS — orders of magnitude past this, and still caught; a lost
//            index turning the conflict resolution into a scan would too. 600 matches the
//            committed api-load burst ceiling (same substrate, same jitter budget).
const SLO_SERIAL_P95_MS = 150;
const SLO_BURST_P95_MS = 600;

describe('Tier-5 — spend-limiter contention (admit EXACTLY `limit` under a concurrent burst, cheaply)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  const summaries: PerfSummary[] = [];
  // Captured from the serial baseline so the burst can prove its tail is genuinely
  // inflated by contention (red-first, non-vacuous).
  let serialSummary: PerfSummary | undefined;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
  }, 180_000);

  afterAll(async () => {
    if (summaries.length > 0) console.log(rankedTable(summaries));
    await harness?.stop();
  });

  // Independent read of the single counter row for a (user, bucket).
  const readCounter = async (userId: string, scope: string): Promise<{ count: number; rows: number }> => {
    const { rows } = await superuser.query<{ request_count: number }>(
      `SELECT request_count FROM public.rate_limit_counters WHERE user_id = $1 AND scope = $2`,
      [userId, scope],
    );
    return { count: rows[0]?.request_count ?? 0, rows: rows.length };
  };

  // ---- SERIAL BASELINE — per-call cost on a fresh row with nothing contending. -------
  it('serial consume() p95 within SLO — the uncontended throttle cost', async () => {
    const label = 'consume() serial (uncontended)';
    const bucket = `${PARSE_SPEND_BUCKET}-perf-serial`;
    // Limit above the sample count so every call is admitted: latency is identical for
    // admit vs refuse (both are the same upsert), and this keeps the baseline about the
    // statement cost, not about the branch taken.
    const summary = summarize(
      await measure(label, N_SERIAL, () =>
        dbSpendLimiter(makeTenantExecutor(pool, USER_SERIAL)).consume({
          userId: USER_SERIAL,
          bucket,
          limit: N_SERIAL * 10,
          windowSeconds: WINDOW_SECONDS,
        }),
      ),
    );
    summaries.push(summary);
    serialSummary = summary;
    expect(
      summary.p95,
      `${label}: uncontended p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${SLO_SERIAL_P95_MS}ms ` +
        `(p50 ${summary.p50.toFixed(2)} / max ${summary.max.toFixed(2)}). One indexed upsert should be single-digit ms; ` +
        `a regression here is a lost PK index or a fn recompile, not contention.`,
    ).toBeLessThanOrEqual(SLO_SERIAL_P95_MS);
  }, 120_000);

  // ---- CONTENDED BURST — many more than `limit` racers on ONE row, one window. -------
  it('a 24-way burst of 10x-limit calls admits EXACTLY `limit`, loses no increment, and stays within SLO', async () => {
    const label = `consume() burst @${CONCURRENCY} (one row)`;
    const bucket = `${PARSE_SPEND_BUCKET}-perf-burst`;
    // Each op gets its OWN tenant executor => a genuinely separate connection and
    // transaction, so these racers actually contend on the counter row's lock rather
    // than serialising on one shared client.
    const decisions: boolean[] = new Array(N_BURST);
    const { samples, wallMs } = await measureConcurrent(label, N_BURST, CONCURRENCY, async (i) => {
      const decision = await dbSpendLimiter(makeTenantExecutor(pool, USER_BURST)).consume({
        userId: USER_BURST,
        bucket,
        limit: LIMIT,
        windowSeconds: WINDOW_SECONDS,
      });
      decisions[i] = decision.allowed;
    });
    const summary = summarize(samples);
    summaries.push(summary);

    const admitted = decisions.filter((allowed) => allowed).length;

    // Oracle 1a (money): EXACTLY `limit` calls were admitted under the burst — no
    // over-admit (an unmetered vendor bill) and no under-admit (a throttle that starves
    // everyone). This is the property migration 0015's serialized upsert guarantees.
    expect(admitted, `over/under-admit under contention: admitted ${admitted}, expected exactly ${LIMIT}`).toBe(LIMIT);

    // Oracle 1b (INDEPENDENT superuser read): the one counter row holds request_count ==
    // N_BURST — every racer took a distinct ticket, so NO increment was lost to the row
    // lock or to a queued connection. request_count < N_BURST would be the snapshot bug
    // (lost updates) resurfacing; this is graded from the row, never from the decisions.
    const { count, rows } = await readCounter(USER_BURST, bucket);
    expect(rows, 'expected exactly one counter row for the contended (user, bucket)').toBe(1);
    expect(count, `lost increments under contention: request_count ${count}, expected ${N_BURST}`).toBe(N_BURST);

    // Oracle 2 (CLOCK): per-call p95 under the burst within the SLO — a stalled/deadlocked
    // upsert on the hot row would blow far past this.
    const throughput = (N_BURST / wallMs) * 1000;
    console.log(
      `\n[contention] ${label}: ${N_BURST} calls @ ${CONCURRENCY} in-flight on ONE row in ${wallMs.toFixed(0)}ms ` +
        `= ${throughput.toFixed(0)} calls/s; admitted ${admitted}/${LIMIT}; ` +
        `serial p50/p95 ${serialSummary?.p50.toFixed(1)}/${serialSummary?.p95.toFixed(1)} vs ` +
        `burst p50/p95 ${summary.p50.toFixed(1)}/${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms`,
    );
    expect(
      summary.p95,
      `${label}: burst p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${SLO_BURST_P95_MS}ms — a serialization stall on the counter row, not honest queueing.`,
    ).toBeLessThanOrEqual(SLO_BURST_P95_MS);

    // RED-FIRST (non-vacuous): the burst tail MUST be meaningfully higher than the
    // uncontended serial tail. If they were equal the concurrency would be a fiction
    // (a serial loop mislabelled). 24 racers fighting one row cannot cost the same as
    // one racer alone; require the burst p95 to clear the serial p95 by a clear margin.
    const serialP95 = serialSummary?.p95 ?? 0;
    expect(
      summary.p95,
      `burst p95 ${summary.p95.toFixed(2)}ms is not meaningfully above serial p95 ${serialP95.toFixed(2)}ms — ` +
        `the contention is not real (is measureConcurrent actually running ${CONCURRENCY}-wide?).`,
    ).toBeGreaterThan(serialP95 * 1.5);
  }, 120_000);
});
