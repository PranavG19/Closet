// Independent oracle for task-04 (subscriptions + webhook_events + check-rls gate).
// Tier-2 differential penetration on the money table + the structural gate as a
// second, schema-level oracle (green on the honest schema, red on a FORCE-stripped
// fire-drill). The oracle is real DB state / the catalog — never a return value.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a0000000-0000-0000-0000-0000000000aa';
const USER_B = 'b0000000-0000-0000-0000-0000000000bb';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = join(REPO_ROOT, 'scripts', 'gates', 'check-rls.mjs');

describe('0008/0009 subscriptions + webhook_events — money-table penetration + RLS gate', () => {
  let harness: PgHarness;
  let pool: Pool;
  let connectionString: string;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
    // The gate script connects via DATABASE_URL; build one for this container.
    const opts = pool.options as { host?: string; port?: number; user?: string; password?: string; database?: string };
    connectionString = `postgres://${opts.user}:${opts.password}@${opts.host}:${opts.port}/${opts.database}`;
    // Seed one subscriptions row as service_role (the container superuser bypasses
    // RLS, standing in for the webhook's service_role write path).
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, rc_app_user_id, entitlement_active) VALUES ($1,'rc_a',false)`,
      [USER_A],
    );
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('read own — A sees its own subscription row with the webhook-written value', async () => {
    const { rows } = await execA.query<{ entitlement_active: boolean }>(
      `SELECT entitlement_active FROM public.subscriptions`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.entitlement_active).toBe(false);
  });

  it('self-grant refused (INSERT) — app_user cannot insert a subscriptions row', async () => {
    await expect(
      execB.query(
        `INSERT INTO public.subscriptions (user_id, entitlement_active) VALUES ($1, true)`,
        [USER_B],
      ),
    ).rejects.toThrow();
    // Confirm no row landed for B (observed as superuser — the real oracle).
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [USER_B],
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('self-grant refused (UPDATE) — app_user cannot flip entitlement_active', async () => {
    await expect(
      execA.query(
        `UPDATE public.subscriptions SET entitlement_active = true WHERE user_id = $1`,
        [USER_A],
      ),
    ).rejects.toThrow();
    // Value stays false, observed as superuser.
    const { rows } = await superuser.query<{ entitlement_active: boolean }>(
      `SELECT entitlement_active FROM public.subscriptions WHERE user_id = $1`,
      [USER_A],
    );
    expect(rows[0]?.entitlement_active).toBe(false);
  });

  it('cross-tenant read empty — B sees 0 subscriptions while superuser confirms A exists', async () => {
    const bSees = await execB.query('SELECT user_id FROM public.subscriptions');
    expect(bSees.rows.length).toBe(0);
    // Must-fail control: the row exists (isolation, not emptiness, is measured).
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [USER_A],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('webhook_events opaque to tenants — app_user cannot SELECT or INSERT', async () => {
    await superuser.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt_seed')`);
    await expect(execA.query('SELECT event_id FROM public.webhook_events')).rejects.toThrow();
    await expect(
      execA.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt_hack')`),
    ).rejects.toThrow();
  });

  it('dedup — re-inserting the same event_id is a no-op (row count stays 1)', async () => {
    await superuser.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt_1')`);
    const dup = await superuser.query(
      `INSERT INTO public.webhook_events (event_id) VALUES ('evt_1') ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    );
    expect(dup.rows.length).toBe(0);
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = 'evt_1'`,
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('concurrent webhook upserts on one user_id serialize to a single row', async () => {
    const upsert = (active: boolean): Promise<{ rows: unknown[] }> =>
      superuser.query(
        `INSERT INTO public.subscriptions (user_id, entitlement_active) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET entitlement_active = excluded.entitlement_active`,
        [USER_B, active],
      );
    await Promise.allSettled([upsert(true), upsert(false)]);
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [USER_B],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('gate oracle — check-rls is GREEN on the honest migrated schema', () => {
    const result = spawnSync('node', [GATE], {
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
    });
    expect(result.stdout).toContain('subscriptions');
    expect(result.stdout).toContain('webhook_events');
    expect(result.status).toBe(0);
  });

  it('gate oracle — fire-drill: stripping FORCE off subscriptions makes check-rls RED', async () => {
    // Mutation target proving the gate has teeth. Done on this disposable container
    // and immediately restored; it never touches a committed migration.
    await superuser.query('ALTER TABLE public.subscriptions NO FORCE ROW LEVEL SECURITY');
    const red = spawnSync('node', [GATE], {
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
    });
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('subscriptions');
    // Restore so the container is left in the honest state.
    await superuser.query('ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY');
    const green = spawnSync('node', [GATE], {
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
    });
    expect(green.status).toBe(0);
  });
});
