// Tier-5 TEASER TIME-TO-FIRST-PREVIEW lane (docs/05 Tier-5). This is the F1 "aha"
// budget — docs/05 calls server wall-clock from a parse-photo submit to the first
// cutout/item ready the single most load-bearing product number, and it was MISSING.
//
// What it measures: the REAL makeParsePhoto handler driven through makeCaller against
// REAL Postgres (RLS as app_user), timed with process.hrtime via the shared perf
// primitive. The two paid providers are FAKE ports whose latency is INJECTED — each of
// vision + cutout `await`s a small CONSTANT sleep (INJECTED_MS) before resolving. The
// transport has no real network in tests, so this is the only way to model the
// ~2s-per-provider assumption (docs/06 §4). We use a SMALL constant (75ms), NOT a real
// 2s, so the lane runs in minutes; the POINT is to prove the server adds BOUNDED
// overhead on top of provider time and degrades to FEWER items rather than hanging —
// not to reproduce a real 2s call. Substituting the real 2s only scales the ceilings
// linearly; the overhead-budget claim is unchanged.
//
// Oracle discipline (docs/05 Tier-5, graded): the CLOCK (observed nearest-rank p95 vs a
// STATED SLO under a NAMED adversarial condition) PLUS an INDEPENDENT superuser state
// read — never the handler's own 200/body. Two regimes:
//
//   1. HAPPY PATH — a single full parse (kind='full', entitlement seeded via superuser
//      so the teaser cap is never the variable), fresh source_photo_hash per submit so
//      every iteration is a real claim→providers→commit (never the done short-circuit).
//      Clock oracle: serial p95 ≤ 2×INJECTED_MS + a serial overhead budget. Independent
//      oracle: superuser COUNT(wardrobe_items) == number of submits — every parse
//      persisted exactly one garment; nothing hung or was lost.
//
//   2. DEGRADED FAN-OUT — a concurrent batch where a chosen subset of provider calls is
//      injected to REJECT (a 5xx/timeout). Clock oracle: burst p95 ≤ 2×INJECTED_MS + a
//      burst overhead budget (loose enough for honest pool queueing, tight enough that a
//      deadlock/hang blows far past it). Independent oracles (exactly chaos §2's shape):
//      superuser COUNT shows FEWER items (== the OK count, not the submit count), and
//      every failed job persisted status='failed', error_reason='provider_failed', ZERO
//      items, and a RELEASED lease (claimed_at IS NULL) — a degraded photo NEVER becomes
//      user-blocking. RED-FIRST non-vacuity: the burst wall-clock is asserted to be far
//      below the serial-equivalent (real overlap happened — the "concurrent" burst is
//      not a serial loop in disguise), and serial vs burst p95 are logged side by side.
//
// NOT in the gate wall — its own `perf` vitest project, run on-demand via
// `pnpm test:perf`. VM-gated like every container test: no runtime, no run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type {
  AIVisionPort,
  AIVisionResult,
  CutoutPort,
  CutoutResult,
} from '@closet/shared';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import { unthrottledSpendLimiter } from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeCaller,
  makeSuperuserExecutor,
  startPg,
  type Caller,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';
import { measure, measureConcurrent, summarize, rankedTable, type PerfSummary } from '../../db/test/helpers/perf.js';

const USER_HAPPY = 'c1c1c1c1-c1c1-42c1-82c1-c1c1c1c1c1c1';
const USER_FANOUT = 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2';

// The injected per-provider latency. A small CONSTANT we control — NOT a real 2s — so
// the lane runs in minutes. vision + cutout are the two SERIAL round-trips a happy
// parse makes, so the provider-time floor of one parse is 2×INJECTED_MS.
const INJECTED_MS = 75;
const N_SERIAL_PROVIDERS = 2; // vision then cutout, awaited in series

// Serial regime: modest sample count so the lane stays minutes on the shared VM.
const N_SERIAL = 40;

// Fan-out regime: a concurrent batch. CONCURRENCY is set ABOVE the pg pool default
// (10) so requests genuinely queue for a connection — below it the "fan-out" never
// contends and the degraded-path timing is a serial loop in disguise.
const FANOUT_TOTAL = 32;
const FANOUT_CONCURRENCY = 16;
const FANOUT_FAIL_COUNT = 4; // provider REJECTS for these; the rest succeed
const FANOUT_OK_COUNT = FANOUT_TOTAL - FANOUT_FAIL_COUNT;

