# Task: task-02-wardrobe-and-parse-jobs — wardrobe_items + parse_jobs tables with RLS

## 1. Intent

The system stores each user's garments (`wardrobe_items`) and photo-parse jobs (`parse_jobs`) such that a row is only ever visible or writable by the user who owns it, and the same uploaded photo can never spawn a second parse job for that user. A garment row can be referenced by later-wave tables only through a `(user_id, id)` pair, so a cross-tenant reference is structurally impossible to write. Listing a user's wardrobe by recency, by availability, and by category is index-backed rather than a sequential scan.

## 2. Context and constraints

**Spec reference:** docs/06 sec 3 (`wardrobe_items`, `parse_jobs`). Read that section for the authoritative column list, category/availability value domains, and status lifecycle; the columns below are the required floor, not a replacement for the spec.

**Codebase patterns (inlined from docs/PATTERNS.md; real path `../fitapp/packages/db` as backup, do NOT open it):**
- *Migration substrate (0001_substrate.sql)* — `pgcrypto`, `auth` schema + `auth.uid()`, `public.tg_set_updated_at()` trigger fn, and the `app_user` role already exist. This task NEVER touches the substrate. Every migration is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) so up→down→up redo hashes match, with a real reversible DOWN.
- *Domain table + RLS FORCE (NNNN_slug.sql, `-- UP Migration` / `-- DOWN Migration`)* — `ENABLE` + `FORCE ROW LEVEL SECURITY`; per-table `_select_own` / `_insert_own` / `_update_own` policies keyed on `auth.uid()=user_id`; `BEFORE UPDATE` trigger calling `public.tg_set_updated_at()`; `GRANT` the `app_user` role exactly the DML its policies allow.
- *Integration test* — `applyMigrations(client)` applies the full chain; the executor runs each query in `BEGIN; SET LOCAL ROLE app_user; SELECT set_config('request.jwt.claim.sub',<uuid>,true); …; COMMIT`. The container superuser BYPASSES RLS, so a test that forgets `SET LOCAL ROLE` proves nothing — include a control that must fail as `app_user`. Test file MUST end in the exact suffix `*.integration.test.ts` or vitest skips it.

**Code-style rules (CLAUDE.md, enforced):** `const` over `let`; early returns over nested conditionals; parse-don't-cast at every boundary; NO `supabase.from()` outside `packages/db`; read config via `envValue`, never `process.env`; use `git grep` (not plain grep); structured logger, no `console.*`. SQL SELECTs cast `timestamptz -> ::text` and `numeric -> ::float` (relevant to later repo waves; migrations here just define the columns).

**What NOT to touch:** `0001_substrate.sql` and anything it defines (`auth` schema, `auth.uid()`, `tg_set_updated_at`, `app_user` role, `pgcrypto`); any other migration; any repo, handler, or shim; any table from other waves (`outfits`, `outfit_items`, `wear_log`, `palette_profile`, `subscriptions`, `webhook_events`). Write ONLY the three files listed in Metadata.

**Reversibility class:** reversible. Each migration has a DOWN that drops exactly what its UP created (policies, trigger, indexes, constraints, table) and nothing from the substrate.

## 3. Technical requirements (numbered, dependency-ordered)

