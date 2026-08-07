// Tier-4 CHAOS + LOAD gauntlet (docs/05 Tier-4). The oracle is REAL persisted
// state under adversarial temporal/scale conditions the happy-path never creates —
// NEVER the handler's own status/body. Every assertion ends in a fresh independent
// SELECT: the victim tenant reads under RLS (makeTenantExecutor SETs LOCAL ROLE
// app_user), and the RLS-exempt superuser is used ONLY as the independent control
// that confirms rows exist / does the cross-owner count. Fan-out concurrency is
// modelled in-process with Promise.all + fake ports (no external load harness);
// timeouts are fake ports that reject.
//
// Four chaos surfaces:
//   1. Webhook temporal chaos (real revenueCatWebhook + real committed RC fixture):
//      replay-dedup, out-of-order delivery, late-arrival — the monotonic guard.
//   2. Parse fan-out degraded path: a batch where some provider calls throw →
//      fewer items (never a hang), failed jobs re-claimable, done jobs short-circuit,
//      NO duplicate garments across the batch.
//   3. Offline/jitter idempotency (F8): CONCURRENT retries with the SAME caller-
//      minted client_id → EXACTLY ONE wear row (partial-UNIQUE dedup), flip once.
//   4. Weather degraded path: a WeatherPort that throws/times out → the real pure
//      suggestItems still returns a valid, wearable, weather-unbiased result.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { QueryExecutor as DbQueryExecutor } from '@closet/db';
import {
  suggestItems,
  type SuggestionItem,
  type WeatherPort,
  type WeatherResult,
} from '@closet/shared';
import { makeServiceExecutor, type Sql } from '../src/auth/executor.js';
import { makeRevenueCatWebhook } from '../src/billing/revenuecat-webhook.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import { logWear } from '../src/wear-log/log-wear.js';
import { toggleAvailability } from '../src/wardrobe/availability.js';
import type {
  AIVisionPort,
  AIVisionResult,
  CutoutPort,
  CutoutResult,
} from '@closet/shared';
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
import { makeEvent } from './fixtures/revenuecat-events.js';

const SHARED_KEY_FIXTURE = 'rc-webhook-shared-secret-known-to-the-test';

// Temporal ladder — distinct RC event timestamps (ms). t1 < t2 < t3.
const T1 = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const T2 = 1_700_000_100_000;
const T3 = 1_700_000_200_000;

// ---- webhook plumbing (service_role seam, exactly like the sibling oracle) ----
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

function postWebhook(body: unknown, secret: string): Request {
  return new Request('https://test.local/revenuecat-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: secret },
    body: JSON.stringify(body),
  });
}

// ---- parse fake ports with an observable call counter + a failure predicate ---
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

interface CountingPorts extends ParsePorts {
  visionCalls(): number;
}

