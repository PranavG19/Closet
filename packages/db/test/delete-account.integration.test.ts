// Independent oracle for public.delete_my_account() + makeAccountRepo (migration
// 0014). Tier-3: driven as app_user through makeTenantExecutor against a real
// Postgres with the FULL migration chain, so RLS + the grant matrix are exactly
// production's.
//
// The oracle is deliberately NOT the function's own jsonb return value — a purge fn
// grading its own counts is a mirror. Every assertion that matters here is an
// INDEPENDENT SUPERUSER SELECT taken after the fact, from a vantage the DELETEs
// inside the definer body do not control:
//   * full purge      -> superuser counts ZERO A-rows across all 7 tenant tables.
//   * RESTRICT        -> a bare app_user DELETE of a WORN garment raises 23503,
//                        proving the wear_log-first order is load-bearing, not
//                        incidental; delete_my_account then succeeds on the same row.
//   * tenant isolation-> B's rows are captured byte-for-byte BEFORE A's purge and
//                        compared after. A definer fn bypasses RLS, so this is the
//                        whole risk surface: nothing but a full-fidelity before/after
//                        of the victim's rows proves A cannot reach B.
//   * no user_id arg  -> pg_catalog is asked for the real signature. If the fn ever
//                        grows a uuid parameter, A could name B and the isolation
//                        proof above would become an accident of the test's inputs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import { makeAccountRepo, type AccountPurgeCounts } from '../src/repos/account.repo.js';
import { applyMigrations, downSection, upSection } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const USER_C = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';

// The seven tenant tables the purge must clear. webhook_events is excluded on
// purpose: it has no user_id, is not tenant data, and is service_role-only.
const TENANT_TABLES = [
  'wear_log',
  'outfit_items',
  'outfits',
  'wardrobe_items',
  'parse_jobs',
  'palette_profile',
  'subscriptions',
] as const;

interface SeedIds {
  readonly jobId: string;
  readonly itemId: string;
  readonly outfitId: string;
  readonly wearId: string;
}

// Seed one row in every one of the 7 tenant tables for `userId`, including a
// wear_log row pointing at the garment — the ON DELETE RESTRICT case a naive purge
// trips on. Tenant rows go in as app_user (so RLS WITH CHECK is exercised); the
// money row goes in via the superuser/service_role seam because app_user is
// SELECT-only on subscriptions by design.
async function seedFullTenant(pool: Pool, userId: string, tag: string): Promise<SeedIds> {
  const exec = makeTenantExecutor(pool, userId);
  const superuser = makeSuperuserExecutor(pool);

  const job = await exec.query<{ id: string }>(
    `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
     VALUES ($1,$2,$3,'full') RETURNING id`,
    [userId, `hash-${tag}`, `originals/${tag}.jpg`],
  );
  const jobId = job.rows[0]!.id;

  const item = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category, color, cutout_path, parse_job_id, phash)
     VALUES ($1,'top',$2,$3,$4, 1234567890123456789) RETURNING id`,
    [userId, `color-${tag}`, `cutouts/${tag}.png`, jobId],
  );
  const itemId = item.rows[0]!.id;

  const outfit = await exec.query<{ id: string }>(
    `INSERT INTO public.outfits (user_id, name) VALUES ($1,$2) RETURNING id`,
    [userId, `outfit-${tag}`],
  );
  const outfitId = outfit.rows[0]!.id;

  await exec.query(
    `INSERT INTO public.outfit_items (outfit_id, user_id, item_id, slot, position)
     VALUES ($1,$2,$3,'top',0)`,
    [outfitId, userId, itemId],
  );

  // The RESTRICT case: a wear row referencing the garment above.
  const wear = await exec.query<{ id: string }>(
    `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId, itemId, outfitId, `client-${tag}`],
  );
  const wearId = wear.rows[0]!.id;

  await exec.query(`INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,$2)`, [
    userId,
    JSON.stringify([`hue-${tag}`]),
  ]);

  // subscriptions: app_user has SELECT only (the money table), so the service_role
  // seam seeds it — the same way production's RevenueCat webhook does.
  await superuser.query(
    `INSERT INTO public.subscriptions (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at)
     VALUES ($1,$2,true,now(),'2099-01-01T00:00:00Z')`,
    [userId, `rc-${tag}`],
  );

  return { jobId, itemId, outfitId, wearId };
}

// Independent count of a user's rows in every tenant table, taken as SUPERUSER so
// RLS cannot hide a survivor from the assertion (an app_user SELECT would return 0
// for another tenant's rows and for its OWN rows post-purge — indistinguishable).
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

