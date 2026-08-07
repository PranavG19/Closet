// pool.ts — the ONE concrete Postgres driver adapter for every Edge shim. It is
// the only place in the deploy tree that imports a real pg driver; every handler
// stays driver-free and receives this as the injected `Sql` (executor.ts).
//
// `Sql` is the minimal connection-pool interface the handler layer is written
// against: { connect(): Promise<{ query, release }> }. node-postgres' Pool already
// matches it byte-for-byte (pool.connect() → PoolClient with .query()/.release(),
// and query() resolves to { rows }), so this adapter is a thin typed wrapper that
// (a) builds the pool from a connection-string env var read at runtime via
// Deno.env — NEVER a hardcoded literal — and (b) narrows the client to the exact
// `SqlConnection` shape so a driver type never leaks past this file.
//
// Two roles, two pools (see each function's index.ts header for which it uses):
//   * app_user-capable role (DATABASE_URL) — the 8 user-JWT handlers. makePgExecutor
//     issues `SET LOCAL ROLE app_user` per tx, so this connection's role need only
//     be GRANTed app_user; RLS then confines every row to the verified sub.
//   * service_role (SUPABASE_DB_SERVICE_URL) — the revenuecat-webhook only. Its
//     makeServiceExecutor issues NO SET ROLE, so the pool's OWN identity must be the
//     RLS-exempt service_role that can write the money + ledger tables.
import { Pool } from 'pg';
import type { Sql, SqlConnection } from '@closet/functions/auth/executor.js';

function requireConnectionString(envKey: string): string {
  const value = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(
    envKey,
  );
  if (value === undefined || value === '') {
    throw new Error(`missing required env: ${envKey}`);
  }
  return value;
}

// Build a lazily-connecting Sql pool over the connection string in `envKey`.
// One Pool per function instance; each connect() leases a pooled client and each
// executor's finally-block release()s it back (executor.ts owns BEGIN/COMMIT).
export function makePool(envKey: string): Sql {
  const pool = new Pool({ connectionString: requireConnectionString(envKey) });
  return {
    async connect(): Promise<SqlConnection> {
      const client = await pool.connect();
      return {
        async query<Row = unknown>(sql: string, params?: readonly unknown[]) {
          const result = await client.query(sql, params ? [...params] : undefined);
          return { rows: result.rows as Row[] };
        },
        release(): void {
          client.release();
        },
      };
    },
  };
}
