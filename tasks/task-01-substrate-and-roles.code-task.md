# Task: task-01-substrate-and-roles — Migration substrate + app_user role + test helpers

## 1. Intent

The database must have a self-consistent, reproducible substrate that every later migration and integration test builds on: cryptographic ID generation, a dual-target auth namespace (real Supabase `auth` schema when present, a faithful local stand-in when not), a canonical `auth.uid()` tenant identity, a shared `updated_at` trigger function, and a least-privilege `app_user` role. The substrate applies cleanly on a bare Postgres container and round-trips up→down→up with an identical schema fingerprint. The test harness exposes the two seams every RLS test needs: apply the full migration chain, and run statements inside a tenant-scoped transaction as `app_user`.

## 2. Context and constraints

- **Spec reference:** docs/06 sec 3 (schema substrate, dual-target auth bootstrap, `auth.uid()`, `tg_set_updated_at`, roles) and docs/06 sec 7 (test harness: `applyMigrations`, tenant-context executor, RLS proof obligations).
- **Codebase patterns:** Follow the PATTERNS.md **substrate block** verbatim — pgcrypto; auth bootstrap gated on `NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth')` → `CREATE SCHEMA auth` + `auth.users(id uuid pk)` + `auth.uid()` defined as `NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid`; `public.tg_set_updated_at()`; `app_user` role created idempotently; DOWN guarded on `nspowner = current_user`; everything idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) so an up→down→up redo produces matching hashes. Also follow the **integration-test block** for the two helpers (BEGIN → `SET LOCAL ROLE app_user` → `set_config('request.jwt.claim.sub', <uuid>, true)` → statement → COMMIT; superuser bypasses RLS, so a control query must fail as `app_user`). Backup reference (do NOT open): `../fitapp/packages/db/migrations/0001_substrate.sql`.
- **Code-style rules (CLAUDE.md, enforced):** `const` over `let`/`var` unless reassignment is real; early returns over nested conditionals; parse-don't-cast at every boundary (no bare type assertions on external input); `supabase.from()` is lint-banned outside `packages/db` (helpers here talk to `pg` directly, not via a repo); read env via the project's `envValue` accessor, never `process.env` directly; use `git grep` (not plain grep) for repo search; log via the structured logger, never `console.log`. Small single-purpose functions; names that say what they hold.
- **What NOT to touch:** No domain tables, no RLS policies, no repos, no handlers — those are later waves. Do not add npm dependencies beyond what `pg` / node-pg-migrate / vitest / testcontainers already provide. Do not create `packages/db/test/helpers/index.ts` or barrels. Touch ONLY the three files listed under Metadata.
- **Reversibility class:** reversible. The DOWN migration must restore a bare container to its pre-migration state, but MUST NOT drop the `auth` schema when it was pre-existing (real Supabase) — the `nspowner = current_user` guard distinguishes the local stand-in (owned by us) from Supabase's.

## 3. Technical requirements (numbered, dependency-ordered)

1. **`packages/db/migrations/0001_substrate.sql`** with `-- UP Migration` and `-- DOWN Migration` sections.
2. UP: `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (provides `gen_random_uuid()`).
3. UP: dual-target auth bootstrap — gate on `NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')`; inside the gate `CREATE SCHEMA auth` and `CREATE TABLE auth.users (id uuid PRIMARY KEY)`. When `auth` already exists (real Supabase), skip both. Wrap in a `DO $$ ... $$` block since `CREATE SCHEMA` has no `IF NOT EXISTS` guard for the owned/unowned distinction needed at DOWN.
4. UP: `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;` — created unconditionally (idempotent via `OR REPLACE`), so it exists in both targets.
5. UP: `CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;`.
6. UP: create the `app_user` role idempotently — `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END $$;`. Grant `USAGE` on schema `public` (and on `auth` for `auth.uid()` resolution) to `app_user`. Do NOT grant table DML here — later migrations grant exactly what their policies allow.
7. DOWN: reverse in dependent order — drop `public.tg_set_updated_at()`, drop `auth.uid()`; drop `auth.users` and `auth` schema ONLY when `nspowner = current_user` (i.e. the local stand-in we created), never when Supabase owns it; revoke grants and `DROP ROLE IF EXISTS app_user` (guarded so it does not fail if objects still depend — in wave 1 nothing does). Do not drop the `pgcrypto` extension (shared, may pre-exist). DOWN must be safe to run against a container where UP created the stand-in.
8. Idempotency guarantee: UP must be safe to re-run and, critically, an up→down→up sequence must yield a byte-identical schema fingerprint to the first up — use `IF NOT EXISTS` / `CREATE OR REPLACE` / `DO`-guarded creation throughout.
9. **`packages/db/test/helpers/applyMigrations.ts`** — export `async function applyMigrations(client)` that reads the migration files from `packages/db/migrations` in lexical order, splits each into UP section, and executes the UP SQL against the passed `pg` client/pool. It must apply the full chain (0001 + any later files present), not just 0001. Resolve the migrations directory relative to the module (import.meta.url), not cwd.
10. **`packages/db/test/helpers/executor.ts`** — export a factory `makeTenantExecutor(pool, userId)` returning an object with `query<Row>(sql, params?): Promise<{ rows: Row[] }>` that, per call, checks out a connection and runs: `BEGIN` → `SET LOCAL ROLE app_user` → `SELECT set_config('request.jwt.claim.sub', $1, true)` with `userId` → the caller's statement → `COMMIT` (rolling back and releasing on error). Signature MUST match the `QueryExecutor` interface from the repo-factory pattern so repos in later waves can be driven by it unchanged.
11. The executor must expose a way to run a **control/superuser** query (no role switch) so tests can prove that forgetting `SET LOCAL ROLE` bypasses RLS — either a second exported helper `makeSuperuserExecutor(pool)` or a documented raw-pool escape hatch. Keep it minimal and single-purpose.

