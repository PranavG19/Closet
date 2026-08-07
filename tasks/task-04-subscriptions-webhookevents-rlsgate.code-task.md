# Task: subscriptions + webhook_events tables + check-rls gate

**slug:** `task-04-subscriptions-webhookevents-rlsgate`
**wave:** 1

## 1. Intent

The system holds each user's paid entitlement in a money table that a tenant can *read* but can never *grant to themselves*: entitlement flips are the exclusive province of the billing webhook writing as `service_role`. A separate `webhook_events` table gives that webhook an idempotent dedup ledger. A structural gate proves — independent of any handler test — that every tenant-scoped table in the schema carries `ROW LEVEL SECURITY` in `FORCE` mode, so a self-grant or a cross-tenant read is unrepresentable rather than merely un-exercised.

## 2. Context and constraints

**Spec reference:** docs/06 sec 3 (`subscriptions`, `webhook_events` table definitions), docs/06 sec 4 (webhook ingestion + dedup semantics). Tests taxonomy: docs/05 (Tier-2 integration / RLS penetration).

**Codebase patterns** (from docs/PATTERNS.md, inlined — backup path `../fitapp` but do NOT open it):
- *Migration substrate* block: `0001_substrate.sql` already provides `pgcrypto`, `auth.uid()`, `public.tg_set_updated_at()`, and the `app_user` role. These migrations MUST NOT recreate or alter any substrate object; they depend on it.
- *Domain table + RLS FORCE* block: `NNNN_slug.sql` with `-- UP Migration` / `-- DOWN Migration` markers; `ENABLE` then `FORCE ROW LEVEL SECURITY`; per-table policies named `<t>_<verb>_own`; `BEFORE UPDATE` trigger calling `public.tg_set_updated_at()`; `GRANT` to `app_user` exactly the DML its policies allow; a real reversible DOWN that drops policies + trigger + table and NEVER touches the substrate. Note the block's explicit special cases: **`subscriptions` = SELECT-only for `app_user` (no write policy → self-grant unrepresentable); `webhook_events` = `service_role` only.**
- *Integration test* block: `*.integration.test.ts` EXACT suffix (vitest skips otherwise); `applyMigrations(client)` applies the full chain; each query runs in `BEGIN; SET LOCAL ROLE app_user; SELECT set_config('request.jwt.claim.sub', <uuid>, true); …; COMMIT`. Container superuser BYPASSES RLS → a test that forgets `SET LOCAL ROLE app_user` proves nothing; every negative assertion MUST include a control that must fail as `app_user`.

**Code-style rules (CLAUDE.md, mandatory):** `const` over `let`/`var`; early returns over nesting; parse-don't-cast at every boundary (`parseBoundary(Schema, x)`); NO `supabase.from()` outside `packages/db` (lint-banned); read config via `envValue(...)` not `process.env`; use `git grep` not `grep`; structured logger, no bare `console`. SQL SELECTs cast `timestamptz → ::text` and `numeric → ::float`.

**What NOT to touch:**
- `conventions.json` and `scripts/verify.mjs` — **orchestrator-owned (human paths). Do not create or edit them.** This task delivers the standalone gate script; wiring it into `verify.mjs` is out of scope.
- `0001_substrate.sql` and any earlier migration (0002–0007). Do not renumber, edit, or re-hash them.
- Any handler / repo / mobile code. No `packages/functions` or `packages/shared` changes.
- No new npm dependencies.

**Reversibility class:** reversible. Both migrations have real DOWN sections; the gate script and test are additive files.

## 3. Technical requirements (numbered, dependency-ordered)

1. **`packages/db/migrations/0008_subscriptions.sql`** — create `public.subscriptions` per docs/06 sec 3. Columns MUST include the standard envelope (`id uuid pk default gen_random_uuid()`, `user_id uuid not null`, `created_at`, `updated_at` per the domain block) plus at minimum the entitlement columns the spec names: `entitlement_active boolean not null default false`, `provider text not null`, `provider_subscription_id text`, and a status/period as spec dictates. Add a `UNIQUE (user_id)` constraint (one subscription row per tenant) so the webhook can upsert on it.
2. `ENABLE` + `FORCE ROW LEVEL SECURITY` on `subscriptions`.
3. Policy `subscriptions_select_own FOR SELECT USING (auth.uid() = user_id)` — and **NO insert/update/delete policy**. This is the money-table invariant: `app_user` gets `GRANT SELECT` only; it MUST NOT receive `INSERT`/`UPDATE`/`DELETE`. `service_role` (RLS-exempt) is the sole writer.
4. `BEFORE UPDATE` trigger `subscriptions_set_updated_at` → `public.tg_set_updated_at()`.
5. DOWN section for 0008: drop the policy, trigger, and table; never the substrate.
6. **`packages/db/migrations/0009_webhook_events.sql`** — create `public.webhook_events` per docs/06 sec 3/4. Columns: standard `id`/`created_at` envelope plus the dedup identity the spec names — a provider event id with a **UNIQUE constraint** that makes redelivery a no-op (`ON CONFLICT DO NOTHING` target), the provider name, and the raw payload/type as spec dictates. This table is NOT tenant-scoped by `auth.uid()`.
7. `ENABLE` + `FORCE ROW LEVEL SECURITY` on `webhook_events`, with **service_role-only** access: no `app_user` policy and no `app_user` GRANT. `app_user` can neither read nor write it.
8. DOWN section for 0009: drop policy/table; never the substrate.
9. **`scripts/gates/check-rls.mjs`** — a standalone Node ESM script that connects to the migrated schema (connection string from `envValue`-style env, e.g. `DATABASE_URL`), enumerates every tenant table, and asserts RLS is enabled AND forced. Concretely: query `pg_class.relrowsecurity` (RLS enabled) and `pg_class.relforcerowsecurity` (FORCE) for every `relnamespace = 'public'` base table that is tenant-scoped. It MUST fail (non-zero exit) if any such table has `relforcerowsecurity = false`. The set of tenant tables MUST be discovered from the schema, not hard-coded to a stale list — the gate's whole point is catching a table someone forgot to force. Print each table + its `relrowsecurity`/`relforcerowsecurity`, then exit 0 (all forced) or 1 (any gap) with the offending table names.
10. **`packages/db/test/subscriptions.rls.integration.test.ts`** — exact `.integration.test.ts` suffix; the penetration + gate oracle of section 5.