// A ports pair that REJECTS (models a provider timeout/5xx) whenever the photo path
// matches `failWhen`, and otherwise succeeds. The counter is only bumped on a real
// (successful-path) invocation so "was the paid provider hit" stays observable.
//
// The vendors now receive a MINTED signed URL rather than the storage key (the key is
// server-derived from the verified sub and never handed to a vendor raw). The fake
// minter embeds the key it was asked to sign so `failWhen` can still select which
// photo degrades — the per-photo `source_photo_hash` is the discriminator.
function makePorts(failWhen: (imageUrl: string) => boolean): CountingPorts {
  let vision = 0;
  const visionPort: AIVisionPort = {
    async extractAttributes({ imageUrl }) {
      if (failWhen(imageUrl)) {
        // A rejected promise == the timeout/5xx the degraded path must absorb.
        throw new Error('provider timeout — must never hang or leak');
      }
      vision += 1;
      return FAKE_VISION;
    },
  };
  const cutoutPort: CutoutPort = {
    async removeBackground() {
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

describe('Tier-4 chaos — adversarial temporal + scale conditions, state-oracled', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  let serviceExec: DbQueryExecutor;
  let webhook: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
    serviceExec = makeServiceExecutor(poolAsSql(pool));
    webhook = makeRevenueCatWebhook({
      makeExec: () => serviceExec,
      secret: SHARED_KEY_FIXTURE,
      newCorrelationId: () => 'test-correlation',
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // Independent oracle SELECTs (superuser = RLS-exempt confirmation of the write).
  async function selectSub(userId: string) {
    const { rows } = await superuser.query<{
      entitlement_active: boolean;
      event_ts: string | null;
    }>(
      `SELECT entitlement_active,
              to_char(event_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_ts
       FROM public.subscriptions WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async function countWebhookEvent(eventId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = $1`,
      [eventId],
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

  async function itemsForUser(userId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  // =====================================================================
  // 1. WEBHOOK TEMPORAL CHAOS — replay, out-of-order, late-arrival.
  //    Drives the REAL handler over the service_role seam; the ONLY oracle is the
  //    independent SELECT of subscriptions + the webhook_events dedup ledger.
  // =====================================================================
  describe('1. webhook chaos (money path, monotonic guard)', () => {
    it('(a) replay — SAME event id twice dedups to ONE entitlement change, one ledger row', async () => {
      const user = '10000000-0000-4000-8000-000000000001';
      const fixture = makeEvent({
        id: 'chaos-replay-1',
        type: 'INITIAL_PURCHASE',
        appUserId: user,
        eventTimestampMs: T2,
        expirationAtMs: T3,
      });

      const first = await webhook(postWebhook(fixture, SHARED_KEY_FIXTURE));
      const second = await webhook(postWebhook(fixture, SHARED_KEY_FIXTURE));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // The 2nd delivery is a dedup no-op, NOT a fresh entitlement change.
      expect(await second.json()).toEqual({ deduped: true });

      // Independent oracle: entitlement true, and the ledger recorded the id ONCE —
      // replay collapsed to a single change.
      const sub = await selectSub(user);
      expect(sub?.entitlement_active).toBe(true);
      expect(await countWebhookEvent('chaos-replay-1')).toBe(1);
    });

    it('(b) out-of-order — RENEWAL@t2 then older CANCELLATION@t1 keeps entitlement_active=true', async () => {
      const user = '10000000-0000-4000-8000-000000000002';
      const renewal = makeEvent({
        id: 'chaos-ooo-renewal',
        type: 'RENEWAL',
        appUserId: user,
        eventTimestampMs: T2,
        expirationAtMs: T3,
      });
      const staleCancel = makeEvent({
        id: 'chaos-ooo-cancel', // distinct id → NOT a replay; the guard must decide
        type: 'CANCELLATION',
        appUserId: user,
        eventTimestampMs: T1, // older than the renewal already applied
        expirationAtMs: T3,
      });

      await webhook(postWebhook(renewal, SHARED_KEY_FIXTURE));
      expect((await selectSub(user))?.entitlement_active).toBe(true);

      const late = await webhook(postWebhook(staleCancel, SHARED_KEY_FIXTURE));
      expect(late.status).toBe(200);
      // The monotonic guard rejected the older event as a success no-op.
      expect(await late.json()).toEqual({ stale: true });

      // Independent oracle: still active, and event_ts is still the RENEWAL's t2 —
      // the stale cancellation never moved the state.
      const sub = await selectSub(user);
      expect(sub?.entitlement_active).toBe(true);
      expect(sub?.event_ts).toBe('2023-11-14T22:15:00.000000Z'); // T2
    });

    it('(c) late-arrival — EXPIRATION@t2 then a late RENEWAL@t1 → final state is the NEWER event', async () => {
      const user = '10000000-0000-4000-8000-000000000003';
      // Seed a prior active purchase at t1 so the expiry has something to revoke.
      const purchase = makeEvent({
        id: 'chaos-late-purchase',
        type: 'INITIAL_PURCHASE',
        appUserId: user,
        eventTimestampMs: T1,
        expirationAtMs: T3,
      });
      await webhook(postWebhook(purchase, SHARED_KEY_FIXTURE));
      expect((await selectSub(user))?.entitlement_active).toBe(true);

      // The NEWER event (t2) is the expiration — deliver it first.
      const expiration = makeEvent({
        id: 'chaos-late-expire',
        type: 'EXPIRATION',
        appUserId: user,
        eventTimestampMs: T2,
        expirationAtMs: T2,
      });
      await webhook(postWebhook(expiration, SHARED_KEY_FIXTURE));
      expect((await selectSub(user))?.entitlement_active).toBe(false);

      // A late-arriving OLDER renewal (t1 < t2) must NOT resurrect entitlement.
      const lateRenewal = makeEvent({
        id: 'chaos-late-renewal',
        type: 'RENEWAL',
        appUserId: user,
        eventTimestampMs: T1, // older than the expiry that already landed
        expirationAtMs: T3,
      });
      const res = await webhook(postWebhook(lateRenewal, SHARED_KEY_FIXTURE));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ stale: true });

      // Independent oracle: final state is the NEWER event (the t2 expiration) —
      // entitlement revoked, event_ts pinned to t2. The late older renewal was inert.
      const sub = await selectSub(user);
      expect(sub?.entitlement_active).toBe(false);
      expect(sub?.event_ts).toBe('2023-11-14T22:15:00.000000Z'); // T2
    });
  });

  // =====================================================================
  // 2. PARSE FAN-OUT (degraded path) — a batch of distinct photos where some
  //    provider calls throw. Fewer items rather than a hang; failed jobs
  //    re-claimable; done jobs short-circuit; NO duplicate garments across the batch.
  // =====================================================================
  describe('2. parse fan-out degraded path (partial provider failure)', () => {
    const USER = '20000000-0000-4000-8000-000000000001';

    interface ParseBody {
      job: { id: string; status: string };
      items: unknown[];
    }

    it('batch with 2/6 provider timeouts → 4 items (fewer, no hang), failed re-claimable, no dup garments', async () => {
      // Seed entitlement (service_role) so kind=full skips the teaser cap entirely —
      // the fan-out is about provider degradation, not the cap.
      await superuser.query(
        `INSERT INTO public.subscriptions (user_id, entitlement_active, updated_at)
         VALUES ($1, true, now())`,
        [USER],
      );
      const caller = makeCaller(pool, USER);

      // 6 distinct photos; the two whose hash marks them FAN-FAIL make the provider
      // throw. The hash is the discriminator now that the storage path is derived from
      // it server-side (it is the only caller-chosen component of the derived key).
      const OK = [0, 1, 2, 3].map((i) => ({
        source_photo_hash: `FAN-OK-${i}`,
        kind: 'full' as const,
      }));
      const FAIL = [0, 1].map((i) => ({
        source_photo_hash: `FAN-FAIL-${i}`,
        kind: 'full' as const,
      }));
      const batch = [...OK, ...FAIL];

      const ports = makePorts((imageUrl) => imageUrl.includes('FAN-FAIL'));
      const handler = makeParsePhoto(() => ports);

      // Fan out in-process. Promise.all resolving at all is itself the "never hangs"
      // proof — a rejecting provider is absorbed into a 502, not a dangling promise.
      const responses = await Promise.all(batch.map((body) => caller.call(handler, { body })));

      const oks = responses.slice(0, 4);
      const fails = responses.slice(4);
      for (const r of oks) expect(r.status).toBe(200);
      for (const r of fails) expect(r.status).toBe(502);

      // The provider was hit exactly once per OK photo — the two failures rejected.
      expect(ports.visionCalls()).toBe(4);

      // Independent oracle: exactly 4 garments across the whole batch (degraded path
      // reveals FEWER items, not a hang, not a partial-dup). One per done job, zero
      // for each failed job.
      expect(await itemsForUser(USER)).toBe(4);
      for (const r of oks) {
        const body = (await r.json()) as ParseBody;
        expect(body.job.status).toBe('done');
        expect(await itemsForJob(body.job.id)).toBe(1);
      }

      // The failed jobs persisted status='failed' with 0 items (no partial garbage).
      // ORDER BY hash so rows[0] is deterministically FAN-FAIL-0 (the one we resume).
      const failed = await superuser.query<{ id: string; source_photo_hash: string; status: string; error_reason: string | null }>(
        `SELECT id, source_photo_hash, status, error_reason FROM public.parse_jobs
         WHERE user_id = $1 AND source_photo_hash LIKE 'FAN-FAIL-%'
         ORDER BY source_photo_hash`,
        [USER],
      );
      expect(failed.rows).toHaveLength(2);
      for (const job of failed.rows) {
        expect(job.status).toBe('failed');
        expect(job.error_reason).toBe('provider_failed');
        expect(await itemsForJob(job.id)).toBe(0);
      }

      // ---- RESUME: a failed job is re-claimable once its lease expires, and a
      // healthy re-run commits EXACTLY ONE item (no dup from the failed attempt).
      expect(failed.rows[0]!.source_photo_hash).toBe('FAN-FAIL-0');
      const failedJobId = failed.rows[0]!.id;
      // Simulate lease expiry (claimed_at cleared) — claim() gates on a 2-min lease,
      // so a just-failed job is not instantly re-claimable; this is the crash-recover
      // window, mirroring the parse-photo resume oracle.
      await superuser.query(`UPDATE public.parse_jobs SET claimed_at = NULL WHERE id = $1`, [failedJobId]);

      const healthyPorts = makePorts(() => false);
      const healthyHandler = makeParsePhoto(() => healthyPorts);
      const resume = await caller.call(healthyHandler, {
        body: { source_photo_hash: 'FAN-FAIL-0', kind: 'full' },
      });
      expect(resume.status).toBe(200);
      const resumeBody = (await resume.json()) as ParseBody;
      expect(resumeBody.job.status).toBe('done');
      expect(resumeBody.job.id).toBe(failedJobId); // same job row, not a new one
      expect(healthyPorts.visionCalls()).toBe(1);
      // commit's delete-partial + per-photo idempotency: exactly ONE item, never 2.
      expect(await itemsForJob(failedJobId)).toBe(1);

      // ---- DONE SHORT-CIRCUIT: resubmitting an already-done photo makes NO provider
      // call and adds NO garment.
      const doneBefore = await itemsForUser(USER);
      const shortCircuitPorts = makePorts(() => false);
      const shortCircuitHandler = makeParsePhoto(() => shortCircuitPorts);
      const replay = await caller.call(shortCircuitHandler, {
        body: { source_photo_hash: 'FAN-OK-0', kind: 'full' },
      });
      expect(replay.status).toBe(200);
      expect(((await replay.json()) as ParseBody).job.status).toBe('done');
      expect(shortCircuitPorts.visionCalls()).toBe(0); // short-circuit — never charged
      expect(await itemsForUser(USER)).toBe(doneBefore); // no new garment
    });
  });

  // =====================================================================
  // 3. OFFLINE/JITTER IDEMPOTENCY (F8) — CONCURRENT retries with the SAME caller-
  //    minted client_id (the adversarial condition the sequential happy-path test
  //    never creates) → EXACTLY ONE row, the flip applied exactly once.
  // =====================================================================
  describe('3. offline/jitter idempotency (F8 under concurrent retry)', () => {
    const USER = '30000000-0000-4000-8000-000000000001';

    async function seedItem(exec: QueryExecutor): Promise<string> {
      const { rows } = await exec.query<{ id: string }>(
        `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
        [USER],
      );
      return rows[0]!.id;
    }

    // The F8 idempotency LAW (task §3): retried under the same caller-minted
    // client_id → EXACTLY ONE row, never duplicates or lost writes. This is the
    // hard data invariant and it HOLDS under both realistic sequential retry AND a
    // truly-simultaneous in-flight burst. See the concurrency limitation note below.
    it('SEQUENTIAL offline retry burst (realistic jitter), same client_id → EXACTLY ONE row, all 200, flip once', async () => {
      const exec = makeTenantExecutor(pool, USER);
      const caller: Caller = makeCaller(pool, USER);
      const itemId = await seedItem(exec);
      const body = { item_id: itemId, client_id: 'jitter-seq-1' };

      // Offline retry is a retry-AFTER-timeout: the client re-sends only once the
      // prior attempt is known-failed, i.e. sequentially. This is the real jitter path.
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const r = await caller.call(logWear, { body, query: '?flip=dirty' });
        statuses.push(r.status);
      }
      // Every sequential retry is an idempotent 200 — the client can retry freely.
      expect(statuses).toEqual([200, 200, 200, 200, 200]);

      // Independent oracle #1: partial-UNIQUE(user_id, client_id) collapsed all 5
      // to EXACTLY ONE persisted wear row (never duplicates, never a lost write).
      const wearCount = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = $2`,
        [USER, 'jitter-seq-1'],
      );
      expect(wearCount.rows[0]?.n).toBe('1');

      // Independent oracle #2: the flip is atomic-with-append and fired exactly once —
      // the item is dirty (the single wear row above proves the flip's EXISTS(ins)
      // guard ran on the one insert, not on every retry).
      const avail = await superuser.query<{ availability: string }>(
        `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
        [itemId],
      );
      expect(avail.rows[0]?.availability).toBe('dirty');
    });

    // SIMULTANEOUS in-flight burst — the harsher chaos condition. BOTH the F8 data law
    // (EXACTLY ONE row) AND response-idempotency (every caller gets a 200 with the
    // canonical row) must hold. This is the fix for a bug this suite originally found:
    // appendWear used a single CTE with a UNION-ALL fallback SELECT; under READ
    // COMMITTED a concurrent duplicate's fallback ran on a snapshot taken BEFORE the
    // winner committed, saw zero rows, and 500'd. The repo now re-reads the canonical
    // row in a FRESH query() (new tx = new snapshot) on the ON-CONFLICT-no-row path, so
    // a loser sees the winner's committed row. (DO UPDATE isn't an option — app_user has
    // SELECT+INSERT only on this append-only moat.) This test pins the idempotent 200.
    it('SIMULTANEOUS in-flight burst, same client_id → EXACTLY ONE row, ALL 200 (response-idempotent), flip once', async () => {
      const exec = makeTenantExecutor(pool, USER);
      const caller: Caller = makeCaller(pool, USER);
      const itemId = await seedItem(exec);
      const body = { item_id: itemId, client_id: 'jitter-conc-1' };

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => caller.call(logWear, { body, query: '?flip=dirty' })),
      );
      const okCount = responses.filter((r) => r.status === 200).length;

      // THE F8 DATA LAW — independent SELECT: exactly ONE row persisted regardless of
      // how the 10 simultaneous inserts raced. No duplicates, no lost write.
      const wearCount = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = $2`,
        [USER, 'jitter-conc-1'],
      );
      expect(wearCount.rows[0]?.n).toBe('1');

      // RESPONSE-IDEMPOTENCY: every one of the 10 simultaneous callers gets a 200 with
      // the canonical row — a client firing parallel retries never sees a spurious 500
      // for a tap that in fact succeeded. This is what the fresh-snapshot re-read buys.
      expect(okCount).toBe(10);

      // The flip still fired (on the one committed insert) — state is coherent.
      const avail = await superuser.query<{ availability: string }>(
        `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
        [itemId],
      );
      expect(avail.rows[0]?.availability).toBe('dirty');
    });

    it('concurrent availability toggles to the same value → one row, converges to target (idempotent UPDATE)', async () => {
      const exec = makeTenantExecutor(pool, USER);
      const caller: Caller = makeCaller(pool, USER);
      const itemId = await seedItem(exec);

      // Availability has no client_id — it is idempotent by construction (an UPDATE to
      // a fixed target value). Under a concurrent retry burst it must still converge
      // to the target with no extra rows.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          caller.call(toggleAvailability, { body: { item_id: itemId, availability: 'unavailable' } }),
        ),
      );
      for (const r of responses) expect(r.status).toBe(200);

      // Independent oracle: still exactly one row for this item, and it converged to
      // the target — retries neither duplicated the row nor lost the write.
      const row = await superuser.query<{ n: string; availability: string }>(
        `SELECT count(*) OVER ()::text AS n, availability
         FROM public.wardrobe_items WHERE id = $1`,
        [itemId],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.availability).toBe('unavailable');
    });
  });

  // =====================================================================
  // 4. WEATHER DEGRADED PATH — a WeatherPort that throws/times out. suggestItems is
  //    a PURE fn that takes tempC directly (there is no server-side WeatherPort seam
  //    yet — it is the on-device suggestion path). The degraded composition tries the
  //    port, and on failure falls back to a neutral tempC (NO weather bias). The
  //    oracle is the real pure suggestItems output: valid, wearable, never a throw.
  // =====================================================================
  describe('4. weather degraded path (throwing WeatherPort → unbiased, valid suggestion)', () => {
    const NEUTRAL_TEMP_C = 25; // == suggestion.ts WARM_BASE_C → the minimum layer count

    // The degraded composition under test: try weather, absorb any failure, fall back
    // to a neutral temperature so the suggestion runs WITHOUT weather bias.
    async function suggestWithWeather(
      port: WeatherPort,
      items: readonly SuggestionItem[],
    ) {
      let tempC = NEUTRAL_TEMP_C;
      try {
        const weather = await port.getCurrent({ lat: 40.0, lon: -74.0 });
        tempC = weather.tempC;
      } catch {
        // degraded — keep the neutral temperature, no weather bias
      }
      return suggestItems({ items, tempC });
    }

    const CLEAN_ITEMS: SuggestionItem[] = [
      { id: 'a', status: 'clean', warmth: 5, category: 'coat' },
      { id: 'b', status: 'clean', warmth: 3, category: 'top' },
      { id: 'c', status: 'clean', warmth: 1, category: 'tee' },
    ];

    const THROWING_WEATHER: WeatherPort = {
      async getCurrent(): Promise<WeatherResult> {
        throw new Error('weather vendor 503 / timeout — must be absorbed');
      },
    };
    const COLD_WEATHER: WeatherPort = {
      async getCurrent(): Promise<WeatherResult> {
        return { tempC: -5, condition: 'snow' };
      },
    };

    it('throwing WeatherPort → suggestion runs unbiased, never throws, still wearable', async () => {
      const degraded = await suggestWithWeather(THROWING_WEATHER, CLEAN_ITEMS);
      // Never a broken result: it resolves to a defined, non-fallback suggestion of
      // clean items only.
      expect(degraded.fallback).toBe(false);
      if (degraded.fallback === false) {
        expect(degraded.items.length).toBeGreaterThan(0);
        expect(degraded.items.every((i) => i.status === 'clean')).toBe(true);
      }

      // Independent oracle: the degraded output is EXACTLY the weatherless neutral
      // suggestion computed by the real pure fn — proving no weather bias leaked in.
      const neutral = suggestItems({ items: CLEAN_ITEMS, tempC: NEUTRAL_TEMP_C });
      expect(degraded).toEqual(neutral);
    });

    it('control — a HEALTHY cold WeatherPort biases toward MORE layers (proving the bias is real when weather is up)', async () => {
      const cold = await suggestWithWeather(COLD_WEATHER, CLEAN_ITEMS);
      const degraded = await suggestWithWeather(THROWING_WEATHER, CLEAN_ITEMS);
      // Cold weather asks for strictly more layers than the degraded (unbiased) path —
      // so the degraded path is demonstrably shedding a real bias, not a no-op.
      const coldCount = cold.fallback === false ? cold.items.length : 0;
      const degradedCount = degraded.fallback === false ? degraded.items.length : 0;
      expect(coldCount).toBeGreaterThan(degradedCount);
    });

    it('degraded path with NO clean items → defined non-throwing fallback (never a broken result)', async () => {
      const dirtyOnly: SuggestionItem[] = [{ id: 'x', status: 'dirty', warmth: 2, category: 'top' }];
      const degraded = await suggestWithWeather(THROWING_WEATHER, dirtyOnly);
      expect(degraded.fallback).toBe(true);
      if (degraded.fallback === true) {
        expect(degraded.reason).toBe('no_clean_items');
        expect(degraded.items).toEqual([]);
      }
    });
  });
});
