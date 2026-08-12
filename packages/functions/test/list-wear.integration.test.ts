// Independent oracle for the wear-log READ endpoint (listWear, F8/F5). The handler feeds the
// suggestion freshness tie-break, so its three load-bearing properties are proven here against
// real Postgres as app_user: newest-first ordering, tenant isolation (RLS + repo WHERE), and the
// server-side limit clamp. Rows are seeded by a SUPERUSER INSERT with explicit worn_at values so
// ordering is deterministic and the oracle never depends on wall-clock timing or the handler's
// own return.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { WearLogListResponse } from '@closet/shared';
import { listWear } from '../src/wear-log/list-wear.js';
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

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

async function seedItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
    [userId],
  );
  return rows[0]!.id;
}

// Seed a wear-log row with an explicit worn_at (superuser bypasses RLS to set up cross-tenant
// state). client_id is a unique marker so ordering assertions can name the exact rows.
async function seedWear(
  superuser: QueryExecutor,
  userId: string,
  itemId: string,
  wornAtIso: string,
  clientId: string,
): Promise<void> {
  await superuser.query(
    `INSERT INTO public.wear_log (user_id, item_id, client_id, worn_at) VALUES ($1,$2,$3,$4)`,
    [userId, itemId, clientId, wornAtIso],
  );
}

describe('listWear endpoint — newest-first, tenant-isolated, server-clamped', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let execA: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    execA = makeTenantExecutor(pool, USER_A);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('returns the caller\'s entries newest-first', async () => {
    const item = await seedItem(execA, USER_A);
    // Seed out of order; the endpoint must return them worn_at DESC.
    await seedWear(superuser, USER_A, item, '2026-01-01T10:00:00.000Z', 'wear-oldest');
    await seedWear(superuser, USER_A, item, '2026-01-03T10:00:00.000Z', 'wear-newest');
    await seedWear(superuser, USER_A, item, '2026-01-02T10:00:00.000Z', 'wear-middle');

    const res = await callerA.call(listWear);
    expect(res.status).toBe(200);
    const { entries } = WearLogListResponse.parse(await res.json());
    const order = entries.map((e) => e.client_id);
    // The three we seeded appear in strict newest-first order.
    expect(order).toEqual(['wear-newest', 'wear-middle', 'wear-oldest']);
  });

  it('excludes another tenant\'s entries (RLS + repo WHERE user_id)', async () => {
    const bItem = await seedItem(makeTenantExecutor(pool, USER_B), USER_B);
    await seedWear(superuser, USER_B, bItem, '2026-02-01T10:00:00.000Z', 'wear-B-secret');

    const res = await callerA.call(listWear);
    const { entries } = WearLogListResponse.parse(await res.json());
    expect(entries.some((e) => e.client_id === 'wear-B-secret')).toBe(false);
    // Every returned row belongs to A.
    expect(entries.every((e) => e.user_id === USER_A)).toBe(true);
  });

  it('clamps ?limit to the requested count when below the page size', async () => {
    const res = await callerA.call(listWear, { query: '?limit=1' });
    expect(res.status).toBe(200);
    const { entries } = WearLogListResponse.parse(await res.json());
    expect(entries).toHaveLength(1);
    // The single row is the newest one (ordering holds under the clamp).
    expect(entries[0]?.client_id).toBe('wear-newest');
  });

  it('a non-numeric ?limit falls back to the default page size, NOT 1', async () => {
    // The bug this guards: Number('abc')=NaN, and clampLimit(NaN)=1 would silently return a
    // single row. The handler normalises NaN → undefined → default (50), so all of A's rows
    // (there are 3, well under 50) come back — proving the garbage limit did not clamp to 1.
    const res = await callerA.call(listWear, { query: '?limit=abc' });
    expect(res.status).toBe(200);
    const { entries } = WearLogListResponse.parse(await res.json());
    expect(entries.length).toBeGreaterThan(1);
  });
});
