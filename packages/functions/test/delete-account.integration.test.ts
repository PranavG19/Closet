// Independent oracle for the deleteAccount handler (Apple 5.1.1(v) in-app account
// deletion). Driven through the REAL withAuth over a real Postgres with the FULL
// migration chain, so every call runs as app_user with the verified sub bound —
// production's identity + RLS path, not a mock.
//
// Every "was anything deleted" assertion is an INDEPENDENT SUPERUSER SELECT, never
// the handler's own response body. The response is checked for shape/status; the
// DATABASE is checked for truth.
//
// The load-bearing case is the body-smuggled user_id: the request schema is
// .strict() so it 400s, and even if it did not, the purge takes no user id at any
// layer (repo call has no argument, the SQL fn has zero parameters) — so B's rows
// are unreachable from A's request by construction, and this test proves it against
// a full-fidelity before/after snapshot of B.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { deleteAccount } from '../src/account/delete-account.js';
import { withAuth } from '../src/auth/withAuth.js';
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

const TENANT_TABLES = [
  'wear_log',
  'outfit_items',
  'outfits',
  'wardrobe_items',
  'parse_jobs',
  'palette_profile',
  'subscriptions',
] as const;

// One row in each of the 7 tenant tables, including the wear_log row that makes the
// garment un-deletable without the ordered purge (ON DELETE RESTRICT). Tenant rows
// as app_user; the money row via the service_role seam (app_user is SELECT-only).
async function seedFullTenant(pool: Pool, userId: string, tag: string): Promise<void> {
  const exec = makeTenantExecutor(pool, userId);
  const superuser = makeSuperuserExecutor(pool);

  const job = await exec.query<{ id: string }>(
    `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
     VALUES ($1,$2,$3,'full') RETURNING id`,
    [userId, `hash-${tag}`, `originals/${tag}.jpg`],
  );
  const item = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category, cutout_path, parse_job_id)
     VALUES ($1,'top',$2,$3) RETURNING id`,
    [userId, `cutouts/${tag}.png`, job.rows[0]!.id],
  );
  const outfit = await exec.query<{ id: string }>(
    `INSERT INTO public.outfits (user_id, name) VALUES ($1,$2) RETURNING id`,
    [userId, `outfit-${tag}`],
  );
  await exec.query(
    `INSERT INTO public.outfit_items (outfit_id, user_id, item_id, slot, position)
     VALUES ($1,$2,$3,'top',0)`,
    [outfit.rows[0]!.id, userId, item.rows[0]!.id],
  );
  await exec.query(
    `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
     VALUES ($1,$2,$3,$4)`,
    [userId, item.rows[0]!.id, outfit.rows[0]!.id, `client-${tag}`],
  );
  await exec.query(`INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,$2)`, [
    userId,
    JSON.stringify([`hue-${tag}`]),
  ]);
  await superuser.query(
    `INSERT INTO public.subscriptions (user_id, rc_app_user_id, entitlement_active)
     VALUES ($1,$2,true)`,
    [userId, `rc-${tag}`],
  );
}

async function countRowsAsSuperuser(
  superuser: QueryExecutor,
  userId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
      [userId],
    );
    counts[table] = Number(rows[0]?.n);
  }
  return counts;
}

async function snapshotAsSuperuser(
  superuser: QueryExecutor,
  userId: string,
): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of TENANT_TABLES) {
    const { rows } = await superuser.query<{ row: unknown }>(
      `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE t.user_id = $1
       ORDER BY to_jsonb(t)::text`,
      [userId],
    );
    snapshot[table] = rows.map((r) => r.row);
  }
  return snapshot;
}

describe('deleteAccount handler — confirmation-gated, caller-scoped purge', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('missing body → 400 and ZERO rows deleted (superuser SELECT)', async () => {
    await seedFullTenant(pool, USER_A, 'a-nobody');
    const before = await countRowsAsSuperuser(superuser, USER_A);
    for (const table of TENANT_TABLES) expect(before[table]).toBe(1);

    const res = await callerA.call(deleteAccount);
    expect(res.status).toBe(400);

    expect(await countRowsAsSuperuser(superuser, USER_A)).toEqual(before);
  });

  it('wrong confirm value → 400 and ZERO rows deleted', async () => {
    const before = await countRowsAsSuperuser(superuser, USER_A);
    for (const wrong of [{}, { confirm: 'delete' }, { confirm: 'DELETE_ME' }, { confirm: true }]) {
      const res = await callerA.call(deleteAccount, { body: wrong });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('invalid_request');
    }
    // Not one row moved across four near-miss attempts.
    expect(await countRowsAsSuperuser(superuser, USER_A)).toEqual(before);
  });

  it('extra key (strict) → 400 and ZERO rows deleted', async () => {
    const before = await countRowsAsSuperuser(superuser, USER_A);
    const res = await callerA.call(deleteAccount, { body: { confirm: 'DELETE', force: true } });
    expect(res.status).toBe(400);
    expect(await countRowsAsSuperuser(superuser, USER_A)).toEqual(before);
  });

  it("body-smuggled user_id is inert — B untouched, and A's own rows are not purged either", async () => {
    await seedFullTenant(pool, USER_B, 'b');
    const bBefore = await snapshotAsSuperuser(superuser, USER_B);
    for (const table of TENANT_TABLES) expect(bBefore[table]!.length).toBe(1);
    const aBefore = await countRowsAsSuperuser(superuser, USER_A);

    // The attack: A asks to delete B by naming B in the body. .strict() rejects the
    // extra key outright (400), and there is no argument on the repo call or the SQL
    // fn that could have carried it anyway.
    const res = await callerA.call(deleteAccount, {
      body: { confirm: 'DELETE', user_id: USER_B },
    });
    expect(res.status).toBe(400);

    expect(await snapshotAsSuperuser(superuser, USER_B)).toEqual(bBefore);
    expect(await countRowsAsSuperuser(superuser, USER_A)).toEqual(aBefore);
  });

  it('unauthenticated (no bearer) → 401 and ZERO rows deleted', async () => {
    const before = await countRowsAsSuperuser(superuser, USER_A);
    // Wrap in the REAL withAuth (same deps makeCaller uses) but send NO authorization
    // header, so the 401 comes from the production wrapper — the handler never runs.
    const wrapped = withAuth(deleteAccount, {
      verifier: { verify: async (token: string) => ({ sub: token }) },
      makeExecutor: (verifiedUser: string) => makeTenantExecutor(pool, verifiedUser),
      newCorrelationId: () => 'test-correlation',
    });
    const res = await wrapped(
      new Request('https://test.local/fn', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'DELETE' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(401);
    expect(await countRowsAsSuperuser(superuser, USER_A)).toEqual(before);
  });

  it('correct confirm → 200, summary matches, and ALL A rows are gone (superuser SELECT)', async () => {
    // A's rows are still the single set seeded in the first test — every rejected
    // attempt above left them intact, which is itself part of the proof.
    const before = await countRowsAsSuperuser(superuser, USER_A);
    for (const table of TENANT_TABLES) expect(before[table]).toBe(1);

    const res = await callerA.call(deleteAccount, { body: { confirm: 'DELETE' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deleted: Record<string, number>;
    };
    expect(body.deleted).toEqual({
      wear_log: 1,
      outfit_items: 1,
      outfits: 1,
      wardrobe_items: 1,
      parse_jobs: 1,
      palette_profile: 1,
      subscriptions: 1,
      total: 7,
    });

    // The oracle: the DB, not the response.
    const after = await countRowsAsSuperuser(superuser, USER_A);
    for (const table of TENANT_TABLES) expect(after[table]).toBe(0);
  });

  it("B's rows survived every A operation in this file, byte-unchanged", async () => {
    const bRows = await countRowsAsSuperuser(superuser, USER_B);
    for (const table of TENANT_TABLES) expect(bRows[table]).toBe(1);
  });

  it('a retried delete is idempotent — 200 with all-zero counts', async () => {
    const res = await callerA.call(deleteAccount, { body: { confirm: 'DELETE' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: { total: number } };
    expect(body.deleted.total).toBe(0);
  });
});
