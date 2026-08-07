# Task: outfits, outfit_items, wear_log, palette_profile tables

## 1. Intent

The system can model saved outfits and their member garments, an append-only wear history, and a per-user palette result — with tenant boundaries enforced by the *shape* of the schema, not by handler code. A row that references another tenant's garment or outfit must be **unrepresentable** (composite `(user_id, id)` foreign keys have no matching parent), and `wear_log` must be structurally append-only (no UPDATE/DELETE path exists for `app_user`) so the wear-history moat cannot be silently rewritten or cascaded away.

## 2. Context and constraints

**Spec reference:** `docs/06-backend-design.md` §3 (`outfits`, `outfit_items`, `wear_log`, `palette_profile`) and §7 (migration & idempotency rules: `wear_log` FK `ON DELETE RESTRICT`, the merge-not-delete rule that depends on it, child indexes on `outfit_items(item_id)` / `wear_log(item_id)`).

**Codebase patterns:**
- `docs/PATTERNS.md` → *"Migration: domain table + RLS FORCE (`packages/db/migrations/0002_*.sql`)"* — the exact `CREATE TABLE` → `ENABLE`/`FORCE ROW LEVEL SECURITY` → per-op policies → `tg_set_updated_at` trigger → `GRANT` → reversible DOWN skeleton. Files numbered `NNNN_slug.sql` with `-- Up Migration` / `-- Down Migration` markers (node-pg-migrate SQL format). Backup exemplar: `../fitapp/packages/db/migrations/0002_*.sql`.
- `docs/PATTERNS.md` → *"Integration test: real Postgres, SET LOCAL ROLE app_user"* — `applyMigrations(client)` applies the full chain; the executor runs each query in `BEGIN; SET LOCAL ROLE app_user; SELECT set_config('request.jwt.claim.sub', <uuid>, true); ...; COMMIT`; **the container superuser bypasses RLS so a control that must fail as `app_user` is mandatory**; suffix EXACTLY `*.integration.test.ts`. Backup: `../fitapp/packages/db/test/*.integration.test.ts`.
- Depends on **task-01** (`0001_substrate.sql`: `public.tg_set_updated_at()`, `auth.uid()`, the `app_user` role; `packages/db/test/helpers/applyMigrations.ts` + `executor.ts`) and **task-02** (`0002_wardrobe_items.sql` supplying `UNIQUE(user_id, id)` on `wardrobe_items` — the parent anchor these composite FKs point at). Do not re-declare those.

**Explicit code-style rules (CLAUDE.md):**
- `const` over `let`; early returns over nesting (test helper code).
- **parse-don't-cast:** no `as` casts across boundaries; this task writes no repo, but any SELECT the test issues that crosses to a Zod schema would cast `timestamptz→::text` (not needed here — the test asserts counts/failures, not typed rows).
- **`supabase.from()` is banned outside `packages/db`** — N/A here (all DB access is the test executor).
- **`envValue()` not bare `process.env`**; **structured logger, never `console`**; **`git grep` not `grep`/`rg`**.
- Migrations are the ONLY way to change schema; **never edit a landed migration**; real UP + reversible DOWN.

**What NOT to touch:** `0001_substrate.sql`, `0002_wardrobe_items.sql`, `0003_parse_jobs.sql` (owned by tasks 01/02 — the DOWN of *these* new migrations NEVER drops the substrate, the `app_user` role, or the parent tables). Do not touch `subscriptions`/`webhook_events` (task-04), `conventions.json`, `scripts/`, or any gate config (human-owned cage). Do not add repos or handlers.

**Reversibility class:** reversible. Additive numbered migrations with real round-trip DOWN (drop policies, trigger, table; never the substrate or parents). No destructive DDL, no approval token required.

## 3. Technical requirements (dependency-ordered, testable)

