// Independent oracle for makeSubscriptionsRepo (task-09b). The money table: an
// app_user executor can ONLY getByUser/getEntitlement (SELECT grant); applyEvent
// MUST fail as app_user (no write grant) — the structural guarantee a client
// cannot mint entitlement. Under service_role the monotonic guard skips a stale
// event. Negative controls are load-bearing: if applyEvent ever succeeds as
// app_user the suite is invalid.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { SubscriptionRow } from '@closet/shared';
import { makeSubscriptionsRepo } from '../src/repos/subscriptions.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('makeSubscriptionsRepo — money table (service_role write, app_user read)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  // The "service_role" seam in tests = the container superuser (RLS-exempt), which
  // is exactly the privilege revenuecat-webhook holds in prod.
  let serviceRole: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    serviceRole = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('applyEvent under app_user MUST fail (no write grant) — control', async () => {
    // If this ever resolves, a client can mint entitlement and the suite is invalid.
    await expect(
      makeSubscriptionsRepo(execA).applyEvent({
        userId: USER_A,
        rcAppUserId: 'rc_a',
        entitlementActive: true,
        eventTs: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
      }),
    ).rejects.toThrow();
    // And no row landed.
    const count = await serviceRole.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('service_role applyEvent lands a row; app_user reads own entitlement', async () => {
    const row = await makeSubscriptionsRepo(serviceRole).applyEvent({
      userId: USER_A,
      rcAppUserId: 'rc_a',
      entitlementActive: true,
      eventTs: '2026-02-01T00:00:00.000Z',
      expiresAt: '2026-03-01T00:00:00.000Z',
    });
    expect(() => SubscriptionRow.parse(row)).not.toThrow();
    const ent = await makeSubscriptionsRepo(execA).getEntitlement(USER_A);
    expect(ent.entitlement_active).toBe(true);
    // B (no row) → default not-entitled, never A's true.
    const bEnt = await makeSubscriptionsRepo(execB).getEntitlement(USER_B);
    expect(bEnt.entitlement_active).toBe(false);
    expect(bEnt.expires_at).toBeNull();
    // B cannot see A's row.
    expect(await makeSubscriptionsRepo(execB).getByUser(USER_A)).toBeNull();
  });

  it('monotonic guard — a stale older event does NOT revoke a newer entitlement', async () => {
    const repo = makeSubscriptionsRepo(serviceRole);
    // A is active at T2 (from prior test). A late older event at T1 sets false.
    const stale = await repo.applyEvent({
      userId: USER_A,
      rcAppUserId: 'rc_a',
      entitlementActive: false,
      eventTs: '2026-01-15T00:00:00.000Z',
      expiresAt: null,
    });
    // Guard skipped the update → null returned.
    expect(stale).toBeNull();
    const stillActive = await makeSubscriptionsRepo(execA).getEntitlement(USER_A);
    expect(stillActive.entitlement_active).toBe(true);
  });
});
