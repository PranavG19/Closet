// Independent oracle for revenuecat-webhook (task-15) — Tier-3 backend E2E against
// a real Postgres (full migration chain), THE MONEY PATH (docs/05 "real webhook
// event" bar). The REAL handler is driven with a REAL service_role executor
// (makeServiceExecutor over the RLS-exempt container superuser pool — the
// service_role analog) + a known secret over a real subscriptions/webhook_events.
//
// The HTTP 200 is NEVER the oracle: every assertion is an INDEPENDENT SELECT — a
// superuser SELECT confirms the write; an app_user executor confirms it CANNOT
// write (the sovereign money guarantee: a client literally cannot mint
// entitlement). The fixture is a COMMITTED real RevenueCat v1 webhook payload
// (fixtures/revenuecat-events.ts), not a hand-minted {active:true}.
//
// Tier-0 mutation targets shown red-first here (see the two `red-first` tests):
// passing now() instead of the event ts (monotonic guard never bites) and ignoring
// record()'s null (replay double-writes) each turn a green oracle red.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  makeSubscriptionsRepo,
  makeWebhookEventsRepo,
  type QueryExecutor as DbQueryExecutor,
} from '@closet/db';
import {
  RevenueCatWebhookBody,
  ENTITLEMENT_BY_EVENT_TYPE,
  parseBoundary,
} from '@closet/shared';
import { makeServiceExecutor, type Sql } from '../src/auth/executor.js';
import { jsonResponse } from '../src/auth/respond.js';
import { makeRevenueCatWebhook } from '../src/billing/revenuecat-webhook.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';
import { makeEvent } from './fixtures/revenuecat-events.js';

const SHARED_KEY_FIXTURE = 'rc-webhook-shared-secret-known-to-the-test';

// Distinct users per scenario so each independent SELECT reads clean state (the
// migration chain + pool are shared across the file).
const USER_GRANT = '11111111-1111-4111-8111-111111111111';
const USER_REPLAY = '22222222-2222-4222-8222-222222222222';
const USER_MONO = '33333333-3333-4333-8333-333333333333';
const USER_MONO_BUG = '44444444-4444-4444-8444-444444444444';
const USER_REVOKE = '55555555-5555-4555-8555-555555555555';
const USER_BADAUTH = '66666666-6666-4666-8666-666666666666';
const USER_REPLAY_BUG = '77777777-7777-4777-8777-777777777777';

const T1 = 1_700_000_000_000; // oldest
const T2 = 1_700_000_100_000; // newer
const T3 = 1_700_000_200_000; // newest

// Adapt a pg.Pool to the executor's minimal Sql interface so we drive the REAL
// makeServiceExecutor (the new RLS-bypass seam) exactly as production would.
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

