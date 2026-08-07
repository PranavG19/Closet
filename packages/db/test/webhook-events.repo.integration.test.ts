// Independent oracle for makeWebhookEventsRepo (task-09b). Atomic replay dedup +
// app_user lockout (no policy/grant ⇒ neither read nor write). service_role only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { WebhookEventRow } from '@closet/shared';
import { makeWebhookEventsRepo } from '../src/repos/webhook-events.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';

describe('makeWebhookEventsRepo — atomic dedup + app_user lockout', () => {
  let harness: PgHarness;
  let pool: Pool;
  let appUser: QueryExecutor;
  let serviceRole: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    appUser = makeTenantExecutor(pool, USER_A);
    serviceRole = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('record dedups a replay — second record of same id → null (differential)', async () => {
    const repo = makeWebhookEventsRepo(serviceRole);
    const first = await repo.record('evt_1');
    expect(() => WebhookEventRow.parse(first)).not.toThrow();
    const replay = await repo.record('evt_1');
    expect(replay).toBeNull();
    const count = await serviceRole.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = 'evt_1'`,
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('app_user cannot record OR read webhook_events — control (MUST fail)', async () => {
    // No app_user policy and no grant: both write and read raise permission denied.
    await expect(makeWebhookEventsRepo(appUser).record('evt_x')).rejects.toThrow();
    await expect(
      appUser.query(`SELECT event_id FROM public.webhook_events`),
    ).rejects.toThrow();
  });
});
