// Independent oracle for the wear-log endpoint (task-12, F8). The moat law:
// retried under the same client_id → EXACTLY ONE row (Tier-4 idempotency), the
// flip is atomic with the append, and a cross-tenant item reference is rejected.
// State is read via a superuser count / a fresh SELECT — never the handler's return.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
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

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const USER_C = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';

async function seedItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
    [userId],
  );
  return rows[0]!.id;
}

describe('wear-log endpoint — idempotent append + atomic flip', () => {
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

  it('append happy path — one wear row for the client_id', async () => {
    const item = await seedItem(execA, USER_A);
    const res = await callerA.call(logWear, { body: { item_id: item, client_id: 'k1' } });
    expect(res.status).toBe(200);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = 'k1'`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('idempotent under retry — same client_id twice → EXACTLY ONE row (moat law)', async () => {
    const item = await seedItem(execA, USER_A);
    const body = { item_id: item, client_id: 'retry-key' };
    await callerA.call(logWear, { body });
    await callerA.call(logWear, { body });
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = 'retry-key'`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('flip=dirty is atomic + idempotent; no-flip leaves item clean', async () => {
    const cleanItem = await seedItem(execA, USER_A);
    await callerA.call(logWear, { body: { item_id: cleanItem, client_id: 'nf' } });
    const clean = await execA.query<{ availability: string }>(
      `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
      [cleanItem],
    );
    expect(clean.rows[0]?.availability).toBe('clean');

    const flipItem = await seedItem(execA, USER_A);
    const body = { item_id: flipItem, client_id: 'ff' };
    await callerA.call(logWear, { body, query: '?flip=dirty' });
    const dirty = await execA.query<{ availability: string }>(
      `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
      [flipItem],
    );
    expect(dirty.rows[0]?.availability).toBe('dirty');
    // Retry: still one wear row, still dirty.
    await callerA.call(logWear, { body, query: '?flip=dirty' });
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1 AND client_id = 'ff'`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('append naming another tenant item → 400 (composite FK), no row lands', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const bItem = await seedItem(execB, USER_B);
    const res = await callerA.call(logWear, { body: { item_id: bItem, client_id: 'crosstenant' } });
    expect(res.status).toBe(400);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE client_id = 'crosstenant'`,
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('isolation control — B and never-writing C see 0 of A wear rows', async () => {
    const item = await seedItem(execA, USER_A);
    await callerA.call(logWear, { body: { item_id: item, client_id: 'iso' } });
    const execB = makeTenantExecutor(pool, USER_B);
    const bSees = await execB.query(`SELECT id FROM public.wear_log WHERE client_id = 'iso'`);
    expect(bSees.rows.length).toBe(0);
    const execC = makeTenantExecutor(pool, USER_C);
    const cSees = await execC.query(`SELECT id FROM public.wear_log`);
    expect(cSees.rows.length).toBe(0);
    // superuser confirms rows DO exist — C's 0 is RLS scoping, not empty table.
    const all = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.wear_log`);
    expect(Number(all.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('malformed body (missing client_id) → 400, no row', async () => {
    const item = await seedItem(execA, USER_A);
    const res = await callerA.call(logWear, { body: { item_id: item } });
    expect(res.status).toBe(400);
  });
});
