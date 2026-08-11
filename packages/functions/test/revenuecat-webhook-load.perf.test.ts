// Tier-5 WEBHOOK-APPLY LOAD lane (docs/05 Tier-5) — the MONEY path under concurrency.
// The revenuecat-webhook is the SOLE writer of subscriptions.entitlement_active, and it
// does its dedup + entitlement write in ONE transaction (migration 0016's
// apply_webhook_event) over the service_role seam (makeServiceExecutor → one pool
// connection per query()). The integration/chaos suites prove exactly-once holds
// SEQUENTIALLY and for a small in-flight burst; this lane proves the one-tx apply holds
// a latency budget AND converges exactly-once while a burst EXCEEDS the connection pool
// (default max 10) — the condition that reveals a serialization/deadlock pathology on
// the money write, which a serial loop never creates.
//
// The oracle is NEVER the handler's own {applied:true} body (that is a mirror — docs/05).
// Every assertion ends in an INDEPENDENT superuser SELECT/COUNT against the real
// subscriptions + webhook_events tables:
//   1. DISTINCT-user burst — each op is a fresh appUserId (uuid) + unique event id, so
//      no two ops touch the same row (no lock contention by construction; pure pool
//      contention). Clock oracle: per-apply p95 ≤ SLO. State oracle: a superuser COUNT
//      confirms EVERY user's entitlement landed (no apply lost to queueing under load).
//   2. REPLAY/DUP burst — the SAME event id fired many times concurrently. Here the
//      losers BLOCK on the webhook_events PK, so this is the money path's real
//      contention. State oracle: EXACTLY ONE ledger row + entitlement flipped ONCE —
//      exactly-once under contention, not just sequentially.
//
// RED-FIRST non-vacuity: a serial baseline is measured first; the burst must show real
// overlap (burst wall-clock << the summed per-op latency) or the "concurrent" claim is a
// serial loop in disguise. Both are logged; the speedup is asserted.
//
// NOT in the gate wall — its own `perf` vitest project, `pnpm test:perf`. VM-gated like
// every container test: no runtime, no run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makeServiceExecutor, type Sql } from '../src/auth/executor.js';
import { makeRevenueCatWebhook } from '../src/billing/revenuecat-webhook.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';
import { makeEvent } from './fixtures/revenuecat-events.js';
import { measure, measureConcurrent, summarize, rankedTable, type PerfSummary } from '../../db/test/helpers/perf.js';

const SHARED_KEY_FIXTURE = 'rc-webhook-shared-secret-known-to-the-test';

// A real RC event timestamp (ms). Fixed across the run — the monotonic guard is not what
// this lane measures; distinct event ids / users keep each apply a genuine fresh write.
const EVENT_TS_MS = 1_700_000_000_000;
const EXPIRES_AT_MS = 1_800_000_000_000;

// Serial-sample floor: the per-apply cost with nothing contending (regression floor).
const N_SERIAL = 80;
// Concurrent burst: total applies and how many are in flight at once. CONCURRENCY is set
// ABOVE the pg pool's default max (10) deliberately — below it the burst never queues for
// a connection and the "under load" measurement is a serial loop. This is what reveals
// pool contention on the money write.
const N_BURST = 240;
const CONCURRENCY = 24;
// Replay/dup burst: the SAME id delivered this many times at once. The losers block on
// the webhook_events PK, so this is the contention the exactly-once guarantee must survive.
const N_DUP = 64;

// DB-only p95 SLOs (ms). The webhook is not a full HTTP stack (no withAuth/JWKS) — it is
// parse + ONE plpgsql apply in one tx, so the budget is tighter than the api-load lane's.
//   serial = single-apply cost, nothing contending (regression floor).
//   burst  = the NEW money-path SLO under a pool-exceeding burst: generous enough that
//            honest connection queueing passes, tight enough that a serialized/deadlocked
//            apply (which would stack far past this) fails.
const SLO_SERIAL_P95_MS = 120;
const SLO_BURST_P95_MS = 200;
// The dup burst contends on the PK (losers wait for the winner's row to resolve), so its
// tail is legitimately higher than the distinct-user burst — a looser ceiling that still
// catches a deadlock on the dedup path.
const SLO_DUP_P95_MS = 300;

// Deterministic, schema-valid v4 uuids from an index. app_user_id is validated as Uuid at
// the boundary, so a bare counter will not do — this pins the version (4) and variant (8)
// nibbles and packs the index into the node field. Distinct `prefix` keeps each scenario's
// rows in its own namespace for the independent COUNT.
function uuidForIndex(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
const DISTINCT_PREFIX = 'dead0000'; // burst users: dead0000-...
const DUP_PREFIX = 'beef0000'; // the single replayed user

function postWebhook(body: unknown, secret: string): Request {
  return new Request('https://test.local/revenuecat-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: secret },
    body: JSON.stringify(body),
  });
}

