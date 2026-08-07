// Independent oracle for task-01 (substrate + roles + harness).
// Tier-3 (migration reversibility / schema drift) + Tier-4 (RLS harness enablement).
// The oracle is the live Postgres catalog and its round-trip fingerprint — NOT a
// value the migration author computed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations, revertMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

// Deterministic dump of every catalog object the substrate creates, ordered and
// concatenated. Byte-identical across an up->down->up round trip iff the schema
// truly returned to its prior state (the differential oracle).
const FINGERPRINT_SQL = `
  SELECT string_agg(line, E'\\n' ORDER BY line) AS fp FROM (
    SELECT 'ns:' || nspname AS line FROM pg_namespace
      WHERE nspname IN ('auth','public')
    UNION ALL
    SELECT 'class:' || n.nspname || '.' || c.relname || ':' || c.relkind::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('auth','public') AND c.relkind IN ('r','v')
    UNION ALL
    SELECT 'proc:' || n.nspname || '.' || p.proname || ':' || pg_get_function_result(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('auth','public')
    UNION ALL
    SELECT 'role:' || rolname FROM pg_roles WHERE rolname = 'app_user'
    UNION ALL
    SELECT 'grant:' || grantee || ':' || privilege_type || ':' || table_schema || '.' || table_name
      FROM information_schema.role_table_grants WHERE grantee = 'app_user'
  ) t
`;

async function fingerprint(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ fp: string }>(FINGERPRINT_SQL);
  return rows[0]?.fp ?? '';
}

describe('0001 substrate — round-trip + RLS harness enablement', () => {
  let harness: PgHarness;
  let pool: Pool;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('installs pgcrypto, auth.uid(), tg_set_updated_at, auth.users, and app_user with USAGE', async () => {
    const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'`);
    expect(ext.rowCount).toBe(1);
    const authUid = await pool.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' AND p.proname='uid'`);
    expect(authUid.rowCount).toBe(1);
    const trig = await pool.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='tg_set_updated_at'`);
    expect(trig.rowCount).toBe(1);
    const users = await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'`);
    expect(users.rowCount).toBe(1);
    const role = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='app_user'`);
    expect(role.rowCount).toBe(1);
    const usage = await pool.query(`SELECT has_schema_privilege('app_user','public','USAGE') AS ok`);
    expect(usage.rows[0].ok).toBe(true);
  });

  it('up->down->up yields a byte-identical schema fingerprint', async () => {
    const before = await fingerprint(pool);
    await revertMigrations(pool);
    await applyMigrations(pool);
    const after = await fingerprint(pool);
    expect(after).toBe(before);
    expect(after).toContain('proc:auth.uid');
    expect(after).toContain('role:app_user');
  });

  it('tenant executor resolves auth.uid() to the scoped uuid', async () => {
    const execA = makeTenantExecutor(pool, USER_A);
    const { rows } = await execA.query<{ uid: string }>('SELECT auth.uid() AS uid');
    expect(rows[0]?.uid).toBe(USER_A);
  });

  it('auth.uid() returns NULL on an empty sub (NULLIF, not a cast error)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.sub', '']);
      const { rows } = await client.query<{ uid: string | null }>('SELECT auth.uid() AS uid');
      expect(rows[0]?.uid).toBeNull();
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('concurrent tenant executors do not leak sub across connections', async () => {
    const execA = makeTenantExecutor(pool, USER_A);
    const execB = makeTenantExecutor(pool, USER_B);
    const [a, b] = await Promise.all([
      execA.query<{ uid: string }>('SELECT auth.uid() AS uid'),
      execB.query<{ uid: string }>('SELECT auth.uid() AS uid'),
    ]);
    expect(a.rows[0]?.uid).toBe(USER_A);
    expect(b.rows[0]?.uid).toBe(USER_B);
  });

  it('superuser control bypasses RLS while the tenant path is role-constrained', async () => {
    // Build a throwaway RLS-forced table owned by the superuser; the superuser
    // executor sees the row (RLS bypassed), the tenant executor sees 0 — proving
    // any later test omitting SET LOCAL ROLE app_user proves nothing.
    await pool.query(`CREATE TABLE public._rls_probe (user_id uuid NOT NULL)`);
    await pool.query(`ALTER TABLE public._rls_probe ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE public._rls_probe FORCE ROW LEVEL SECURITY`);
    await pool.query(`CREATE POLICY p ON public._rls_probe FOR SELECT USING (auth.uid() = user_id)`);
    await pool.query(`GRANT SELECT ON public._rls_probe TO app_user`);
    await pool.query(`INSERT INTO public._rls_probe (user_id) VALUES ($1)`, [USER_A]);

    const superuser = makeSuperuserExecutor(pool);
    const seenBySuperuser = await superuser.query('SELECT * FROM public._rls_probe');
    expect(seenBySuperuser.rows.length).toBe(1);

    const execB = makeTenantExecutor(pool, USER_B);
    const seenByB = await execB.query('SELECT * FROM public._rls_probe');
    expect(seenByB.rows.length).toBe(0);

    await pool.query(`DROP TABLE public._rls_probe`);
  });
});