// Full-fidelity snapshot of every row a user owns, ordered deterministically, as
// SUPERUSER. Compared before/after A's purge to prove B is byte-unchanged — not
// merely "still present", but identical in every column.
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

function pgErrorCode(thrown: unknown): string | undefined {
  if (typeof thrown !== 'object' || thrown === null) return undefined;
  return (thrown as { code?: string }).code;
}

describe('public.delete_my_account() — purge as app_user, oracle as superuser', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('signature takes NO arguments — a caller cannot target another tenant', async () => {
    // pg_catalog is the authority on the real signature, not the migration text. A
    // zero-arg fn makes cross-tenant targeting UNREPRESENTABLE rather than merely
    // unexercised: with no parameter, `delete_my_account(<B>)` does not typecheck.
    const { rows } = await superuser.query<{
      nargs: number;
      args: string;
      prosecdef: boolean;
      config: string[] | null;
    }>(
      `SELECT pronargs AS nargs,
              pg_get_function_arguments(p.oid) AS args,
              p.prosecdef,
              p.proconfig AS config
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'delete_my_account'`,
    );
    expect(rows.length).toBe(1);
    const fn = rows[0]!;
    expect(fn.nargs).toBe(0);
    expect(fn.args).toBe('');
    expect(fn.prosecdef).toBe(true);
    // The hardening the check-definer-search-path gate exists to enforce, verified
    // here against the LIVE catalog rather than the file text. Postgres normalizes
    // `SET search_path = ''` into proconfig as the quoted-empty `search_path=""`.
    expect(fn.config).toEqual(['search_path=""']);

    // And the negative: calling it with a uuid argument does not resolve at all.
    await expect(
      superuser.query(`SELECT public.delete_my_account($1::uuid)`, [USER_B]),
    ).rejects.toMatchObject({ code: '42883' });
  });

  it('bare DELETE of a WORN garment raises 23503 — the wear_log-first order is load-bearing', async () => {
    const user = 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5';
    const seeded = await seedFullTenant(pool, user, 'restrict');
    const exec = makeTenantExecutor(pool, user);

    // app_user HAS delete on wardrobe_items (0010), so this is a genuine attempt,
    // not a 42501 permission stub. It fails on the RESTRICT FK from wear_log.
    let code: string | undefined;
    try {
      await exec.query(`DELETE FROM public.wardrobe_items WHERE user_id = $1 AND id = $2`, [
        user,
        seeded.itemId,
      ]);
    } catch (thrown) {
      code = pgErrorCode(thrown);
    }
    expect(code).toBe('23503');

    // Independent confirmation the failed delete changed nothing.
    const before = await countRowsAsSuperuser(superuser, user);
    expect(before['wardrobe_items']).toBe(1);
    expect(before['wear_log']).toBe(1);

    // The ordered purge succeeds on the very same row the bare delete could not touch.
    const counts = await makeAccountRepo(exec).deleteMyAccount();
    expect(counts.wear_log).toBe(1);
    expect(counts.wardrobe_items).toBe(1);

    const after = await countRowsAsSuperuser(superuser, user);
    for (const table of TENANT_TABLES) expect(after[table]).toBe(0);
  });

  it('full purge — every row in all 7 tenant tables is gone (superuser SELECT)', async () => {
    const seeded = await seedFullTenant(pool, USER_A, 'a');
    const execA = makeTenantExecutor(pool, USER_A);

    // Precondition, independently observed: A really does have a row everywhere.
    const before = await countRowsAsSuperuser(superuser, USER_A);
    for (const table of TENANT_TABLES) expect(before[table]).toBe(1);

    const counts: AccountPurgeCounts = await makeAccountRepo(execA).deleteMyAccount();

    // The independent oracle: ZERO A-rows anywhere. This is what proves the FK
    // order is right — a wrong order would have raised 23503 and rolled the whole
    // function back, leaving these counts at 1.
    const after = await countRowsAsSuperuser(superuser, USER_A);
    for (const table of TENANT_TABLES) expect(after[table]).toBe(0);

    // Specific ids gone, not just "some rows gone".
    for (const [table, id] of [
      ['parse_jobs', seeded.jobId],
      ['wardrobe_items', seeded.itemId],
      ['outfits', seeded.outfitId],
      ['wear_log', seeded.wearId],
    ] as const) {
      const { rows } = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${table} WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.n).toBe('0');
    }

    // The reported summary must agree with what the superuser observed (7 rows).
    expect(counts.total).toBe(7);
    expect(counts).toMatchObject({
      wear_log: 1,
      outfit_items: 1,
      outfits: 1,
      wardrobe_items: 1,
      parse_jobs: 1,
      palette_profile: 1,
      subscriptions: 1,
    });
  });

  it('is idempotent — a retried purge returns all zeros, not an error', async () => {
    const execA = makeTenantExecutor(pool, USER_A);
    const counts = await makeAccountRepo(execA).deleteMyAccount();
    expect(counts.total).toBe(0);
  });

  it("TENANT ISOLATION — A's purge leaves every B row byte-unchanged", async () => {
    await seedFullTenant(pool, USER_B, 'b');
    const bBefore = await snapshotAsSuperuser(superuser, USER_B);
    // Guard the guard: an empty snapshot would make the comparison vacuously true.
    for (const table of TENANT_TABLES) expect(bBefore[table]!.length).toBe(1);

    // A re-seeds and purges. A definer fn bypasses RLS, so if the body's user_id
    // filter were ever dropped this is the test that catches it.
    await seedFullTenant(pool, USER_A, 'a2');
    const counts = await makeAccountRepo(makeTenantExecutor(pool, USER_A)).deleteMyAccount();
    expect(counts.total).toBe(7);

    const bAfter = await snapshotAsSuperuser(superuser, USER_B);
    // Byte-for-byte, every column of every row. Not "B still has rows" — identical.
    expect(bAfter).toEqual(bBefore);
    const bCounts = await countRowsAsSuperuser(superuser, USER_B);
    for (const table of TENANT_TABLES) expect(bCounts[table]).toBe(1);
  });

  it('RLS-in-effect control — C purging touches nothing and B survives', async () => {
    // C has no rows: a zero-total purge that must not reach into B (proves the fn
    // deletes by auth.uid(), not "whatever it can see" — the definer sees everything).
    const bBefore = await snapshotAsSuperuser(superuser, USER_B);
    const counts = await makeAccountRepo(makeTenantExecutor(pool, USER_C)).deleteMyAccount();
    expect(counts.total).toBe(0);
    expect(await snapshotAsSuperuser(superuser, USER_B)).toEqual(bBefore);
  });

  it('no authenticated caller → 28000, and nothing is deleted', async () => {
    await seedFullTenant(pool, 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'noauth');
    const before = await countRowsAsSuperuser(superuser, 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6');
    expect(before['wardrobe_items']).toBe(1);

    // The superuser executor sets no request.jwt.claim.sub, so auth.uid() is NULL.
    let code: string | undefined;
    try {
      await superuser.query(`SELECT public.delete_my_account()`);
    } catch (thrown) {
      code = pgErrorCode(thrown);
    }
    expect(code).toBe('28000');

    const after = await countRowsAsSuperuser(superuser, 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6');
    expect(after).toEqual(before);
  });

  it("0014 DOWN is reversible on POPULATED data — drops the fn, touches no row", async () => {
    // CLAUDE.md: round-trip every DOWN on populated data, never an empty fixture. A
    // purge fn's DOWN must remove the CAPABILITY and nothing else — if it ever
    // deleted rows, this snapshot comparison is what catches it.
    const user = '99999999-9999-4999-8999-999999999999';
    await seedFullTenant(pool, user, 'down');
    const before = await snapshotAsSuperuser(superuser, user);
    for (const table of TENANT_TABLES) expect(before[table]!.length).toBe(1);

    // The DOWN section verbatim from the migration file, so this exercises the real
    // text `pnpm db:migrate down` would run, not a paraphrase.
    const down = downSection(
      await readFile(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0014_delete_account_fn.sql'),
        'utf8',
      ),
    );
    await pool.query(down);

    // Capability gone: the fn no longer resolves (42883).
    await expect(superuser.query(`SELECT public.delete_my_account()`)).rejects.toMatchObject({
      code: '42883',
    });
    // Data untouched — byte-for-byte.
    expect(await snapshotAsSuperuser(superuser, user)).toEqual(before);

    // Re-apply UP: capability returns, data still untouched, grant restored so
    // app_user can call it again (the redo half of the round trip).
    const up = upSection(
      await readFile(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0014_delete_account_fn.sql'),
        'utf8',
      ),
    );
    await pool.query(up);
    expect(await snapshotAsSuperuser(superuser, user)).toEqual(before);
    const counts = await makeAccountRepo(makeTenantExecutor(pool, user)).deleteMyAccount();
    expect(counts.total).toBe(7);
  });
});