// The service_role seam exactly as the chaos/integration oracles wire it: makeServiceExecutor
// over a thin pg-Pool binding. Each query() takes its OWN pool connection, so a burst wider
// than the pool queues for connections — the contention this lane exists to measure.
function poolAsSql(pool: Pool): Sql {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row = unknown>(sql: string, params?: readonly unknown[]) {
          const res = await client.query(sql, params ? [...params] : undefined);
          return { rows: res.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
  };
}

describe('Tier-5 — webhook apply latency + exactly-once under a pool-exceeding burst', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  let webhook: (req: Request) => Promise<Response>;
  const summaries: PerfSummary[] = [];

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
    // A fresh service executor per request (makeExec factory) — matching production's
    // per-request executor lifetime, so each apply competes for a pool connection.
    webhook = makeRevenueCatWebhook({
      makeExec: () => makeServiceExecutor(poolAsSql(pool)),
      secret: SHARED_KEY_FIXTURE,
      newCorrelationId: () => 'test-correlation',
    });
  }, 180_000);

  afterAll(async () => {
    if (summaries.length > 0) console.log(rankedTable(summaries));
    await harness?.stop();
  });

  // Independent oracles (superuser = RLS-exempt confirmation of the money write).
  async function countActiveWithPrefix(prefix: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions
       WHERE entitlement_active = true AND user_id::text LIKE $1`,
      [`${prefix}-%`],
    );
    return Number(rows[0]!.n);
  }

  async function countLedger(eventId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = $1`,
      [eventId],
    );
    return Number(rows[0]!.n);
  }

  async function countSubsForUser(userId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]!.n);
  }

  // ---- SERIAL BASELINE — single-apply cost with nothing contending. Each op is a fresh
  // user + event id (a genuine INITIAL_PURCHASE apply, never a dedup no-op). ----------
  let serialSummary: PerfSummary | undefined;
  it('single INITIAL_PURCHASE apply — serial p95 within the DB-only SLO', async () => {
    const label = 'RC apply (INITIAL_PURCHASE, serial)';
    let seq = 0;
    const samples = await measure(label, N_SERIAL, async () => {
      const i = (seq += 1);
      const fixture = makeEvent({
        id: `perf-serial-${i}`,
        type: 'INITIAL_PURCHASE',
        appUserId: uuidForIndex('cafe0000', i),
        eventTimestampMs: EVENT_TS_MS,
        expirationAtMs: EXPIRES_AT_MS,
      });
      const res = await webhook(postWebhook(fixture, SHARED_KEY_FIXTURE));
      if (res.status !== 200) throw new Error(`serial apply returned ${res.status}`);
    });
    serialSummary = summarize(samples);
    summaries.push(serialSummary);
    expect(
      serialSummary.p95,
      `${label}: DB-only p95 ${serialSummary.p95.toFixed(2)}ms exceeds SLO ${SLO_SERIAL_P95_MS}ms ` +
        `(p50 ${serialSummary.p50.toFixed(2)} / max ${serialSummary.max.toFixed(2)}).`,
    ).toBeLessThanOrEqual(SLO_SERIAL_P95_MS);
  }, 120_000);

  // ---- DISTINCT-USER BURST — N applies, each a fresh user + event id, CONCURRENCY in
  // flight (> pool max). No two ops touch the same row: pure pool contention, no lock
  // contention. p95 ≤ the NEW money SLO, and the independent COUNT proves EVERY user's
  // entitlement landed (no apply lost to queueing under load). ------------------------
  it('distinct-user burst (240 @ 24 in-flight) — per-apply p95 within SLO, EVERY entitlement landed', async () => {
    const label = 'RC apply (distinct users) @24';
    const statuses: number[] = new Array(N_BURST);
    const { samples, wallMs } = await measureConcurrent(label, N_BURST, CONCURRENCY, async (i) => {
      const fixture = makeEvent({
        id: `perf-distinct-${i}`,
        type: 'INITIAL_PURCHASE',
        appUserId: uuidForIndex(DISTINCT_PREFIX, i),
        eventTimestampMs: EVENT_TS_MS,
        expirationAtMs: EXPIRES_AT_MS,
      });
      const res = await webhook(postWebhook(fixture, SHARED_KEY_FIXTURE));
      statuses[i] = res.status;
    });
    const summary = summarize(samples);
    summaries.push(summary);

    // Non-vacuity: prove the burst actually ran concurrently. The summed per-op latency is
    // what a serial loop would take; real overlap means the wall-clock is far below it. If
    // these were equal the "concurrency" would be a serial loop and the tail meaningless.
    const summedMs = samples.reduce((acc, s) => acc + s.ms, 0);
    const throughput = (N_BURST / wallMs) * 1000;
    const serialP50 = serialSummary?.p50 ?? NaN;
    console.log(
      `\n[load] ${label}: ${N_BURST} applies @ ${CONCURRENCY} in-flight in ${wallMs.toFixed(0)}ms ` +
        `= ${throughput.toFixed(0)} applies/s; serialΣ=${summedMs.toFixed(0)}ms (speedup ${(summedMs / wallMs).toFixed(1)}x); ` +
        `serial p50 ${serialP50.toFixed(1)} vs burst p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms`,
    );
    expect(
      wallMs,
      `burst wall ${wallMs.toFixed(0)}ms is not meaningfully below the summed per-op latency ` +
        `${summedMs.toFixed(0)}ms — the ops did not overlap, so this "concurrent" burst is a serial loop.`,
    ).toBeLessThan(summedMs * 0.6);

    // Clock oracle: p95 under the money-path burst SLO — catches a serialized/deadlocked
    // apply, which would stack far past this, while allowing honest connection queueing.
    expect(
      summary.p95,
      `${label}: burst p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${SLO_BURST_P95_MS}ms — a serialized/deadlocked apply.`,
    ).toBeLessThanOrEqual(SLO_BURST_P95_MS);

    // (cheap) every delivery acknowledged — a pool-exhaustion bug would 5xx.
    expect(statuses.every((s) => s === 200), `some deliveries were not 200: ${[...new Set(statuses)].join(',')}`).toBe(true);

    // STATE ORACLE (independent superuser COUNT): all N distinct users got entitlement.
    // A lost apply under contention would show fewer than N active rows.
    expect(
      await countActiveWithPrefix(DISTINCT_PREFIX),
      'an entitlement apply was lost under the concurrent burst',
    ).toBe(N_BURST);
  }, 120_000);

  // ---- REPLAY/DUP BURST — the SAME event id delivered N_DUP times at once. The losers
  // block on the webhook_events PK, so this is the money path's real contention. The clock
  // is a guard (a deadlock would blow the SLO); the LOAD-BEARING oracle is exactly-once:
  // one ledger row, one entitlement flip — under contention, not just sequentially. ----
  it('replay burst (64 concurrent deliveries of ONE id) — EXACTLY ONE ledger row, entitlement flipped ONCE', async () => {
    const label = 'RC apply (same id, replay) @64';
    const dupEventId = 'perf-dup-1';
    const dupUser = uuidForIndex(DUP_PREFIX, 1);
    const fixture = makeEvent({
      id: dupEventId,
      type: 'INITIAL_PURCHASE',
      appUserId: dupUser,
      eventTimestampMs: EVENT_TS_MS,
      expirationAtMs: EXPIRES_AT_MS,
    });

    const statuses: number[] = new Array(N_DUP);
    const { samples, wallMs } = await measureConcurrent(label, N_DUP, N_DUP, async (i) => {
      const res = await webhook(postWebhook(fixture, SHARED_KEY_FIXTURE));
      statuses[i] = res.status;
    });
    const summary = summarize(samples);
    summaries.push(summary);

    const throughput = (N_DUP / wallMs) * 1000;
    console.log(
      `\n[load] ${label}: ${N_DUP} concurrent deliveries of one id in ${wallMs.toFixed(0)}ms ` +
        `= ${throughput.toFixed(0)} req/s; p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms`,
    );

    // Every racer resolved (blocked on the PK, then saw the conflict) — none deadlocked/5xx'd.
    expect(statuses.every((s) => s === 200), `some deliveries were not 200: ${[...new Set(statuses)].join(',')}`).toBe(true);

    // THE EXACTLY-ONCE LAW, by independent SELECT: the ledger recorded the id ONCE and there
    // is exactly ONE subscription row, entitlement active — 64 simultaneous deliveries
    // collapsed to a single change. This is the claim the sequential replay test does NOT
    // make: exactly-once holds UNDER contention on the dedup PK.
    expect(await countLedger(dupEventId), 'the replayed id was recorded more than once under contention').toBe(1);
    expect(await countSubsForUser(dupUser), 'the concurrent replay created more than one subscription row').toBe(1);
    expect(await countActiveWithPrefix(DUP_PREFIX), 'entitlement did not flip exactly once for the replayed user').toBe(1);

    // Clock guard: even the contended dedup path stays under a generous ceiling — a deadlock
    // on the PK wait would blow far past this.
    expect(
      summary.p95,
      `${label}: replay-burst p95 ${summary.p95.toFixed(2)}ms exceeds ${SLO_DUP_P95_MS}ms — a deadlock on the dedup PK.`,
    ).toBeLessThanOrEqual(SLO_DUP_P95_MS);
  }, 120_000);
});