## 4. Acceptance criteria (Given-When-Then)

- **Happy / read own:** Given a `subscriptions` row for user A written as `service_role`, When A `SELECT`s under `SET LOCAL ROLE app_user` + jwt sub = A, Then A sees exactly its own row (entitlement value as written by the webhook).
- **Self-grant refused (INSERT):** Given `SET LOCAL ROLE app_user` + jwt sub = A, When A attempts `INSERT INTO public.subscriptions (user_id, entitlement_active, …) VALUES (A, true, …)`, Then the statement is refused (insufficient privilege / no policy) and no row appears.
- **Self-grant refused (UPDATE):** Given an existing A row with `entitlement_active = false` written as `service_role`, When A under `app_user` runs `UPDATE public.subscriptions SET entitlement_active = true WHERE user_id = A`, Then it is refused and the value stays `false`.
- **Cross-tenant read empty:** Given A's row, When B (`app_user`, jwt sub = B) `SELECT`s from `subscriptions`, Then 0 rows.
- **webhook_events opaque to tenants:** Given a `webhook_events` row inserted as `service_role`, When `app_user` attempts `SELECT` or `INSERT`, Then both refused / 0 rows.
- **Dedup:** Given a `webhook_events` row with provider event id `evt_1`, When the same `evt_1` is inserted again (`ON CONFLICT DO NOTHING`), Then row count for `evt_1` stays 1 (redelivery is a no-op).
- **Control (must-fail proves RLS is live):** The suite includes an assertion that would ONLY pass if RLS were bypassed (e.g. cross-tenant read returning a row); it MUST be observed to return empty under `app_user`, and a superuser cross-owner count MUST also be checked to confirm the data exists and isolation — not absence of data — is what's being measured.
- **Empty/concurrent:** Given an empty `subscriptions` table, When A selects, Then 0 rows (no error). Given two concurrent webhook upserts on the same `user_id`, Then the `UNIQUE (user_id)` constraint serializes them to one row (no duplicate entitlement rows).

## 5. Verification requirements — the independent oracle

**Tier (docs/05):** Tier-2 integration (testcontainers Postgres + full migration chain) **plus** the structural gate as a second, schema-level oracle.

**Mechanism:** *mutation-target / fire-drill* for the gate, and *differential penetration* for the money table — neither is a self-graded unit assertion the handler author also wrote.

1. **Penetration oracle (`subscriptions.rls.integration.test.ts`):** apply the full chain via `applyMigrations(client)`. Every negative case runs inside `BEGIN; SET LOCAL ROLE app_user; SELECT set_config('request.jwt.claim.sub', <A-uuid>, true); …`. Green = the `INSERT` and the `UPDATE entitlement_active` both raise / affect 0 rows as `app_user`, while the same writes succeed as `service_role`; and A-write / B-read yields 0 rows. Include the **must-fail control**: assert the superuser (RLS-bypassing) count of A's row is 1 so the 0-row tenant read proves isolation, not an empty table.

2. **Gate oracle (`scripts/gates/check-rls.mjs`), run against the real migrated schema:**
   - **Green path:** against the schema produced by migrations 0001–0009, the gate discovers every tenant table (including the 8: wardrobe_items, parse_jobs, outfits, outfit_items, wear_log, palette_profile, subscriptions, webhook_events) and exits 0 because each has `relforcerowsecurity = true`.
   - **Red path (fire-drill, MUST be demonstrated):** run, on a throwaway migrated DB, `ALTER TABLE public.subscriptions NO FORCE ROW LEVEL SECURITY;` then invoke the gate — it MUST exit non-zero and name `subscriptions`. This is the mutation target proving the gate has teeth. The fire-drill is executed against a disposable container and rolled back / discarded; it does NOT modify committed migrations.

**What green looks like:** penetration denied (self-grant of `entitlement_active` unrepresentable as `app_user`; cross-tenant read empty with the superuser control confirming the row exists) **and** the gate green on the honest schema, red on the FORCE-stripped fire-drill.

## Metadata

- **Parent spec:** docs/06 sec 3 (subscriptions, webhook_events), sec 4 (webhook).
- **Step:** wave 1.
- **Demo (isolatable):** `pnpm --filter @closet/db vitest run subscriptions.rls` (penetration, green) + `node scripts/gates/check-rls.mjs` against a migrated DB (green) and against a FORCE-stripped throwaway DB (red).
- **Complexity:** Medium — two migrations (one no-write-policy special case, one service_role-only), one schema-introspection gate, one penetration test with a must-fail control.
- **Dependencies:** `0001_substrate.sql` (auth.uid, tg_set_updated_at, app_user role); the `applyMigrations`/executor test harness from the integration-test pattern. Orchestrator owns `conventions.json` + `scripts/verify.mjs` wiring (NOT this task).
