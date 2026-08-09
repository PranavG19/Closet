// Independent oracle for the wardrobe endpoint (task-10). Tier-2 adversarial on the
// Tier-3 real-Postgres substrate. The response is NEVER the oracle — every claim
// is checked against persisted DB state via a fresh SELECT / superuser count and
// differential row counts across the merge. Handlers run through the REAL withAuth
// as app_user; the container superuser control proves RLS is actually in effect.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { withAuth } from '../src/auth/withAuth.js';
import { listWardrobe } from '../src/wardrobe/list.js';
import { toggleAvailability } from '../src/wardrobe/availability.js';
import { resolveDedupe } from '../src/wardrobe/dedupe.js';
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

// Seed helpers use the tenant executor directly (bypassing the handler) so a test
// controls its fixture independent of the code under test.
async function seedItem(exec: QueryExecutor, userId: string, category = 'top'): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,$2) RETURNING id`,
    [userId, category],
  );
  return rows[0]!.id;
}

interface ListResult {
  items: { id: string }[];
  next_cursor: string | null;
}

describe('wardrobe endpoint — list/clamp, toggle, dedupe MERGE', () => {
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

  it('unauthenticated request → 401 (identity is never optional)', async () => {
    const res = await withoutAuth(listWardrobe, pool);
    expect(res.status).toBe(401);
  });

  it('list clamps limit to <= 100 and pages all rows exactly once', async () => {
    const seedUser = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    const execSeed = makeTenantExecutor(pool, seedUser);
    for (let i = 0; i < 130; i += 1) await seedItem(execSeed, seedUser);
    const caller = makeCaller(pool, seedUser);

    const clampedRes = await caller.call(listWardrobe, { query: '?limit=100000' });
    expect(clampedRes.status).toBe(200);
    const clamped = (await clampedRes.json()) as ListResult;
    expect(clamped.items.length).toBeLessThanOrEqual(100);
    expect(clamped.items.length).toBe(100);
    expect(clamped.next_cursor).not.toBeNull();

    // Page through with the endpoint's cursor; assert every id exactly once.
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const q: string = cursor ? `?limit=40&cursor=${encodeURIComponent(cursor)}` : '?limit=40';
      const res = await caller.call(listWardrobe, { query: q });
      const body = (await res.json()) as ListResult;
      for (const item of body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect(seen.size).toBe(130);
  });

  it('malformed cursor → 400 (never a silent full scan)', async () => {
    const res = await callerA.call(listWardrobe, { query: '?cursor=not-a-cursor' });
    expect(res.status).toBe(400);
  });

  // An UNPARSEABLE body (dropped connection mid-POST), not merely a wrong shape.
  // This is the caller's fault, so it must be 400: a 5xx tells the client (App.tsx
  // sets retry: 1) and any future infra the SERVER is at fault and the request is
  // worth resending, when this body will never parse no matter how often it is sent.
  // Every other "malformed body" oracle sends well-formed JSON with wrong fields,
  // which fails inside parseBoundary and never reaches the req.json() throw.
  it.each([
    { label: 'empty', rawBody: '' },
    { label: 'truncated', rawBody: '{' },
  ])('toggle with an $label body → 400, never 500', async ({ rawBody }) => {
    const res = await callerA.call(toggleAvailability, { rawBody });
    expect(res.status).toBe(400);
  });

  it.each([
    { label: 'empty', rawBody: '' },
    { label: 'truncated', rawBody: '{' },
  ])('dedupe with an $label body → 400, never 500', async ({ rawBody }) => {
    const res = await callerA.call(resolveDedupe, { rawBody });
    expect(res.status).toBe(400);
  });

  it('toggle round-trips; toggling B item as A → 404, B row unchanged', async () => {
    const itemA = await seedItem(execA, USER_A);
    const res = await callerA.call(toggleAvailability, { body: { item_id: itemA, availability: 'dirty' } });
    expect(res.status).toBe(200);
    const fresh = await execA.query<{ availability: string }>(
      `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
      [itemA],
    );
    expect(fresh.rows[0]?.availability).toBe('dirty');

    const execB = makeTenantExecutor(pool, USER_B);
    const itemB = await seedItem(execB, USER_B);
    const cross = await callerA.call(toggleAvailability, { body: { item_id: itemB, availability: 'unavailable' } });
    expect(cross.status).toBe(404);
    const bFresh = await execB.query<{ availability: string }>(
      `SELECT availability FROM public.wardrobe_items WHERE id = $1`,
      [itemB],
    );
    expect(bFresh.rows[0]?.availability).toBe('clean');
  });

  it('bare DELETE of a worn item raises FK 23503 — the moat is RESTRICT-protected', async () => {
    const item = await seedItem(execA, USER_A);
    await execA.query(`INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'w-restrict')`, [
      USER_A,
      item,
    ]);
    await expect(
      execA.query(`DELETE FROM public.wardrobe_items WHERE user_id = $1 AND id = $2`, [USER_A, item]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('dedupe MERGE preserves the wear moat (differential counts) and re-points refs', async () => {
    const keep = await seedItem(execA, USER_A);
    const discard = await seedItem(execA, USER_A);
    // 2 wear rows + a shared outfit (contains BOTH keep and discard → UNIQUE branch)
    // + a solo outfit (contains only discard → plain re-point).
    await execA.query(`INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'w1'),($1,$2,'w2')`, [
      USER_A,
      discard,
    ]);
    const shared = (
      await execA.query<{ id: string }>(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'shared') RETURNING id`, [
        USER_A,
      ])
    ).rows[0]!.id;
    const solo = (
      await execA.query<{ id: string }>(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'solo') RETURNING id`, [
        USER_A,
      ])
    ).rows[0]!.id;
    await execA.query(`INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3),($1,$2,$4)`, [
      USER_A,
      shared,
      keep,
      discard,
    ]);
    await execA.query(`INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`, [
      USER_A,
      solo,
      discard,
    ]);

    const wearBefore = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1`,
      [USER_A],
    );

    const res = await callerA.call(resolveDedupe, { body: { keep_id: keep, discard_id: discard } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true });

    // Moat preserved: total wear count unchanged, discard's rows now on keep.
    const wearAfter = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE user_id = $1`,
      [USER_A],
    );
    expect(wearAfter.rows[0]?.n).toBe(wearBefore.rows[0]?.n);
    const onDiscard = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [discard],
    );
    expect(onDiscard.rows[0]?.n).toBe('0');
    const onKeep = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [keep],
    );
    expect(onKeep.rows[0]?.n).toBe('2');
    // discard gone, keep remains.
    const discardGone = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE id = $1`,
      [discard],
    );
    expect(discardGone.rows[0]?.n).toBe('0');
    // No duplicate (outfit_id,item_id) — the UNIQUE-collision branch dropped the dup.
    const dupMembership = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT outfit_id, item_id FROM public.outfit_items GROUP BY outfit_id, item_id HAVING count(*) > 1
       ) t`,
    );
    expect(dupMembership.rows[0]?.n).toBe('0');
  });

  it('dedupe is idempotent — retry after merge → { merged:false }, no error', async () => {
    const keep = await seedItem(execA, USER_A);
    const discard = await seedItem(execA, USER_A);
    await callerA.call(resolveDedupe, { body: { keep_id: keep, discard_id: discard } });
    const retry = await callerA.call(resolveDedupe, { body: { keep_id: keep, discard_id: discard } });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ merged: false });
  });

  it('dedupe naming B ids as A → 403 (loud cross-tenant fail), B byte-unchanged (control)', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const bKeep = await seedItem(execB, USER_B);
    const bDiscard = await seedItem(execB, USER_B);
    // Seed B wear rows on the discard so the oracle proves the moat is untouched.
    await execB.query(`INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'bw1'),($1,$2,'bw2')`, [
      USER_B,
      bDiscard,
    ]);
    // Snapshot B's state BEFORE the probe (the response is never the oracle).
    const bWearOnDiscardBefore = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [bDiscard],
    );

    // A names B's ids: the SECURITY DEFINER merge fn sees they are owned by another
    // tenant and RAISEs 42501 (a cross-tenant probe fails LOUD, never a silent
    // no-op) → the handler maps it to 403. Anti-mirror control: the fn runs as its
    // owner (RLS-exempt), so ONLY the explicit ownership guard stops A touching B.
    const res = await callerA.call(resolveDedupe, { body: { keep_id: bKeep, discard_id: bDiscard } });
    expect(res.status).toBe(403);

    // DB-state oracle: B's items + wear rows are byte-unchanged (the RAISE rolled
    // the whole merge back), not merely "the response said no".
    const bItems = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE id IN ($1,$2)`,
      [bKeep, bDiscard],
    );
    expect(bItems.rows[0]?.n).toBe('2');
    const bWearOnDiscardAfter = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [bDiscard],
    );
    expect(bWearOnDiscardAfter.rows[0]?.n).toBe(bWearOnDiscardBefore.rows[0]?.n);
    expect(bWearOnDiscardAfter.rows[0]?.n).toBe('2');
    // No wear row was re-pointed onto B's keep.
    const bWearOnKeep = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [bKeep],
    );
    expect(bWearOnKeep.rows[0]?.n).toBe('0');
  });
});

// Invoke a handler with NO auth header to prove withAuth rejects it.
async function withoutAuth(handler: typeof listWardrobe, pool: Pool): Promise<Response> {
  const wrapped = withAuth(handler, {
    verifier: { verify: async (t: string) => ({ sub: t }) },
    makeExecutor: (u: string) => makeTenantExecutor(pool, u),
    newCorrelationId: () => 'c',
  });
  return wrapped(new Request('https://test.local/fn', { method: 'POST' }));
}
