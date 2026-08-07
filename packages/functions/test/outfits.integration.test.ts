// Independent oracle for the outfits endpoint (task-11, D-001). Idempotent create
// (client-minted id), composite-FK cross-tenant rejection, isolation — handlers
// through the real withAuth as app_user against real Postgres. State is read from
// a superuser count, never the handler's own return value.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createOutfit } from '../src/outfits/create.js';
import { listOutfits } from '../src/outfits/list.js';
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

describe('outfits endpoint — idempotent create + FK isolation', () => {
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

  it('create returns the outfit + members; members persisted', async () => {
    const item = await seedItem(execA, USER_A);
    const res = await callerA.call(createOutfit, { body: { name: 'Look', items: [{ item_id: item }] } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outfit: { id: string }; items: unknown[] };
    expect(body.items.length).toBe(1);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [body.outfit.id],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('idempotent create — retry with same client id → one outfit, one member', async () => {
    const item = await seedItem(execA, USER_A);
    const outfitId = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';
    const body = { id: outfitId, name: 'Fixed', items: [{ item_id: item }] };
    const first = await callerA.call(createOutfit, { body });
    const retry = await callerA.call(createOutfit, { body });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(outfitCount.rows[0]?.n).toBe('1');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberCount.rows[0]?.n).toBe('1');
  });

  it('cross-tenant item_id → 400 (composite FK), no outfit lands', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const bItem = await seedItem(execB, USER_B);
    const before = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`, [USER_A]);
    const res = await callerA.call(createOutfit, { body: { name: 'bad', items: [{ item_id: bItem }] } });
    expect(res.status).toBe(400);
    const after = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`, [USER_A]);
    // The whole atomic statement rolled back — no orphan outfit.
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('malformed body → 400 at the boundary', async () => {
    const res = await callerA.call(createOutfit, { body: { items: 'nope' } });
    expect(res.status).toBe(400);
  });

  it('list is RLS-scoped — A never sees B outfits', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    await execB.query(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-secret')`, [USER_B]);
    const res = await callerA.call(listOutfits);
    const body = (await res.json()) as { outfits: { name: string | null }[] };
    expect(body.outfits.some((o) => o.name === 'B-secret')).toBe(false);
  });
});
