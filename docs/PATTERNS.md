# Codebase patterns (extracted from fitapp — read THIS, don't re-explore the sibling repo)

Compact exemplars a task author/builder needs. Paths point at `../fitapp/...` for the full file; the essentials are inlined so you don't have to open them.

## Migration: substrate first (`packages/db/migrations/0001_substrate.sql`)
The FIRST migration is a dual-target substrate applied before every domain migration. It must:
- `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` (for `gen_random_uuid()`).
- **Dual-target auth bootstrap** — gated on `NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')` so it fabricates a mock ONLY on a bare testcontainer and is a no-op on hosted Supabase (where GoTrue owns `auth`):
  ```sql
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
    END IF;
  END $$;
  ```
- A shared `public.tg_set_updated_at()` trigger fn (`NEW.updated_at := now(); RETURN NEW;`).
- **DOWN** guarded on ownership (`nspowner = (SELECT oid FROM pg_roles WHERE rolname=current_user)`) so it only tears down the mock on a bare container, never Supabase's owned auth.
- Idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) so up→down→up redo hashes match.

## Migration: domain table + RLS FORCE (`packages/db/migrations/0002_*.sql`)
Every tenant table:
```sql
-- UP
CREATE TABLE public.<t> ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, ..., created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now() );
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_select_own ON public.<t> FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY <t>_insert_own ON public.<t> FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY <t>_update_own ON public.<t> FOR UPDATE USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
-- (append-only tables: NO update/delete policy. subscriptions: SELECT-only for app_user.)
CREATE TRIGGER <t>_set_updated_at BEFORE UPDATE ON public.<t>
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
-- GRANT the app_user role the DML the policies allow (SELECT/INSERT/UPDATE as applicable).
-- DOWN: DROP the policies, trigger, table (never the substrate).
```
Real DOWN, reversible. Files numbered `NNNN_slug.sql` with `-- UP Migration` / `-- DOWN Migration`.

## Repo: factory over an injected QueryExecutor (`packages/db/src/repos/*.repo.ts`)
```ts
import type { QueryExecutor } from './executor.js';
export interface QueryExecutor { query<Row=unknown>(sql:string, params?:readonly unknown[]):Promise<{rows:Row[]}>; }
export function make<X>Repo(exec: QueryExecutor): <X>Repo {
  return {
    async upsert(row){ await exec.query(`INSERT INTO public.<t> (...) VALUES ($1,...) ON CONFLICT (...) DO NOTHING`, [...]); },
    async getById(userId){ const {rows}=await exec.query<Row>(`SELECT ...::text, ...::float FROM public.<t> WHERE user_id=$1`, [userId]); return rows[0] ?? null; },
  };
}
```
Rules: a repo NEVER opens a connection, NEVER sets a role/JWT, NEVER holds service_role, NEVER bypasses RLS. Caller injects the executor carrying tenant context. Cast `timestamptz→::text`, `numeric→::float` in SELECT so rows match Zod schemas and survive JSON. Repos are the ONLY DB seam (`supabase.from()` lint-banned elsewhere).

## Handler: AuthedHandler, identity from ctx (`packages/functions/src/<domain>/*.ts`)
```ts
import { make<X>Repo } from '@closet/db';
import { <Schema>, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse } from '../auth/respond.js';
export const <name>: AuthedHandler = async (req, { userId, exec, correlationId }) => {
  // user_id is ALWAYS ctx.userId (the verified JWT sub) — NEVER from the body.
  const repo = make<X>Repo(exec);
  // ... parseBoundary(<RequestSchema>, body) for inputs ...
  return jsonResponse(200, parseBoundary(<ResultSchema>, result));
};
```
Response Zod-validated at the boundary. Deno shim (`supabase/functions/<name>/index.ts`) is ~3 lines: import built handler, `serveAuthed(handler)`.

## Integration test: real Postgres, SET LOCAL ROLE app_user (`*.integration.test.ts`)
- `applyMigrations(client)` applies the FULL chain (substrate + all domains).
- The executor runs each query in `BEGIN; SET LOCAL ROLE app_user; SET LOCAL request.jwt.claim.sub = '<uuid>'; ... COMMIT` (the PostgREST request-context pattern) — set the sub via `SELECT set_config('request.jwt.claim.sub', <uuid>, true)`.
- **The container superuser bypasses RLS** — a test that forgets `SET LOCAL ROLE app_user` proves nothing. Include a control: a query that would succeed as superuser but MUST fail as app_user.
- File suffix EXACTLY `*.integration.test.ts` (vitest project `integration`) or it's silently skipped.
- Tenant-isolation oracle: write as A, `SELECT` as B → 0 rows; superuser cross-owner join (`child.user_id <> parent.user_id`) counts 0.