1. **`0002_wardrobe_items.sql`** creates `public.wardrobe_items` with at minimum:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id uuid NOT NULL`
   - `parse_job_id uuid` (nullable; the composite FK to `parse_jobs` is added in requirement 7, after that table exists)
   - `category text NOT NULL` (value domain per docs/06 sec 3)
   - `availability text NOT NULL DEFAULT 'available'` (value domain per docs/06 sec 3)
   - `image_path text NOT NULL`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `updated_at timestamptz NOT NULL DEFAULT now()`
2. **Composite anchor on `wardrobe_items`:** `UNIQUE (user_id, id)`. This is the target later-wave composite FKs reference; it is what makes cross-tenant garment references unrepresentable. It exists in addition to the `id` primary key.
3. **RLS on `wardrobe_items`:** `ENABLE` then `FORCE ROW LEVEL SECURITY`, and exactly three policies — `wardrobe_items_select_own` (`FOR SELECT USING (auth.uid()=user_id)`), `wardrobe_items_insert_own` (`FOR INSERT WITH CHECK (auth.uid()=user_id)`), `wardrobe_items_update_own` (`FOR UPDATE USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)`). No delete policy. Default-deny holds because FORCE is on and no permissive policy grants more.
4. **Trigger + grants on `wardrobe_items`:** `CREATE TRIGGER wardrobe_items_set_updated_at BEFORE UPDATE ON public.wardrobe_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();` and `GRANT SELECT, INSERT, UPDATE ON public.wardrobe_items TO app_user;` (no DELETE — matches the policy set).
5. **Indexes on `wardrobe_items`:**
   - keyset: `CREATE INDEX ... ON public.wardrobe_items (user_id, created_at DESC, id DESC);`
   - availability: `CREATE INDEX ... ON public.wardrobe_items (user_id, availability);`
   - category: `CREATE INDEX ... ON public.wardrobe_items (user_id, category);`
6. **`0003_parse_jobs.sql`** creates `public.parse_jobs` with at minimum: `id uuid PK DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL`, `source_photo_hash text NOT NULL`, `status text NOT NULL DEFAULT 'pending'` (lifecycle per docs/06 sec 3), `image_path text NOT NULL`, `error text`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`. It carries: `UNIQUE (user_id, id)` (composite anchor); `UNIQUE (user_id, source_photo_hash)` (**per-photo idempotency** — one photo per user yields at most one job; this constraint is NEVER placed on `wardrobe_items`, because one photo produces N garments); RLS FORCE with the same three `_select_own` / `_insert_own` / `_update_own` policies; the `parse_jobs_set_updated_at` trigger; keyset index `(user_id, created_at DESC, id DESC)`; and `GRANT SELECT, INSERT, UPDATE ON public.parse_jobs TO app_user;`.
7. **Cross-table composite FK (in `0003`, after `parse_jobs` and its `UNIQUE(user_id,id)` exist):** `ALTER TABLE public.wardrobe_items ADD CONSTRAINT wardrobe_items_parse_job_fk FOREIGN KEY (user_id, parse_job_id) REFERENCES public.parse_jobs (user_id, id) ON DELETE SET NULL;`. The FK is on the pair `(user_id, parse_job_id)`, so a garment can only ever link to a parse job with the **same** `user_id` — a cross-tenant link cannot be written. **Assumption (flag if docs/06 disagrees):** `ON DELETE SET NULL` so a pruned parse job leaves the garment intact rather than blocking or cascading; if docs/06 sec 3 specifies otherwise, follow the spec.
8. **DOWN migrations** are real and reverse-ordered: `0003` DOWN drops the FK, then the trigger/policies/indexes/constraints/table for `parse_jobs`; `0002` DOWN drops the trigger/policies/indexes/anchor/table for `wardrobe_items`. Neither DOWN touches the substrate. up→down→up must reproduce identical object definitions (use `IF EXISTS` on drops, `IF NOT EXISTS` / `CREATE OR REPLACE` where the substrate pattern does).

## 4. Acceptance criteria (Given-When-Then)

- **Happy — own rows visible:** Given migrations applied and JWT sub = user A, When A inserts a `wardrobe_items` row with `user_id = A` and then selects, Then A sees exactly that row.
- **Isolation — other tenant invisible:** Given A has inserted a garment, When user B (different JWT sub, role `app_user`) selects from `wardrobe_items`, Then B sees 0 rows.
- **WITH CHECK control (must fail as app_user):** Given JWT sub = user A and role `app_user`, When A attempts to insert a row with `user_id = B`, Then the insert is rejected by RLS (row-level security violation). This is the control proving the executor actually dropped to `app_user`; if it ever succeeds, the isolation tests are meaningless.
- **Per-photo idempotency (differential):** Given A has inserted a `parse_jobs` row for `source_photo_hash = H`, When A inserts a second row with the same `(user_id, source_photo_hash)`, Then the second insert conflicts on `UNIQUE(user_id, source_photo_hash)` — 0 new rows added (assert via `ON CONFLICT DO NOTHING` returning `rowCount = 0`, or a caught unique-violation), and the table still holds exactly 1 job for H.
- **Empty:** Given a fresh database with migrations applied and no inserts, When any user selects from either table as `app_user`, Then 0 rows and no error.
- **Concurrent duplicate:** Given two overlapping transactions inserting the same `(user_id, source_photo_hash)`, When both commit, Then exactly one succeeds and the other hits the unique violation — never two jobs for the same photo.
- **Cross-tenant FK unrepresentable:** Given a `parse_jobs` row owned by A, When any writer attempts to insert a `wardrobe_items` row with `user_id = B` and `parse_job_id =` A's job id, Then the composite FK `(user_id, parse_job_id) -> (user_id, id)` rejects it (no matching parent for `(B, jobId)`).
- **Reversibility:** Given the chain applied, When `0003` then `0002` DOWN run and then both UP re-run, Then it succeeds and object definitions are identical (idempotent redo).