function post(body: unknown, secret: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers.authorization = secret;
  return new Request('https://test.local/revenuecat-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('revenuecat-webhook — the entitlement write path (money, service_role)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;
  let handler: (req: Request) => Promise<Response>;

  // A production-shaped service executor over the RLS-exempt superuser pool.
  let serviceExec: DbQueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
    serviceExec = makeServiceExecutor(poolAsSql(pool));
    handler = makeRevenueCatWebhook({
      makeExec: () => serviceExec,
      secret: SHARED_KEY_FIXTURE,
      newCorrelationId: () => 'test-correlation',
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // Independent SELECTs (superuser = RLS-exempt confirmation of the write).
  async function selectSub(userId: string) {
    const { rows } = await superuser.query<{
      entitlement_active: boolean;
      event_ts: string | null;
      updated_at: string;
    }>(
      `SELECT entitlement_active,
              to_char(event_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_ts,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
       FROM public.subscriptions WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async function countEvent(eventId: string): Promise<number> {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = $1`,
      [eventId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  // ---- 1. Grant: INITIAL_PURCHASE fixture writes entitlement -------------------
  it('grant — INITIAL_PURCHASE fixture writes entitlement_active=true, event recorded, 200', async () => {
    const fixture = makeEvent({
      id: 'evt-grant-1',
      type: 'INITIAL_PURCHASE',
      appUserId: USER_GRANT,
      eventTimestampMs: T1,
      expirationAtMs: T3,
    });
    const res = await handler(post(fixture, SHARED_KEY_FIXTURE));
    expect(res.status).toBe(200);

    const row = await selectSub(USER_GRANT);
    expect(row?.entitlement_active).toBe(true);
    // The REAL event timestamp landed (not now()) — the monotonic guard's input.
    // T1 = 1_700_000_000_000 ms = 2023-11-14T22:13:20Z.
    expect(row?.event_ts).toBe('2023-11-14T22:13:20.000000Z');
    expect(await countEvent('evt-grant-1')).toBe(1);
  });

  // ---- 2. Replay is a 200 no-op that writes nothing new ------------------------
  it('replay — same event id twice: 2nd is a no-op, row byte-identical, event count stays 1, 200 both', async () => {
    const fixture = makeEvent({
      id: 'evt-replay-1',
      type: 'INITIAL_PURCHASE',
      appUserId: USER_REPLAY,
      eventTimestampMs: T2,
      expirationAtMs: T3,
    });

    const first = await handler(post(fixture, SHARED_KEY_FIXTURE));
    expect(first.status).toBe(200);
    const afterFirst = await selectSub(USER_REPLAY);
    expect(afterFirst?.entitlement_active).toBe(true);

    const second = await handler(post(fixture, SHARED_KEY_FIXTURE));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ deduped: true });

    const afterSecond = await selectSub(USER_REPLAY);
    // updated_at unchanged ⇒ applyEvent was NOT run a second time (record()'s null
    // short-circuited before any write). Row is byte-identical.
    expect(afterSecond).toEqual(afterFirst);
    expect(await countEvent('evt-replay-1')).toBe(1);
  });

  // ---- 2b. RED-FIRST: ignoring record()'s null double-writes on replay ---------
  it('red-first — a handler that IGNORES record()==null re-writes on replay (updated_at moves)', async () => {
    // Buggy variant: always applyEvent, never short-circuit on the replay signal.
    const buggy = async (req: Request): Promise<Response> => {
      const raw: unknown = await req.json();
      const { event } = parseBoundary(RevenueCatWebhookBody, raw);
      await makeWebhookEventsRepo(serviceExec).record(event.id); // null ignored
      const active = ENTITLEMENT_BY_EVENT_TYPE[event.type] ?? false;
      await makeSubscriptionsRepo(serviceExec).applyEvent({
        userId: event.app_user_id,
        rcAppUserId: event.app_user_id,
        entitlementActive: active,
        eventTs: new Date(event.event_timestamp_ms).toISOString(),
        expiresAt: event.expiration_at_ms === null ? null : new Date(event.expiration_at_ms).toISOString(),
      });
      return jsonResponse(200, {});
    };

    const fixture = makeEvent({
      id: 'evt-replay-bug',
      type: 'INITIAL_PURCHASE',
      appUserId: USER_REPLAY_BUG,
      eventTimestampMs: T2,
      expirationAtMs: T3,
    });
    await buggy(post(fixture, SHARED_KEY_FIXTURE));
    const afterFirst = await selectSub(USER_REPLAY_BUG);
    // Same event_ts ⇒ guard passes (>=) ⇒ the buggy replay re-runs the UPDATE and
    // moves updated_at. This is exactly what the real handler's record()-null
    // short-circuit prevents (test 2 above proves the fix).
    await new Promise((r) => setTimeout(r, 5));
    await buggy(post(fixture, SHARED_KEY_FIXTURE));
    const afterSecond = await selectSub(USER_REPLAY_BUG);
    expect(afterSecond?.updated_at).not.toBe(afterFirst?.updated_at);
  });

  // ---- 3. Monotonic: older event after newer does NOT revoke -------------------
  it('monotonic — older CANCELLATION (t1) after newer RENEWAL (t2) does NOT revoke, still active, 200', async () => {
    const renewal = makeEvent({
      id: 'evt-mono-renewal',
      type: 'RENEWAL',
      appUserId: USER_MONO,
      eventTimestampMs: T2,
      expirationAtMs: T3,
    });
    await handler(post(renewal, SHARED_KEY_FIXTURE));
    expect((await selectSub(USER_MONO))?.entitlement_active).toBe(true);

    const staleCancel = makeEvent({
      id: 'evt-mono-cancel',
      type: 'CANCELLATION',
      appUserId: USER_MONO,
      eventTimestampMs: T1, // older than the renewal
      expirationAtMs: T3,
    });
    const res = await handler(post(staleCancel, SHARED_KEY_FIXTURE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stale: true }); // applyEvent returned null

    // Independent SELECT: entitlement still active — the guard bit because the
    // handler passed the REAL event_ts.
    expect((await selectSub(USER_MONO))?.entitlement_active).toBe(true);
  });

  // ---- 3b. RED-FIRST: passing now() instead of event ts lets the stale event win
  it('red-first — a handler passing now() instead of event_ts REVOKES on a stale event (guard never bites)', async () => {
    const buggyNow = async (req: Request): Promise<Response> => {
      const raw: unknown = await req.json();
      const { event } = parseBoundary(RevenueCatWebhookBody, raw);
      await makeWebhookEventsRepo(serviceExec).record(event.id);
      const active = ENTITLEMENT_BY_EVENT_TYPE[event.type] ?? false;
      await makeSubscriptionsRepo(serviceExec).applyEvent({
        userId: event.app_user_id,
        rcAppUserId: event.app_user_id,
        entitlementActive: active,
        eventTs: new Date().toISOString(), // BUG: now() instead of the event time
        expiresAt: event.expiration_at_ms === null ? null : new Date(event.expiration_at_ms).toISOString(),
      });
      return jsonResponse(200, {});
    };

    const renewal = makeEvent({
      id: 'evt-monobug-renewal',
      type: 'RENEWAL',
      appUserId: USER_MONO_BUG,
      eventTimestampMs: T2,
      expirationAtMs: T3,
    });
    await buggyNow(post(renewal, SHARED_KEY_FIXTURE));
    await new Promise((r) => setTimeout(r, 5));
    const staleCancel = makeEvent({
      id: 'evt-monobug-cancel',
      type: 'CANCELLATION',
      appUserId: USER_MONO_BUG,
      eventTimestampMs: T1, // older
      expirationAtMs: T3,
    });
    await buggyNow(post(staleCancel, SHARED_KEY_FIXTURE));
    // now() > now() of the renewal ⇒ guard passes ⇒ the stale cancel WINS and
    // revokes. The real handler (test 3) keeps it active — proving event_ts is
    // load-bearing.
    expect((await selectSub(USER_MONO_BUG))?.entitlement_active).toBe(false);
  });

  // ---- 4. STRUCTURAL: app_user CANNOT write (sovereign money guarantee) ---------
  it('structural — app_user executor calling applyEvent/record is REFUSED (42501/RLS)', async () => {
    const appUser = makeTenantExecutor(pool, USER_GRANT);

    await expect(
      makeSubscriptionsRepo(appUser).applyEvent({
        userId: USER_GRANT,
        rcAppUserId: 'rc',
        entitlementActive: true,
        eventTs: new Date(T2).toISOString(),
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(makeWebhookEventsRepo(appUser).record('evt-client-mint')).rejects.toMatchObject({
      code: '42501',
    });

    // Independent SELECT: the client-minted event id never landed.
    expect(await countEvent('evt-client-mint')).toBe(0);
  });

  // ---- 5a. Revoke on a newer EXPIRATION ----------------------------------------
  it('revoke — newer EXPIRATION (t2>t1) sets entitlement_active=false', async () => {
    const purchase = makeEvent({
      id: 'evt-revoke-purchase',
      type: 'INITIAL_PURCHASE',
      appUserId: USER_REVOKE,
      eventTimestampMs: T1,
      expirationAtMs: T3,
    });
    await handler(post(purchase, SHARED_KEY_FIXTURE));
    expect((await selectSub(USER_REVOKE))?.entitlement_active).toBe(true);

    const expiration = makeEvent({
      id: 'evt-revoke-expire',
      type: 'EXPIRATION',
      appUserId: USER_REVOKE,
      eventTimestampMs: T2, // newer
      expirationAtMs: T2,
    });
    const res = await handler(post(expiration, SHARED_KEY_FIXTURE));
    expect(res.status).toBe(200);
    expect((await selectSub(USER_REVOKE))?.entitlement_active).toBe(false);
  });

  // ---- 5b. Bad / absent secret → 401, zero writes ------------------------------
  it('bad secret — wrong Authorization → 401, independent SELECT shows zero writes', async () => {
    const fixture = makeEvent({
      id: 'evt-badsecret',
      type: 'INITIAL_PURCHASE',
      appUserId: USER_BADAUTH,
      eventTimestampMs: T2,
      expirationAtMs: T3,
    });

    const wrong = await handler(post(fixture, 'not-the-secret'));
    expect(wrong.status).toBe(401);

    const absent = await handler(post(fixture, null));
    expect(absent.status).toBe(401);

    // Nothing written by either attempt.
    expect(await selectSub(USER_BADAUTH)).toBeNull();
    expect(await countEvent('evt-badsecret')).toBe(0);
  });

  // ---- Malformed event → 4xx, nothing written ----------------------------------
  it('malformed — body missing a consumed field → 4xx, nothing written', async () => {
    const malformed = { api_version: '1.0', event: { id: 'evt-malformed', type: 'INITIAL_PURCHASE' } };
    const res = await handler(post(malformed, SHARED_KEY_FIXTURE));
    expect(res.status).toBe(400);
    expect(await countEvent('evt-malformed')).toBe(0);
  });
});