## 4. Acceptance criteria (Given-When-Then)

- **Happy (apply):** Given a bare Postgres testcontainer with no `auth` schema, When `applyMigrations(client)` runs, Then it completes without error, `pgcrypto` is installed, `auth.uid()` and `public.tg_set_updated_at()` exist, `auth.users` exists, and role `app_user` exists with `USAGE` on `public`.
- **Dual-target (auth pre-exists):** Given a container where schema `auth` already exists and is NOT owned by the migration role, When UP runs, Then it does NOT recreate/alter `auth`/`auth.users`, `auth.uid()` is (re)defined via `CREATE OR REPLACE`, and DOWN does NOT drop the pre-existing `auth` schema.
- **Redo / round-trip:** Given a freshly-migrated container, When the schema fingerprint is captured, then DOWN then UP are applied, Then the fingerprint after the second UP equals the first (byte-identical).
- **Tenant identity:** Given the tenant executor scoped to `userId = U`, When a statement runs `SELECT auth.uid()`, Then it returns `U`.
- **Empty JWT edge:** Given `request.jwt.claim.sub` set to `''` (empty), When `SELECT auth.uid()` runs, Then it returns `NULL` (via `NULLIF`), not a cast error.
- **Isolation control (must-fail):** Given the superuser executor, When it queries a table under RLS, Then it returns rows regardless of owner (proving the container superuser bypasses RLS) — establishing that any later test omitting `SET LOCAL ROLE app_user` proves nothing. The tenant executor under the same conditions must be role-constrained.
- **Concurrent:** Given two tenant executors for distinct `userId`s issuing interleaved queries against the same pool, When both run, Then each sees its own `auth.uid()` (per-connection `SET LOCAL` inside its own transaction, no leakage).

## 5. Verification requirements — the independent oracle

- **Tier (docs/05):** Tier-3 (migration reversibility / schema drift) + Tier-4 (RLS harness enablement). This is NOT a self-graded unit test — the oracle is the live Postgres container's own catalog and its round-trip fingerprint.
- **Mechanism — round-trip + red-first:**
  1. **Round-trip (redo) fingerprint:** On a bare testcontainer, apply UP, capture a schema fingerprint (e.g. deterministic dump of `pg_namespace`, `pg_class`, `pg_proc`, `pg_policy`, `pg_roles`, `information_schema.role_table_grants` — ordered, hashed). Apply DOWN, then UP again, re-capture, and assert the two fingerprints are identical. This is the differential oracle: the migration author does not grade themselves; the database's catalog does.
  2. **Red-first gate:** Author the check so that no RLS-policy test in later waves can execute without `auth.uid()` — assert `auth.uid()` resolves before any policy exists. Concretely, a probe that `SET LOCAL ROLE app_user; SELECT set_config(...); SELECT auth.uid()` returns the configured uuid, and returns NULL for empty sub. If `auth.uid()` is missing or misdefined, this fails loud (red) rather than silently passing.
  3. **Superuser-bypass control:** The oracle explicitly demonstrates that the container superuser bypasses RLS (control that MUST return rows), so the harness's value comes only from the `SET LOCAL ROLE app_user` path.
- **Green looks like:** `applyMigrations` succeeds on a bare container; the up→down→up fingerprint matches exactly; `auth.uid()` returns the scoped uuid under the tenant executor and NULL on empty sub; the superuser control returns rows while the tenant path is role-constrained. Any drift between the two UP fingerprints, or a missing/mis-scoped `auth.uid()`, is a hard failure.

## 6. Failure / degradation

- **`auth` schema ownership ambiguity:** If `nspowner` cannot be resolved to `current_user` at DOWN, the migration MUST default to NOT dropping `auth` (assume Supabase-owned / production) — this is the safe, reversible default consistent with production-safety rules.
- **Missing `pgcrypto`:** `CREATE EXTENSION IF NOT EXISTS pgcrypto` requires superuser on the container (satisfied by testcontainers). In a managed Supabase target the extension pre-exists; the `IF NOT EXISTS` guard degrades to a no-op rather than erroring.
- **Executor connection failure:** On any error between BEGIN and COMMIT the executor MUST `ROLLBACK` and release the connection back to the pool; it must never leak a connection with a lingering `SET LOCAL ROLE`.

## 7. Performance envelope

Not a hot path (test harness + one-time migration). The only constraint: the tenant executor checks out and returns exactly one pooled connection per `query` call with no busy-wait; no per-call schema introspection.

---

**Metadata**
- **Parent spec:** docs/06 (sec 3 substrate; sec 7 harness)
- **Step:** wave 1 (foundation — no dependencies; every later wave depends on this)
- **Demo (isolatable):** `pnpm --filter @closet/db test -- executor` / the substrate round-trip test run against a fresh testcontainer, standalone.
- **Complexity:** Medium (SQL idempotency + dual-target guards are the subtle part; helpers are small).
- **Dependencies:** none (root of the dependency graph). Consumed by all domain-table migrations and every `*.integration.test.ts`.