1. **`packages/db/migrations/0004_outfits.sql`** — `public.outfits`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null`, `name text` (nullable), `created_at`/`updated_at timestamptz not null default now()`. `UNIQUE(user_id, id)` (composite-FK anchor). `ENABLE` + `FORCE ROW LEVEL SECURITY`. Policies `outfits_select_own`/`_insert_own`/`_update_own` (SELECT `USING (auth.uid()=user_id)`, INSERT `WITH CHECK`, UPDATE `USING ... WITH CHECK`). `BEFORE UPDATE` trigger `outfits_set_updated_at` → `public.tg_set_updated_at()`. `GRANT SELECT, INSERT, UPDATE ON public.outfits TO app_user`. Reversible DOWN.

2. **`packages/db/migrations/0005_outfit_items.sql`** — `public.outfit_items`: `id uuid pk`, `outfit_id uuid not null`, `user_id uuid not null` (denormalized so RLS is a column check, not a join), `item_id uuid not null`, `slot text`, `position int`, timestamps. Constraints:
   - `FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits(user_id, id) ON DELETE CASCADE`
   - `FOREIGN KEY (user_id, item_id) REFERENCES public.wardrobe_items(user_id, id) ON DELETE CASCADE`
   - `UNIQUE(outfit_id, item_id)`; index on `(item_id)` (FK-child index for the merge/delete path).
   RLS FORCE + SELECT/INSERT/UPDATE own policies + `updated_at` trigger + `GRANT SELECT, INSERT, UPDATE` to `app_user`. Reversible DOWN. (Must be numbered **after** wardrobe_items/outfits so both parent `(user_id,id)` uniques exist.)

3. **`packages/db/migrations/0006_wear_log.sql`** — `public.wear_log`: `id uuid pk`, `user_id uuid not null`, `item_id uuid not null`, `outfit_id uuid` (nullable), `worn_at timestamptz not null default now()`, `client_id text not null`, `created_at` (no `updated_at`/trigger — append-only, nothing mutates it). Constraints:
   - `FOREIGN KEY (user_id, item_id) REFERENCES public.wardrobe_items(user_id, id) ON DELETE RESTRICT` (the moat cannot be silently deleted/cascaded).
   - `FOREIGN KEY (user_id, outfit_id) REFERENCES public.outfits(user_id, id) ON DELETE SET NULL`.
   - partial `UNIQUE(user_id, client_id) WHERE client_id IS NOT NULL`. Indexes: `(user_id, worn_at desc)`, `(item_id)`.
   RLS FORCE with **INSERT + SELECT policies ONLY — no UPDATE and no DELETE policy** ⇒ structurally append-only. `GRANT SELECT, INSERT ON public.wear_log TO app_user` (NOT update/delete). Reversible DOWN.

4. **`packages/db/migrations/0007_palette_profile.sql`** — `public.palette_profile`: `user_id uuid PRIMARY KEY` (1:1, no separate `id`), `hues jsonb not null`, `created_at`/`updated_at`. RLS FORCE + SELECT/INSERT/UPDATE own policies (upsert on conflict `(user_id)`) + `updated_at` trigger + `GRANT SELECT, INSERT, UPDATE` to `app_user`. Reversible DOWN.

5. **`packages/db/test/outfits-wearlog.rls.integration.test.ts`** — the independent oracle (§5). Suffix EXACTLY `*.integration.test.ts`. Uses task-01's `applyMigrations` + executor helpers; every query runs `SET LOCAL ROLE app_user` with a set `request.jwt.claim.sub`.

## 4. Acceptance criteria (Given-When-Then)

**Happy path (own rows):**
- Given the full chain applied and tenant A authenticated, When A inserts a `wardrobe_items` row and an `outfits` row it owns, then inserts an `outfit_items` row naming *its own* `(user_id, outfit_id)` and `(user_id, item_id)`, Then the insert succeeds and a fresh SELECT as A returns exactly that row.
- Given A owns an item, When A inserts a `wear_log` row for it with a `client_id`, Then it succeeds; re-inserting the same `(user_id, client_id)` conflicts on the partial UNIQUE (second insert yields 0 new rows).
- Given A, When A upserts `palette_profile` `(user_id, hues)` twice (ON CONFLICT `(user_id)`), Then exactly one row exists with the latest `hues`.

**Cross-tenant unrepresentability (composite FK, edge):**
- Given tenant B owns `wardrobe_items` row `X`, When tenant A (valid token, own `user_id`) attempts `INSERT INTO outfit_items (user_id, outfit_id, item_id, ...)` with `user_id = A` and `item_id = X`, Then the statement **fails with a foreign-key violation** — because no `wardrobe_items(A, X)` parent exists — and a fresh SELECT as B shows nothing new. (The failure is a schema-level FK error, not a handler validation or an RLS silent-empty.)
- Same for a cross-tenant `outfit_id` naming B's outfit under A's `user_id`.

**Append-only (edge):**
- Given A owns a `wear_log` row, When A (as `app_user`) attempts `UPDATE public.wear_log SET worn_at = ...` or `DELETE FROM public.wear_log`, Then it is **denied / affects 0 rows** because no UPDATE/DELETE policy exists (and `app_user` was not granted UPDATE/DELETE) — the row is unchanged on a fresh SELECT.

**Isolation / empty / control:**
- Given A wrote rows, When B SELECTs the same tables under B's `sub`, Then 0 rows (RLS scopes to owner).
- **Mandatory control:** a query that succeeds as the container superuser but MUST fail (or return 0) as `app_user` — proving `SET LOCAL ROLE app_user` is actually in effect and the test isn't vacuously passing under RLS bypass.

## 5. Verification requirements — the independent oracle

**Tier (docs/05):** Tier-2 (adversarial cross-tenant penetration + structural-unwritability), realized on the Tier-3 real-Postgres substrate (`applyMigrations` + `SET LOCAL ROLE app_user`).

**Mechanism:** differential + mutation-target. The oracle is **actual database state observed from a vantage the inserting handler does not control** — *the response is never the oracle* (docs/05 Tier-2). Two independent denials plus a happy path must all hold:

1. **Composite-FK unrepresentability (differential):** as tenant A, attempt the cross-tenant `outfit_items` insert naming B's `item_id` (and separately B's `outfit_id`). Assert the DB **raises a foreign-key-violation error** — catch it and assert the SQLSTATE/error class, do not merely assert "no rows." Then take a fresh SELECT as B and a **container-superuser cross-owner join** (`child.user_id <> parent.user_id`) → **count 0**: proof no foreign row landed anywhere, not just that A can't see it. Green requires the FK to *reject the write*, distinguishing "unrepresentable" from "handler validated it."

2. **Append-only denial (mutation-target):** as A (as `app_user`), run UPDATE and DELETE against a `wear_log` row A owns. Assert each is refused (insufficient-privilege / policy denial or 0 rows affected) and the row is byte-identical on a fresh SELECT. The target mutant this kills: adding a `wear_log` UPDATE/DELETE policy or an over-broad `GRANT` would flip this test green→exploitable, so the test must assert the *absence* of the mutation path.

3. **Happy path as control-of-relevance:** the own-row `outfit_items` insert and `wear_log` append **succeed** — proving the denials above are specific to cross-tenant/append-only, not a blanket-broken schema.

4. **RLS-in-effect control (anti-mirror):** include one query that would succeed as the container superuser but must fail/return-0 as `app_user`. Without it, forgetting `SET LOCAL ROLE app_user` would make every "denial" pass vacuously (the exact fitapp trap).

**What green looks like:** the test file runs under the vitest `integration` project (exact `*.integration.test.ts` suffix), applies the full 0001→0007 chain, and all four checks pass — both cross-tenant denials proven by a raised FK error + superuser-join count 0, the append-only UPDATE/DELETE denials proven by unchanged persisted state, the own-row happy path green, and the RLS-in-effect control failing-as-`app_user`-as-required. If any denial passes only because a query returned an empty/200 response (rather than the DB rejecting the write), that is a mirror oracle and does not count.

## Metadata

- **Parent spec:** `docs/06-backend-design.md` §3, §7.
- **Step:** Wave 1 (schema substrate + core tables + RLS). Depends on task-01 (substrate + test helpers) and task-02 (`wardrobe_items` `UNIQUE(user_id,id)` anchor).
- **Demo (isolatable):** `pnpm --filter @closet/db test -- outfits-wearlog.rls.integration.test.ts` (or `pnpm verify:full`) against a throwaway Postgres testcontainer — no external services.
- **Complexity:** medium (4 migrations + one integration test; the subtlety is composite-FK ordering and the append-only grant/policy asymmetry).
- **Dependencies:** task-01-substrate-and-roles, task-02-wardrobe-and-parse-jobs. No cross-task file overlap (owns migrations 0004–0007 and one new test file exclusively).