## 5. Verification requirements (independent oracle)

**Tier (docs/05):** Tier-3 (RLS tenant isolation) + Tier-2 (constraint/idempotency), implemented in `packages/db/test/wardrobe.rls.integration.test.ts` against a real Postgres via testcontainers with the full migration chain applied through `applyMigrations(client)`.

**Mechanisms:**
- *Differential (idempotency):* Insert the same `(user_id, source_photo_hash)` twice for one user; assert the second insert adds 0 rows and the job count for that hash stays at 1. This is a state-delta the code cannot fake — it comes from the DB rejecting the duplicate, not from a return value the handler chose.
- *Isolation oracle (red-first control):* Two distinct JWT subs run through the executor with `SET LOCAL ROLE app_user`. Write as A, select as B → assert 0 rows. Include the **negative control** that MUST fail: as `app_user` with sub A, attempt `INSERT ... user_id = B` and assert it raises. If that control ever passes, the suite must be treated as broken (it means the connection was still superuser).
- *Superuser cross-owner join:* As the container superuser (RLS bypassed), run a join of `wardrobe_items` to `parse_jobs` on `wardrobe_items.parse_job_id = parse_jobs.id AND wardrobe_items.user_id <> parse_jobs.user_id`; assert the result count is 0 — no row pair ever crosses tenants, which the composite FK guarantees at write time.

**What green looks like:** all isolation assertions return the expected row counts (own = present, cross-tenant = 0), the negative-control insert raises as `app_user`, the duplicate-photo insert is rejected (0 new rows, count stays 1), the cross-owner join counts 0, and the up→down→up redo runs clean. Any of these self-passing without the control failing → not green.

## 6. Performance envelope (hot path)

Wardrobe listing is a per-request hot path. The keyset index `(user_id, created_at DESC, id DESC)` must serve the recency-ordered listing query without a sort or sequential scan: on a table seeded with a few thousand rows across multiple users, `EXPLAIN` of a keyset page query (`WHERE user_id = $1 AND (created_at, id) < ($cursor_ts, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT n`) must show an index scan on the keyset index, not `Seq Scan` + `Sort`. The availability and category composite indexes must likewise back their filter predicates. (Assertion optional in this task's test but the index shapes above are required so later-wave repos hit them.)

## Metadata

- **Parent spec:** docs/06 sec 3 (`wardrobe_items`, `parse_jobs`).
- **Step:** wave 1.
- **Demo (isolatable):** run `pnpm --filter @closet/db test wardrobe.rls.integration.test.ts` — spins its own Postgres container, applies migrations, and proves isolation + idempotency + reversibility with no other package.
- **Complexity:** Medium (two migrations with FORCE RLS, a composite anchor, a cross-table composite FK with ordering, and a multi-oracle integration test).
- **Files this task writes (one-writer-per-file — touch ONLY these):**
  - `packages/db/migrations/0002_wardrobe_items.sql`
  - `packages/db/migrations/0003_parse_jobs.sql`
  - `packages/db/test/wardrobe.rls.integration.test.ts`
- **Dependencies:** `0001_substrate.sql` (provides `auth.uid()`, `tg_set_updated_at()`, `app_user`, `pgcrypto`) and the `applyMigrations` / role-switching executor test harness. No dependency on any later wave.
