// Tier-5 API LOAD lane (docs/05 Tier-5) — FULL-STACK handler latency, serially and
// under a concurrent burst. This is the "if it's an API we need load tests / benchmark
// to a requirement" leg the DB-only perf lane cannot cover: repos.perf.test.ts times
// bare repo calls, so it excludes withAuth (verify → executor), parseBoundary on the
// request AND the response, JSON (de)serialisation, and — the part a load test exists
// for — connection-pool contention when more requests are in flight than the pool has
// connections. Driven through the REAL withAuth via the shared harness caller (bearer
// token IS the verified sub), against REAL Postgres with RLS enforced as app_user.
//
// TWO independent oracles, neither self-reported by the handler:
//   1. the CLOCK — process.hrtime per request (measure / measureConcurrent), gated
//      against an SLO. A regression here is a missing index / N+1 / serialisation
//      pathology, not noise.
//   2. an independent superuser COUNT after the write burst — proving the full stack
//      persisted EVERY distinct-client_id write under contention (no lost write, no
//      dropped row when the pool queues). This is the throughput-integrity claim the
//      chaos suite's same-client_id dedup test does NOT make.
//
// NOT in the gate wall (its own `perf` vitest project, nightly / `pnpm test:perf`):
// sampling N full-stack calls blows the synchronous p95<90s budget (Rule 4). VM-gated
// like every container test — no runtime, no run.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { makeWardrobeRepo, MAX_PAGE_SIZE } from '@closet/db';
import { listWardrobe } from '../src/wardrobe/list.js';
import { logWear } from '../src/wear-log/log-wear.js';
import {
  applyMigrations,
  makeCaller,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type Caller,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';
import { measure, measureConcurrent, summarize, rankedTable, type PerfSummary } from '../../db/test/helpers/perf.js';

const USER = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
// Serial-sample floor (docs/05 Tier-5). Modest so the lane stays minutes on the shared VM.
const N_SERIAL = 200;
// Concurrent burst: total requests and how many are in flight at once. CONCURRENCY is
// set ABOVE the pg pool's default max (10) deliberately — below it the burst never
// queues and the "under load" measurement is a serial loop in disguise. This is the
// condition that reveals pool contention.
const N_BURST = 300;
const CONCURRENCY = 24;
// A populated wardrobe past one page so the list read is not a toy scan.
const SEED_ITEMS = MAX_PAGE_SIZE * 3;

// Full-stack p95 SLOs (ms). Two regimes because concurrency legitimately inflates the
// tail (requests queue for a pooled connection) — a single SLO would either be too
// loose to catch a serial regression or too tight to allow honest queueing.
//   serial  = the per-request cost with nothing contending (regression floor).
//   burst   = generous ceiling that still catches a DEADLOCK / serialisation pathology
//             (a stuck burst would blow well past this), not a tight latency target.
const SLO_SERIAL_P95_MS: Record<string, number> = {
  'GET /wardrobe (full page)': 150,
  'POST /wear-log (append+flip)': 150,
};
const SLO_BURST_P95_MS: Record<string, number> = {
  'GET /wardrobe (full page) @24': 600,
  'POST /wear-log (append+flip) @24': 600,
};

describe('Tier-5 — full-stack API latency + load (real Postgres, real withAuth)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  let caller: Caller;
  let seededItemId = '';
  const summaries: PerfSummary[] = [];

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
    caller = makeCaller(pool, USER);

    // Seed a populated wardrobe once, sequentially (pool pressure during seeding would
    // distort the container's warm state before measurement).
    const exec = makeTenantExecutor(pool, USER);
    const wardrobe = makeWardrobeRepo(exec);
    const categories = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] as const;
    for (let i = 0; i < SEED_ITEMS; i += 1) {
      const item = await wardrobe.create(USER, { category: categories[i % categories.length]! });
      if (i === 0) seededItemId = item.id;
    }
  }, 180_000);

  afterAll(async () => {
    if (summaries.length > 0) console.log(rankedTable(summaries));
    await harness?.stop();
  });

  // ---- SERIAL BASELINE — full-stack per-request cost with nothing contending. -------
  it('GET /wardrobe (full page) — serial p95 within SLO', async () => {
    const label = 'GET /wardrobe (full page)';
    const summary = summarize(
      await measure(label, N_SERIAL, () => caller.call(listWardrobe, { query: `?limit=${MAX_PAGE_SIZE}` })),
    );
    summaries.push(summary);
    const slo = SLO_SERIAL_P95_MS[label]!;
    expect(
      summary.p95,
      `${label}: full-stack p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${slo}ms ` +
        `(p50 ${summary.p50.toFixed(2)} / max ${summary.max.toFixed(2)}). A regression vs the DB-only ` +
        `lane isolates the auth/parse/serialize overhead — investigate before relaxing.`,
    ).toBeLessThanOrEqual(slo);
  }, 120_000);

  it('POST /wear-log (append+flip) — serial p95 within SLO', async () => {
    const label = 'POST /wear-log (append+flip)';
    // Fresh client_id per run so each iteration is a real INSERT+flip, not an
    // ON-CONFLICT re-read of the first row (which measures the wrong, faster path).
    let seq = 0;
    const summary = summarize(
      await measure(label, N_SERIAL, () =>
        caller.call(logWear, {
          body: { item_id: seededItemId, client_id: `load-serial-${(seq += 1)}` },
          query: '?flip=dirty',
        }),
      ),
    );
    summaries.push(summary);
    const slo = SLO_SERIAL_P95_MS[label]!;
    expect(
      summary.p95,
      `${label}: full-stack p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${slo}ms ` +
        `(p50 ${summary.p50.toFixed(2)} / max ${summary.max.toFixed(2)}).`,
    ).toBeLessThanOrEqual(slo);
  }, 120_000);

  // ---- INSTRUMENT ACCURACY — the emitted request-log durationMs must track a clock the
  // log line cannot see. The metrics-logging wave (withAuth request line) is only useful if
  // its reported durationMs is TRUE; a self-emitted number graded against itself is a mirror.
  // Here the harness's process.hrtime wall-clock (measure()) is the external oracle: we run
  // the same serial GET, capture every `request` log line the wrapper emits through the
  // console sink, and assert the logged-p50 sits within a tolerance of the harness-measured
  // p50. This proves the INSTRUMENT is accurate, not just that the path is fast.
  it('the withAuth request-log durationMs tracks the harness wall-clock (instrument accuracy)', async () => {
    const logged: number[] = [];
    const spy = vi
      .spyOn((globalThis as { console: { log: (s: string) => void } }).console, 'log')
      .mockImplementation((line: string) => {
        try {
          const parsed = JSON.parse(line) as { event?: string; durationMs?: number };
          if (parsed.event === 'request' && typeof parsed.durationMs === 'number') logged.push(parsed.durationMs);
        } catch {
          /* non-JSON console line — ignore */
        }
      });
    let harnessSamples: number[];
    try {
      harnessSamples = await measure('instrument-accuracy GET', 60, () =>
        caller.call(listWardrobe, { query: `?limit=${MAX_PAGE_SIZE}` }),
      );
    } finally {
      spy.mockRestore();
    }

    // At least one request line per measured call (measure() may add warmup iterations that
    // also emit a line but aren't in the returned sample set — so >=, not exact equality).
    expect(logged.length).toBeGreaterThanOrEqual(harnessSamples.length);
    // `logged` is raw numbers (durationMs from the log lines); summarize() takes Sample[],
    // so compute the logged median directly. The harness samples ARE Sample[].
    const median = (xs: readonly number[]): number => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) / 2)]!;
    };
    const loggedP50 = median(logged);
    const harnessP50 = summarize(harnessSamples).p50;
    // The logged duration measures ONLY inside withAuth (handler run), the harness clock
    // wraps the whole caller.call incl. request build + JSON. So logged ≤ harness, and the
    // two should be within a few ms of each other on the same fast read — a wildly different
    // logged number (0, or 10× the wall-clock) would mean the instrument is lying.
    expect(loggedP50).toBeGreaterThan(0);
    // logged (handler-only) ≤ harness (whole call) + small scheduling tolerance.
    expect(loggedP50).toBeLessThanOrEqual(harnessP50 + 2);
    // And it must be a real fraction of the wall-clock, not a near-zero stub: the handler
    // is the bulk of the serial cost, so the logged duration is at least half the harness's.
    expect(loggedP50).toBeGreaterThanOrEqual(harnessP50 * 0.4);
    console.log(`\n[instrument] request-log p50 ${loggedP50.toFixed(2)}ms vs harness p50 ${harnessP50.toFixed(2)}ms`);
  }, 120_000);

  // ---- CONCURRENT LOAD — burst exceeding the pool, latency AND persisted-write oracle.
  it('GET /wardrobe under a 24-way burst — every request 200, p95 within burst SLO, throughput logged', async () => {
    const label = 'GET /wardrobe (full page) @24';
    const statuses: number[] = new Array(N_BURST);
    const { samples, wallMs } = await measureConcurrent(label, N_BURST, CONCURRENCY, async (i) => {
      const res = await caller.call(listWardrobe, { query: `?limit=${MAX_PAGE_SIZE}` });
      statuses[i] = res.status;
      await res.json(); // drain the body — full cost incl. deserialisation
    });
    const summary = summarize(samples);
    summaries.push(summary);

    // Oracle 1: no request errored under contention (a pool-exhaustion bug would 5xx).
    expect(statuses.every((s) => s === 200), `some requests were not 200: ${[...new Set(statuses)].join(',')}`).toBe(true);
    // Oracle 2 (clock): p95 under the burst ceiling — catches a deadlock/serialisation
    // pathology, which would blow far past this, while allowing honest queueing.
    const slo = SLO_BURST_P95_MS[label]!;
    const throughput = (N_BURST / wallMs) * 1000;
    console.log(
      `\n[load] ${label}: ${N_BURST} reqs @ ${CONCURRENCY} in-flight in ${wallMs.toFixed(0)}ms ` +
        `= ${throughput.toFixed(0)} req/s; p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms`,
    );
    expect(summary.p95, `${label}: burst p95 ${summary.p95.toFixed(2)}ms exceeds ${slo}ms — a stuck/serialised burst.`).toBeLessThanOrEqual(slo);
  }, 120_000);

  it('POST /wear-log under a 24-way burst (distinct client_ids) — ALL persist, no lost write under contention', async () => {
    const label = 'POST /wear-log (append+flip) @24';
    const tag = 'load-burst';
    const statuses: number[] = new Array(N_BURST);
    // Each request carries a DISTINCT client_id, so the partial-UNIQUE never dedups —
    // every one is a genuine INSERT. Under a burst exceeding the pool, the throughput-
    // integrity claim is that ALL N rows land (no write lost to queueing/contention).
    const { samples, wallMs } = await measureConcurrent(label, N_BURST, CONCURRENCY, async (i) => {
      const res = await caller.call(logWear, {
        body: { item_id: seededItemId, client_id: `${tag}-${i}` },
        query: '?flip=dirty',
      });
      statuses[i] = res.status;
      await res.json();
    });
    const summary = summarize(samples);
    summaries.push(summary);

    expect(statuses.every((s) => s === 200), `some requests were not 200: ${[...new Set(statuses)].join(',')}`).toBe(true);

    // Oracle 2 (independent superuser COUNT): EXACTLY N_BURST distinct-client rows
    // persisted — the full stack dropped nothing under contention. This is the load
    // integrity guarantee, graded by a SELECT the handler never touches.
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id LIKE $2`,
      [USER, `${tag}-%`],
    );
    expect(Number(rows[0]!.n), 'a distinct-client_id write was lost under the concurrent burst').toBe(N_BURST);

    const slo = SLO_BURST_P95_MS[label]!;
    const throughput = (N_BURST / wallMs) * 1000;
    console.log(
      `\n[load] ${label}: ${N_BURST} reqs @ ${CONCURRENCY} in-flight in ${wallMs.toFixed(0)}ms ` +
        `= ${throughput.toFixed(0)} req/s; p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms`,
    );
    expect(summary.p95, `${label}: burst p95 ${summary.p95.toFixed(2)}ms exceeds ${slo}ms.`).toBeLessThanOrEqual(slo);
  }, 120_000);
});
