// The production QueryExecutor. It is byte-for-byte the same seam the W1 test
// helper `makeTenantExecutor` exposes: each query() runs in its OWN transaction
// that first drops to the least-privilege `app_user` role and sets the verified
// sub as `request.jwt.claim.sub`, so `auth.uid()` resolves to the caller and RLS
// confines every row. One tx per query() call (CLAUDE.md) — atomicity that spans
// rows must live inside a single SQL statement or plpgsql fn, never across two
// query() calls (they are two transactions).
//
// It is defined over a minimal `Sql` connection-pool interface rather than a
// concrete `pg.Pool`, so the same code runs under node-postgres (tests / Node
// Edge) and under a Deno pg pool without a driver import leaking into the handler
// layer. The concrete pool is injected at the Deno shim / test boundary.
import type { QueryExecutor } from '@closet/db';

export interface SqlResult<Row> {
  rows: Row[];
}

export interface SqlConnection {
  query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<SqlResult<Row>>;
  release(): void;
}

export interface Sql {
  connect(): Promise<SqlConnection>;
}

// makeServiceExecutor — the ONLY sanctioned RLS-bypass seam in the codebase.
// Same one-tx-per-query() shape as makePgExecutor, but it deliberately does NOT
// `SET LOCAL ROLE app_user` and binds NO sub: every statement runs as the injected
// connection's OWN identity (the service_role in production, the RLS-exempt
// container superuser in tests — the test harness's superuser executor is the
// analog). That RLS-exempt identity is what lets `applyEvent`/`record` write the
// money + ledger tables that app_user has no grant on.
//
// This is a SYSTEM-JOB seam only — the revenuecat-webhook (there is no end-user in
// that request) and, later, the parse worker. It is NEVER used on a user request:
// a user request carries a verified JWT sub and MUST go through makePgExecutor so
// RLS confines it. Because the pool is already the service_role, no `SET LOCAL
// ROLE` is issued — setting no role runs as the connection's identity in both
// runtimes; atomicity stays inside the single repo statement (one tx per query).
export function makeServiceExecutor(sql: Sql): QueryExecutor {
  return {
    async query<Row = unknown>(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }> {
      const conn = await sql.connect();
      try {
        await conn.query('BEGIN');
        const result = await conn.query<Row>(text, params ? [...params] : undefined);
        await conn.query('COMMIT');
        return { rows: result.rows };
      } catch (error) {
        await conn.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        conn.release();
      }
    },
  };
}

// The sub is bound via set_config($1,$2,true) — a parameter, never string
// interpolation, so a hostile sub cannot break out of the claim value. The role
// name is a fixed literal (`app_user`); it is never derived from input.
export function makePgExecutor(sql: Sql, userId: string): QueryExecutor {
  return {
    async query<Row = unknown>(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }> {
      const conn = await sql.connect();
      try {
        await conn.query('BEGIN');
        await conn.query('SET LOCAL ROLE app_user');
        await conn.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
        const result = await conn.query<Row>(text, params ? [...params] : undefined);
        await conn.query('COMMIT');
        return { rows: result.rows };
      } catch (error) {
        await conn.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        conn.release();
      }
    },
  };
}
