// Independent oracle for the palette + entitlement endpoints (task-12, B1). Palette
// upsert is 1:1 and RLS-scoped; the entitlement read reflects the money table,
// defaults to not-entitled when absent, and is scoped — a user can read but never
// mint entitlement (the money row is seeded via the superuser/service_role seam,
// confirming app_user has no write path).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { upsertPalette } from '../src/palette/upsert-palette.js';
import { readEntitlement } from '../src/palette/read-entitlement.js';
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

describe('palette + entitlement endpoints', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let callerB: Caller;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    callerB = makeCaller(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('palette upsert is 1:1 — second upsert updates in place, one row', async () => {
    await callerA.call(upsertPalette, { body: { hues: ['red'] } });
    const res = await callerA.call(upsertPalette, { body: { hues: ['blue', 'teal'] } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hues: string[] };
    expect(body.hues).toEqual(['blue', 'teal']);
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.palette_profile WHERE user_id = $1`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('palette is RLS-scoped — A never sees B palette', async () => {
    // THIS TEST WAS VACUOUS. It used to upsert as B, read B's row with the SUPERUSER (which
    // bypasses RLS and therefore proves nothing about isolation), then upsert as A and assert
    // A's own echo — never once having A ATTEMPT TO READ B. It would have passed with RLS
    // entirely disabled, while its name and comments claimed to prove the opposite.
    await callerB.call(upsertPalette, { body: { hues: ['bsecret'] } });
    await callerA.call(upsertPalette, { body: { hues: ['aonly'] } });

    // Confirm both rows genuinely exist, via the superuser — this is the ONLY legitimate use
    // of the RLS-bypassing executor here: establishing that the negative result below is real
    // isolation and not simply an empty table.
    const all = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.palette_profile WHERE user_id IN ($1, $2)`,
      [USER_A, USER_B],
    );
    expect(all.rows[0]?.n).toBe('2');

    // THE ACTUAL ORACLE: A reaches for B's row under A's OWN tenant context.
    // makeTenantExecutor is the SAME executor withAuth hands a real request — it sets
    // LOCAL ROLE app_user plus the request.jwt claim for USER_A — so this has exactly the
    // privilege a live request has, not the superuser's RLS bypass. RLS must return zero rows.
    const asA = makeTenantExecutor(pool, USER_A);
    const crossTenant = await asA.query<{ hues: string[] }>(
      `SELECT hues FROM public.palette_profile WHERE user_id = $1`,
      [USER_B],
    );
    expect(crossTenant.rows).toHaveLength(0);

    // And an unscoped SELECT — no WHERE at all — sees ONLY A's row. This is the stronger
    // form: it catches a policy that filters on a column the caller could simply omit.
    const everythingAcanSee = await asA.query<{ user_id: string; hues: string[] }>(
      `SELECT user_id, hues FROM public.palette_profile`,
    );
    expect(everythingAcanSee.rows).toHaveLength(1);
    expect(everythingAcanSee.rows[0]?.user_id).toBe(USER_A);
    expect(everythingAcanSee.rows[0]?.hues).toEqual(['aonly']);
  });

  it('palette malformed body (extra key, strict) → 400', async () => {
    const res = await callerA.call(upsertPalette, { body: { hues: ['x'], extra: 1 } });
    expect(res.status).toBe(400);
  });

  // An UNPARSEABLE body (dropped connection mid-POST), not merely a wrong shape.
  // 400, never 500 — a 5xx would invite a retry of a body that can never parse. The
  // test above sends well-formed JSON, so it fails inside parseBoundary and never
  // reaches the req.json() throw.
  it.each([
    { label: 'empty', rawBody: '' },
    { label: 'truncated', rawBody: '{' },
  ])('palette upsert with an $label body → 400, never 500', async ({ rawBody }) => {
    const res = await callerA.call(upsertPalette, { rawBody });
    expect(res.status).toBe(400);
  });

  it('entitlement default — a user with no money row reads false/null (not 404)', async () => {
    const res = await callerB.call(readEntitlement);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entitlement_active: false, expires_at: null });
  });

  it('entitlement reflects the money table, scoped — A true, B still default', async () => {
    // Seed A's money row via the service_role (superuser) seam — app_user CANNOT.
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at)
       VALUES ($1,'rc_a', true, now(), '2099-01-01T00:00:00Z')`,
      [USER_A],
    );
    const aRes = await callerA.call(readEntitlement);
    expect(await aRes.json()).toMatchObject({ entitlement_active: true });
    // B never observes A's true — gets its own default.
    const bRes = await callerB.call(readEntitlement);
    expect(await bRes.json()).toEqual({ entitlement_active: false, expires_at: null });
  });
});