// SLOs (ms), DERIVED from the injected provider floor plus an overhead budget — this is
// what makes the ceiling meaningful rather than arbitrary. The server's job is to add
// BOUNDED overhead on top of provider time; the budget is the bound.
//   serial = provider floor (2×INJECTED) + per-request auth/parse/6-query/commit cost,
//            with slack for VM noise. A regression here is a missing index / N+1 / an
//            extra serial round-trip — NOT noise at this granularity.
const SERIAL_OVERHEAD_BUDGET_MS = 350;
const SLO_SERIAL_P95_MS = N_SERIAL_PROVIDERS * INJECTED_MS + SERIAL_OVERHEAD_BUDGET_MS; // 500
//   burst = the same provider floor + a larger budget that ABSORBS honest pool queueing
//           under a batch exceeding the pool, while a DEADLOCK / hang (which would blow
//           into seconds or exhaust the test timeout) still fails hard.
const BURST_OVERHEAD_BUDGET_MS = 500;
const SLO_BURST_P95_MS = N_SERIAL_PROVIDERS * INJECTED_MS + BURST_OVERHEAD_BUDGET_MS; // 650

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic fake provider results (mirrors chaos.integration.test.ts §2).
const FAKE_VISION: AIVisionResult = {
  category: 'top',
  primaryColor: '#aabbcc',
  secondaryColors: ['#112233'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'all-season',
};
const FAKE_CUTOUT: CutoutResult = {
  imageUrl: 'cutouts/fake.png',
  hasAlpha: true,
  width: 800,
  height: 1200,
};

interface CountingLatentPorts extends ParsePorts {
  visionCalls(): number;
}

// Ports with INJECTED latency and a per-photo failure predicate. vision + cutout each
// sleep INJECTED_MS to model the ~2s-each serial provider round-trip (scaled down).
// When failWhen(imageUrl) matches, vision sleeps THEN rejects — modelling a provider
// that consumes its time budget and then times out/5xxs (the degraded path must absorb
// this as a 502, never a hang). The counter bumps only on a SUCCESSFUL vision call, so
// "was the paid provider actually hit" stays observable — exactly chaos §2's shape.
function makeLatentPorts(failWhen: (imageUrl: string) => boolean): CountingLatentPorts {
  let vision = 0;
  const visionPort: AIVisionPort = {
    async extractAttributes({ imageUrl }) {
      await sleep(INJECTED_MS);
      if (failWhen(imageUrl)) {
        throw new Error('provider timeout — must never hang or leak');
      }
      vision += 1;
      return FAKE_VISION;
    },
  };
  const cutoutPort: CutoutPort = {
    async removeBackground() {
      await sleep(INJECTED_MS);
      return FAKE_CUTOUT;
    },
  };
  return {
    vision: visionPort,
    cutout: cutoutPort,
    mintSourcePhotoUrl: async (objectKey) => `https://storage.test/signed/${objectKey}?token=sig`,
    visionCalls: () => vision,
  };
}

describe('Tier-5 — teaser time-to-first-preview (parse-photo TTFP, injected provider latency)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  const summaries: PerfSummary[] = [];

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);

    // Seed entitlement for BOTH users via the RLS-exempt superuser so kind='full'
    // clears the money gate and the teaser cap is never the variable being measured
    // (chaos §2 uses the identical seed for the same reason).
    for (const user of [USER_HAPPY, USER_FANOUT]) {
      await superuser.query(
        `INSERT INTO public.subscriptions (user_id, entitlement_active, updated_at)
         VALUES ($1, true, now())`,
        [user],
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (summaries.length > 0) console.log(rankedTable(summaries));
    await harness?.stop();
  });

  async function itemsForUser(userId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async function itemsForJob(jobId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE parse_job_id = $1`,
      [jobId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  // ---- REGIME 1: HAPPY-PATH SERIAL TTFP -------------------------------------------
  // A single full parse, timed serially. Every submit carries a FRESH hash so it runs
  // the real claim→vision→cutout→commit path (a repeated hash would hit the done
  // short-circuit and measure the wrong, provider-free path). p95 vs a derived ceiling,
  // and an independent COUNT proving every submit persisted exactly one garment.
  it('single full parse — serial p95 within provider-floor + overhead budget, every submit persisted one item', async () => {
    const label = 'parse-photo TTFP (full, serial)';
    const caller: Caller = makeCaller(pool, USER_HAPPY);
    const ports = makeLatentPorts(() => false);
    const handler = makeParsePhoto(() => ports, unthrottledSpendLimiter);

    // Distinct hash per invocation (incl. measure()'s warmup runs, which also submit),
    // tracked so the independent COUNT oracle knows the exact expected total.
    let submits = 0;
    const statuses: number[] = [];
    const summary = summarize(
      await measure(label, N_SERIAL, async () => {
        submits += 1;
        const res = await caller.call(handler, {
          body: { source_photo_hash: `parse-happy-${submits}`, kind: 'full' },
        });
        statuses.push(res.status);
        await res.json();
      }),
    );
    summaries.push(summary);

    // Every submit was a real success (no 402/409/502 leaked into the timing).
    expect(statuses.every((s) => s === 200), `non-200 in serial regime: ${[...new Set(statuses)].join(',')}`).toBe(true);
    expect(statuses.length).toBe(submits);

    // INDEPENDENT ORACLE (superuser, RLS-exempt): exactly one persisted garment per
    // submit — the full stack committed every parse; nothing hung, nothing was lost.
    expect(await itemsForUser(USER_HAPPY), 'a full parse did not persist exactly one item per submit').toBe(submits);
    expect(ports.visionCalls()).toBe(submits);

    // CLOCK ORACLE: serial p95 within the derived ceiling.
    console.log(
      `\n[ttfp] ${label}: n=${summary.n} p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms ` +
        `(provider floor ${N_SERIAL_PROVIDERS * INJECTED_MS}ms, SLO ${SLO_SERIAL_P95_MS}ms)`,
    );
    expect(
      summary.p95,
      `${label}: p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${SLO_SERIAL_P95_MS}ms ` +
        `(provider floor ${N_SERIAL_PROVIDERS * INJECTED_MS}ms + budget ${SERIAL_OVERHEAD_BUDGET_MS}ms). ` +
        `The server is adding UNBOUNDED overhead on top of provider time — an extra serial round-trip / N+1 / missing index. Investigate before relaxing.`,
    ).toBeLessThanOrEqual(SLO_SERIAL_P95_MS);
  }, 120_000);

  // ---- REGIME 2: DEGRADED FAN-OUT --------------------------------------------------
  // A concurrent batch where FANOUT_FAIL_COUNT provider calls are injected to reject.
  // The batch must still return within a ceiling (never hang), degrade to FEWER items,
  // and leave each failed job as a clean, re-claimable failed row (chaos §2 shape).
  it('degraded fan-out — batch returns within burst SLO, fewer items, failed jobs clean & non-blocking', async () => {
    const label = 'parse-photo TTFP (full, fan-out @16, 4 provider failures)';
    const caller: Caller = makeCaller(pool, USER_FANOUT);
    // Provider rejects when the minted URL (which embeds the server-derived object key,
    // which embeds the source_photo_hash) contains 'FAIL' — the hash is the only
    // caller-chosen discriminator (chaos §2 uses the same technique).
    const ports = makeLatentPorts((imageUrl) => imageUrl.includes('FAIL'));
    const handler = makeParsePhoto(() => ports, unthrottledSpendLimiter);

    // First FANOUT_FAIL_COUNT bodies are the doomed ones. Distinct hashes throughout.
    const bodies = Array.from({ length: FANOUT_TOTAL }, (_unused, i) =>
      i < FANOUT_FAIL_COUNT
        ? { source_photo_hash: `parse-FAIL-${i}`, kind: 'full' as const }
        : { source_photo_hash: `parse-ok-${i}`, kind: 'full' as const },
    );

    const statuses: number[] = new Array(FANOUT_TOTAL);
    const { samples, wallMs } = await measureConcurrent(label, FANOUT_TOTAL, FANOUT_CONCURRENCY, async (i) => {
      const res = await caller.call(handler, { body: bodies[i]! });
      statuses[i] = res.status;
      await res.json();
    });
    const summary = summarize(samples);
    summaries.push(summary);

    // Handler-status sanity (NOT the graded oracle): OK photos 200, doomed photos 502.
    // Promise.all/pool resolving at all is itself the "never a dangling promise" proof.
    for (let i = 0; i < FANOUT_TOTAL; i += 1) {
      expect(statuses[i], `photo ${i} (${bodies[i]!.source_photo_hash}) status`).toBe(i < FANOUT_FAIL_COUNT ? 502 : 200);
    }
    // The paid provider was hit exactly once per OK photo, zero times for the doomed
    // ones (they rejected before the success counter bumped) — no double-charge.
    expect(ports.visionCalls()).toBe(FANOUT_OK_COUNT);

    // INDEPENDENT ORACLE #1 (superuser COUNT): FEWER items than submits — exactly the
    // OK count. The degraded path reveals fewer garments, never a hang, never a partial.
    expect(await itemsForUser(USER_FANOUT), 'degraded fan-out did not degrade to exactly the OK-count of items').toBe(
      FANOUT_OK_COUNT,
    );

    // INDEPENDENT ORACLE #2 (superuser SELECT, chaos §2 shape): every doomed job is a
    // CLEAN failed row — status='failed', fixed non-PII reason, ZERO items, and a
    // RELEASED lease (claimed_at IS NULL). A leaked lease would strand the photo behind
    // the crash-lease and 409 the user on a job nobody is parsing — i.e. user-blocking.
    const failed = await superuser.query<{
      id: string;
      status: string;
      error_reason: string | null;
      claimed_at: string | null;
    }>(
      `SELECT id, status, error_reason, claimed_at FROM public.parse_jobs
       WHERE user_id = $1 AND source_photo_hash LIKE 'parse-FAIL-%'
       ORDER BY source_photo_hash`,
      [USER_FANOUT],
    );
    expect(failed.rows).toHaveLength(FANOUT_FAIL_COUNT);
    for (const job of failed.rows) {
      expect(job.status).toBe('failed');
      expect(job.error_reason).toBe('provider_failed');
      expect(job.claimed_at, 'a failed job leaked its lease — the photo is stuck / user-blocking').toBeNull();
      expect(await itemsForJob(job.id), 'a failed job left partial garbage items').toBe(0);
    }

    // RED-FIRST NON-VACUITY: prove the "concurrent" burst genuinely overlapped and is
    // not a serial loop in disguise. A serial run of this batch would take at least
    // (OK×2 + FAIL×1)×INJECTED_MS of provider sleep alone; the concurrent wall must be
    // FAR below that. If it weren't, the burst p95 below would be measuring nothing new.
    const serialEquivalentMs = (FANOUT_OK_COUNT * N_SERIAL_PROVIDERS + FANOUT_FAIL_COUNT) * INJECTED_MS;
    const serialP95 = summaries[0]?.p95 ?? NaN; // regime 1 ran first
    console.log(
      `\n[ttfp] ${label}: ${FANOUT_TOTAL} parses @ ${FANOUT_CONCURRENCY} in-flight in ${wallMs.toFixed(0)}ms ` +
        `(serial-equivalent provider sleep ≥ ${serialEquivalentMs}ms — overlap ${(serialEquivalentMs / wallMs).toFixed(1)}×); ` +
        `burst p50 ${summary.p50.toFixed(1)} / p95 ${summary.p95.toFixed(1)} / max ${summary.max.toFixed(1)} ms ` +
        `vs serial p95 ${serialP95.toFixed(1)} ms (SLO ${SLO_BURST_P95_MS}ms)`,
    );
    expect(
      wallMs,
      `fan-out wall ${wallMs.toFixed(0)}ms ≈ serial-equivalent ${serialEquivalentMs}ms — the burst did NOT overlap; the concurrency is fake and the burst p95 is vacuous`,
    ).toBeLessThan(serialEquivalentMs / 2);
    // NB: burst p95 is NOT asserted higher than serial p95 here — and deliberately so.
    // The tenant executor releases its pooled connection during the injected provider
    // sleeps, so the dominant cost (the sleep) parallelises cleanly on the event loop
    // rather than queueing on the pool; the burst tail is legitimately ≈ serial, not
    // meaningfully higher. The non-vacuity of "the concurrency is real" is therefore
    // carried by the WALL-CLOCK overlap gate above (32 parses finishing far faster than
    // a serial run could), not by an inflated per-request tail. Both p95s are logged.

    // CLOCK ORACLE: burst p95 within the derived ceiling — a deadlock/hang blows past it.
    expect(
      summary.p95,
      `${label}: burst p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${SLO_BURST_P95_MS}ms — a stuck/serialised/deadlocked batch, not honest queueing.`,
    ).toBeLessThanOrEqual(SLO_BURST_P95_MS);
  }, 120_000);
});
