// executor — the two seams every RLS test needs.
//
// makeTenantExecutor drives statements the way the real Edge runtime does: each
// query runs in its own transaction that first drops to the least-privilege
// `app_user` role and sets the PostgREST request-context sub, so `auth.uid()`
// resolves to the tenant and RLS confines every row. The signature matches the
// QueryExecutor interface repos consume in later waves, so a repo can be driven
// by this executor unchanged.
//
// makeSuperuserExecutor runs statements with NO role switch. It exists to prove
// the negative: the container superuser bypasses RLS, so any test that forgets
// SET LOCAL ROLE app_user proves nothing. Tests use it as the control that MUST
// return rows / MUST succeed where the tenant path is refused.
import type { Pool } from 'pg';

export interface QueryExecutor {
  query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export function makeTenantExecutor(pool: Pool, userId: string): QueryExecutor {
  return {
    async query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_user');
        await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
        const result = await client.query(sql, params ? [...params] : undefined);
        await client.query('COMMIT');
        return { rows: result.rows as Row[] };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function makeSuperuserExecutor(pool: Pool): QueryExecutor {
  return {
    async query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }> {
      const result = await pool.query(sql, params ? [...params] : undefined);
      return { rows: result.rows as Row[] };
    },
  };
}
