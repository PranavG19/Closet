# Task: task-09b-repos — Repo factories for all 8 tables over QueryExecutor

## 1. Intent

Every table in the schema gets one repo factory — `makeWardrobeRepo`, `makeParseJobsRepo`, `makeOutfitsRepo`, `makeOutfitItemsRepo`, `makeWearLogRepo`, `makePaletteRepo`, `makeSubscriptionsRepo`, `makeWebhookEventsRepo` — each a pure function of an injected `QueryExecutor` that returns a small object of async methods. The repo layer is the **only** place raw SQL touches the database: a handler never writes SQL and never calls `supabase.from()`, it calls a repo method with `ctx.userId` and lets the executor's transaction (`SET LOCAL ROLE app_user` + the request `sub`) confine every row via RLS. A repo therefore never opens a connection, never sets a role, never sets the JWT claim, never holds `service_role`, and never bypasses RLS — it emits parameterized SQL and hands back typed rows. Tenant scoping is enforced by the database (RLS + the executor's role/claim), not by the repo; the repo's job is correct SQL, correct casts, and correct idempotency semantics. Because the executor exposes only `{ rows }` (no `rowCount`), every "did this insert actually happen" decision (idempotent inserts, the atomic parse-job claim, the monotonic entitlement guard) is made from a `RETURNING` row count, never from a driver rowcount. `timestamptz` is cast `::text` and the `bigint` phash `::text` in every projection so the shape a repo returns matches the `*Row` Zod schemas from `@closet/shared` and survives JSON. All repos and the `QueryExecutor` type are re-exported through the `@closet/db` barrel so `parse-photo`, `wardrobe`, `outfits`, `wear-log`, `palette`, and `revenuecat-webhook` (built in later W3 tasks) import them by name.

## 2. Context and constraints

**Spec reference:** docs/06 §3 (the authoritative column list, constraints, and RLS intent for all 8 tables), §4 (which endpoint drives which repo, and the two money-path methods — the atomic parse-job claim and the webhook's `ON CONFLICT` dedup + monotonic guard), §7 (parse idempotency/resumability rules). docs/05 Tier-3 (RLS tenant isolation against real Postgres) is the oracle tier. The `*Row` / request Zod schemas already exist in `packages/shared/src/schemas/*` (W2) and are the exact shape each repo method must return — read `wardrobe.ts`, `outfits.ts`, `profile.ts`, `billing.ts` and `common.ts` there before writing a projection; a repo's `SELECT`/`RETURNING` column list must be column-for-column what the matching `*Row` schema parses (same names, nullability, and the `::text` casts the schema comments call out).

**Codebase patterns (inlined from docs/PATTERNS.md "Repo: factory over an injected QueryExecutor"; real path `../fitapp/packages/db` as backup — do NOT open it):**
- A repo is `export function makeXRepo(exec: QueryExecutor): XRepo { return { async fn(){ const { rows } = await exec.query<Row>('SELECT …::text, …::float FROM public.<t> WHERE user_id=$1', [userId]); return rows[0] ?? null; } }; }`.
- `QueryExecutor` interface: `query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>`. **This is the whole seam** — there is no `rowCount`, no transaction control, no `client` handle exposed to the repo. The caller injects an executor that already carries tenant context (the W1 test helper `makeTenantExecutor(pool, userId)` runs each query in `BEGIN; SET LOCAL ROLE app_user; SELECT set_config('request.jwt.claim.sub', <uuid>, true); …; COMMIT`; the W3 task-09a prod executor is the same shape over the verified JWT `sub`). The repo is identical under either.
- Rules (locked invariants): a repo **NEVER** opens a connection, sets a role, sets the JWT claim, holds `service_role`, or bypasses RLS. Cast `timestamptz → ::text` and `numeric → ::float` in every projection; the `bigint` phash is cast `::text` (64-bit exceeds JS safe-integer range — it is NOT a float). `int` columns (`outfit_items.position`) are small and safe — no cast. Repos are the ONLY DB seam; `supabase.from()` is lint-banned outside `packages/db`.

**Code-style rules (CLAUDE.md, enforced):** `const` over `let`; small single-purpose methods; early returns; parse-don't-cast at boundaries (the repo returns typed rows; the *handler* runs `parseBoundary` on the response — the repo does NOT run Zod itself, it annotates `exec.query<Row>`); identity always from the caller-supplied `userId` argument (which a handler sources from `ctx.userId`, the verified JWT `sub`), NEVER from a request body; no `console.*`; `git grep` not plain grep. Parameterize every value (`$1,$2,…`) — never string-interpolate into SQL.

**QueryExecutor location decision (flag if a later task disagrees):** the `QueryExecutor` interface is DEFINED in `packages/db/src/repos/index.ts` (the repos barrel) and exported from it; each `*.repo.ts` imports it type-only via `import type { QueryExecutor } from './index.js'` (a type-only self-import in the barrel graph is safe — it erases at compile time). The W3 prod executor in `packages/functions` (task-09a) implements this interface by importing it from `@closet/db`. If task-09a instead defines its own `QueryExecutor`, reconcile to a single exported definition — there must be exactly one.

**What NOT to touch:** any migration (`0001`–`0009`) — the tables, RLS policies, grants, indexes, constraints, and triggers already exist and are correct; this task only reads them. Any handler, Edge shim, or the W3 auth infra (`withAuth`, `respond`, `serveAuthed`). Any `packages/shared` schema (consume them, don't edit). The W1 test helpers (`applyMigrations`, `makeTenantExecutor`, `makeSuperuserExecutor`, `startPg`) — reuse them unchanged. The existing `*.rls.integration.test.ts` files (they prove the migrations; this task's `*.repo.integration.test.ts` files prove the repos). Write ONLY the files listed in Metadata.

**Reversibility class:** reversible. This task adds new source + test files and extends the currently-empty `packages/db/src/index.ts` barrel; it alters no schema, no data, and no existing behavior.

## 3. Technical requirements (numbered, dependency-ordered)

1. **`QueryExecutor` type + repos barrel (`packages/db/src/repos/index.ts`).** Declare and export `export interface QueryExecutor { query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>; }`. Re-export all eight `makeXRepo` factories and their return-type interfaces (`export * from './wardrobe.repo.js';` etc.). No SQL lives here.

2. **Top-level barrel (`packages/db/src/index.ts`).** Replace the scaffold `export {};` with `export * from './repos/index.js';` so `@closet/db` exposes every repo factory and the `QueryExecutor` type. (This file currently contains only the empty-barrel scaffold from W1; extending it is this task's job — it is the "packages/db barrel" the intent names.)

3. **Return typing.** Each method annotates `exec.query<TRow>(…)` with the matching `@closet/shared` `*Row` type imported from `@closet/shared`, and returns `rows[0] ?? null` for single-row reads / the array for list reads / the inserted-or-null row for idempotent writes. Repos do NOT call Zod; the type parameter is the contract, the handler validates at its boundary. Every projection lists columns explicitly with the casts below — never `SELECT *` (column order/casing must match the `*Row` schema).

4. **`makeWardrobeRepo` (`wardrobe.repo.ts`) → `WardrobeItemRow`.** Projection for every read/RETURNING: `id, user_id, category, color, pattern, attributes, availability, cutout_path, parse_job_id, phash::text AS phash, created_at::text AS created_at, updated_at::text AS updated_at`. Methods:
   - `create(userId, input: CreateWardrobeItemRequest)` → `INSERT INTO public.wardrobe_items (user_id, category, color, pattern, attributes, cutout_path, parse_job_id) VALUES ($1,…) RETURNING <projection>`; returns the row. `user_id` is `$1` from the argument, never from `input`.
   - `listByUser(userId, opts?: { limit?; cursor?: { createdAt; id } })` → keyset page: `… WHERE user_id=$1 [AND (created_at, id) < ($2, $3)] ORDER BY created_at DESC, id DESC LIMIT $n`. Clamp `limit` to `≤ 100` (server-clamp, docs/06 §4). Returns `WardrobeItemRow[]`.
   - `setAvailability(userId, itemId, availability)` → `UPDATE public.wardrobe_items SET availability=$3 WHERE user_id=$1 AND id=$2 RETURNING <projection>`; returns row or null. (The `WHERE user_id=$1` is belt-and-suspenders over RLS, not the security control.)
   - `getById(userId, id)` → single-row read, returns row or null.

5. **`makeParseJobsRepo` (`parse-jobs.repo.ts`) → `ParseJobRow`.** Projection: `id, user_id, source_photo_hash, source_photo_path, kind, status, claimed_at::text AS claimed_at, error_reason, created_at::text AS created_at, updated_at::text AS updated_at`. Methods:
   - `create(userId, input: CreateParseJobRequest)` → per-photo idempotent insert: `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, source_photo_hash) DO NOTHING RETURNING <projection>`. Return `rows[0] ?? null` — **null means the photo was already submitted** (0 rows returned = conflict swallowed). Do not read a rowcount; the `RETURNING` row is the signal.
   - `claim(userId, id)` → the atomic claim (docs/06 §4): `UPDATE public.parse_jobs SET status='processing', claimed_at=now() WHERE id=$2 AND user_id=$1 AND status IN ('pending','failed') AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes') RETURNING <projection>`. Return `rows[0] ?? null`; **null means the claim was lost** (another worker holds a live lease or the job is done) and the caller must not proceed. Correctness rides entirely on `RETURNING` returning exactly one row or none.
   - `getById(userId, id)` and `listByUser(userId)` reads for the resumability/progress UI.

6. **`makeOutfitsRepo` (`outfits.repo.ts`) → `OutfitRow`.** Projection: `id, user_id, name, created_at::text AS created_at, updated_at::text AS updated_at`. Methods: `create(userId, name: string | null)` (INSERT … RETURNING), `getById(userId, id)`, `listByUser(userId)`.

7. **`makeOutfitItemsRepo` (`outfit-items.repo.ts`) → `OutfitItemRow`.** Projection: `id, outfit_id, user_id, item_id, slot, position` (no `created_at`/`updated_at` in `OutfitItemRow`; `position` is `int`, no cast). Methods:
   - `add(userId, outfitId, input: OutfitItemInput)` → `INSERT INTO public.outfit_items (user_id, outfit_id, item_id, slot, position) VALUES ($1,$2,$3,$4,$5) RETURNING <projection>`. The composite FKs `(user_id, outfit_id)→outfits` and `(user_id, item_id)→wardrobe_items` make a cross-tenant reference unrepresentable at write time — a mismatched `item_id` raises a FK violation, not a silent scope leak.
   - `listByOutfit(userId, outfitId)` → `… WHERE user_id=$1 AND outfit_id=$2`.

8. **`makeWearLogRepo` (`wear-log.repo.ts`) → `WearLogRow`.** Projection: `id, user_id, item_id, outfit_id, worn_at::text AS worn_at, client_id`. Append-only (no update/delete). Methods:
   - `append(userId, input: LogWearRequest)` → `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, client_id) DO NOTHING RETURNING <projection>`. `client_id` is minted by the caller at tap time (never inside the repo); the partial `UNIQUE(user_id, client_id)` dedups retries. Return `rows[0] ?? null` — null = duplicate tap already logged.
   - `listByUser(userId, opts?: { limit? })` → `… ORDER BY worn_at DESC LIMIT $n` (clamp ≤ 100), backed by the `(user_id, worn_at DESC)` index.

9. **`makePaletteRepo` (`palette.repo.ts`) → `PaletteProfileRow`.** Projection: `user_id, hues`. Methods:
   - `upsert(userId, hues)` → `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET hues=excluded.hues, updated_at=now() RETURNING user_id, hues`. 1:1 on `user_id`; returns the row.
   - `getByUser(userId)` → single-row read, row or null.

10. **`makeSubscriptionsRepo` (`subscriptions.repo.ts`) → `SubscriptionRow`.** Projection: `user_id, rc_app_user_id, entitlement_active, event_ts::text AS event_ts, expires_at::text AS expires_at, updated_at::text AS updated_at`. Methods:
    - `getByUser(userId)` → single-row read (row or null). This is the ONLY method reachable under `app_user` — the SELECT policy + SELECT grant allow it; it serves the entitlement UI read (docs/06 §4 palette endpoint) and the full-parse gate.
    - `applyEvent(input: { userId; rcAppUserId; entitlementActive; eventTs; expiresAt })` → the money-table write, driven ONLY by `revenuecat-webhook` under `service_role`: `INSERT INTO public.subscriptions (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at, updated_at) VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (user_id) DO UPDATE SET rc_app_user_id=excluded.rc_app_user_id, entitlement_active=excluded.entitlement_active, event_ts=excluded.event_ts, expires_at=excluded.expires_at, updated_at=now() WHERE public.subscriptions.event_ts IS NULL OR excluded.event_ts >= public.subscriptions.event_ts RETURNING <projection>`. The `WHERE` on the `DO UPDATE` is the **monotonic ordering guard** (docs/06 §4): a late-arriving older event returns 0 rows (null) and does NOT revoke a newer entitlement. Return `rows[0] ?? null`; null = the event was stale and skipped. The repo does not set a role — it is the *injected executor* (service_role in prod) that makes this write land; under an `app_user` executor the same SQL is refused (no INSERT/UPDATE grant), which is the structural guarantee that a client cannot mint entitlement.

11. **`makeWebhookEventsRepo` (`webhook-events.repo.ts`) → `WebhookEventRow`.** Not tenant data; reachable only under `service_role`. Projection: `event_id, received_at::text AS received_at`. Method:
    - `record(eventId)` → atomic replay dedup: `INSERT INTO public.webhook_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING <projection>`. Return `rows[0] ?? null` — **null means this event_id was already seen** (a replay); the webhook returns 200 and stops before any entitlement write. This is the atomic alternative to a read-then-write column check (docs/06 §3 `webhook_events`); the dedup decision is the presence/absence of the `RETURNING` row, never a rowcount.

## 4. Acceptance criteria (Given-When-Then)

- **Round-trip under app_user (every read/write repo):** Given migrations applied and an `app_user` executor with `sub = A`, When A calls `create`/`upsert`/`append`/`add` then the matching read, Then the row round-trips and each returned field matches its `*Row` schema — timestamps are ISO-8601 strings (not `Date`), `phash` is a decimal string (not a number), `position` is a number.
- **Cross-tenant read returns 0 rows (every tenant repo):** Given A has written a row, When B's `app_user` executor calls `listByUser`/`getById`/`listByOutfit`, Then it returns `[]` / `null` — B sees none of A's rows.
- **Cross-tenant write is refused, not silently rescoped:** Given B's executor (`sub = B`), When B calls `wardrobeRepo.create` and the executor's `WITH CHECK` would require `user_id = B`, attempting to create against A's data is impossible because `userId` comes from the executor's own `sub`; and an `outfitItemsRepo.add` referencing an `item_id` owned by A raises a composite-FK violation rather than linking cross-tenant.
- **Parse-job per-photo idempotency (differential):** Given A created a job for `source_photo_hash = H`, When A calls `create` again with the same hash, Then the second call returns `null` and `parse_jobs` still holds exactly 1 row for `H` (state delta = 0, read as superuser).
- **Atomic claim is single-winner:** Given a `pending` job, When `claim` is called twice, Then the first returns the row with `status='processing'` and the second returns `null` (live lease held); a job whose `claimed_at` is older than 2 minutes is re-claimable and returns a row.
- **Wear-log retry dedup (differential):** Given A appended a wear with `client_id = C`, When A appends again with the same `client_id`, Then the second returns `null` and the row count for `C` stays 1.
- **Palette upsert is 1:1:** Given A upserted `hues`, When A upserts different `hues`, Then `getByUser` returns the new value and there is still exactly one row for A.
- **Subscriptions is SELECT-only for app_user (control — MUST fail):** Given an `app_user` executor, When it calls `applyEvent`, Then the query raises (no INSERT/UPDATE grant); When it calls `getByUser`, Then it succeeds and is RLS-scoped to the caller. If `applyEvent` ever succeeds as `app_user`, the money-table guarantee is broken and the suite is invalid.
- **Subscriptions monotonic guard (differential):** Given (service_role) an event at `event_ts = T2` set `entitlement_active = true`, When `applyEvent` is called with an older `event_ts = T1 < T2` and `entitlement_active = false`, Then it returns `null` and `getByUser` still reports `entitlement_active = true` — the stale event did not revoke.
- **Webhook_events replay dedup + app_user lockout:** Given (service_role) `record('e1')` returned a row, When `record('e1')` is called again, Then it returns `null`; And When an `app_user` executor calls `record` or reads the table, Then it raises (no grant) — the control proving the table is service-role-only.

## 5. Verification requirements (independent oracle)

**Tier (docs/05):** Tier-3 — every repo integration-tested as `app_user` against a real Postgres (testcontainers) with the FULL migration chain applied via `applyMigrations(pool)` (reuse the W1 helpers unchanged: `startPg`, `applyMigrations`, `makeTenantExecutor`, `makeSuperuserExecutor`). One `*.repo.integration.test.ts` per repo (exact suffix — vitest's `integration` project silently skips anything else). The oracle is database state observed from a vantage the writing statement does not control — a second tenant's executor, or a superuser count — never a value the repo chose to return.

**Mechanisms (each repo test MUST carry these):**
- *Isolation oracle (write A, read B → 0):* drive the repo with two distinct `makeTenantExecutor` subs. Write with A's executor; read with B's executor; assert `[]` / `null`. This is the core Tier-3 assertion and it must hold for every tenant repo.
- *Red-first negative control (MUST fail as app_user):* include at least one query that succeeds as superuser but MUST raise as `app_user`, proving the executor actually dropped privilege — otherwise every isolation assertion is meaningless (the container superuser bypasses RLS). Natural controls: `subscriptionsRepo.applyEvent` and `webhookEventsRepo.record`/read under an `app_user` executor MUST throw (no grant); a cross-tenant `outfitItemsRepo.add` MUST raise a FK violation. If a designated control ever passes, the suite is broken.
- *Differential row-counts (state delta the repo cannot fake):* for the idempotent writes — parse-job per-photo `create`, wear-log `append`, palette `upsert`, subscriptions monotonic `applyEvent`, webhook `record` — call twice and assert (a) the second call returns `null` and (b) a superuser `SELECT count(*)` shows the delta the constraint dictates (0 new rows for a dup; 1 row total for a 1:1 upsert; entitlement unchanged after a stale event). The count is read via `makeSuperuserExecutor` so it is independent of RLS and of the repo's own return value.
- *Schema-shape assertion:* parse at least one returned row through its `@closet/shared` `*Row` schema (`WardrobeItemRow.parse(row)` etc.) and assert it does not throw — this proves the `::text`/`phash::text` casts produce exactly the shape the handler boundary expects (catches a missing cast that would otherwise only surface at a handler in a later wave).
- *Claim single-winner + lease:* for `parse-jobs`, assert the second `claim` returns `null`, and (by pre-setting `claimed_at` to `now() - interval '3 minutes'` via a superuser write) assert a stale claim is re-acquirable.

**What green looks like:** for every repo, own rows round-trip under `app_user`; every cross-tenant read is `[]`/`null`; every designated negative control raises; every idempotent write shows the exact superuser-observed row-count delta and returns `null` on the duplicate; the schema-shape parse passes. Any assertion that passes while its paired negative control also passes → treat the suite as broken (privilege was not dropped).

## 6. Provider surface

Not applicable — repos touch only Postgres via the injected `QueryExecutor`; no external provider, port, or secret is involved. (Providers live behind ports called only from `parse-photo`, a later W3 task.)

## 7. Performance envelope (hot path)

`makeWardrobeRepo.listByUser` and `makeWearLogRepo.listByUser` are per-request hot paths (wardrobe browse; wear history). Their SQL must be shaped to ride the indexes W1 already built, not to force a sort or seq scan:
- Wardrobe keyset page: `WHERE user_id=$1 AND (created_at, id) < ($cursorTs, $cursorId) ORDER BY created_at DESC, id DESC LIMIT $n` must use the `(user_id, created_at DESC, id DESC)` index (no `Seq Scan` + `Sort`). Page size server-clamped to `≤ 100`.
- Wear-log recent: `WHERE user_id=$1 ORDER BY worn_at DESC LIMIT $n` must use the `(user_id, worn_at DESC)` index.
- Availability/category filters, when added to `listByUser`, must key off `(user_id, availability)` / `(user_id, category)`.
An `EXPLAIN` assertion on the wardrobe keyset query against a few-thousand-row multi-user seed is encouraged (assert the index scan, forbid `Seq Scan`), but the binding requirement is the query *shape* above — the repo must not emit an `OFFSET`-paginated or unordered-then-sorted query that defeats the keyset index. No new index is created by this task (that would be a migration, out of scope); the shapes must match the existing indexes.

## Metadata

- **Parent spec:** docs/06 §3 (all 8 table columns/constraints/RLS intent), §4 (endpoint→repo mapping; atomic claim; webhook dedup + monotonic guard), §7 (parse/wear idempotency). docs/PATTERNS.md "Repo: factory over an injected QueryExecutor". docs/05 Tier-3.
- **Step:** wave 3 (repos). Depends on W1 (migrations + `applyMigrations`/executor helpers) and W2 (`@closet/shared` `*Row`/request schemas). Consumed by the W3 handler tasks and task-09a (which implements the prod `QueryExecutor`).
- **Demo (isolatable):** `pnpm --filter @closet/db test` — spins its own Postgres container, applies the full chain, and proves round-trip + isolation + idempotency + the service-role-only controls for all 8 repos with no other package.
- **Complexity:** Medium-High (8 factories, several idempotent/atomic writes whose correctness rides on `RETURNING` row counts rather than driver rowcounts, and a per-repo Tier-3 oracle with red-first controls).
- **Files this task writes (one-writer-per-file — touch ONLY these):**
  - `packages/db/src/repos/wardrobe.repo.ts`
  - `packages/db/src/repos/parse-jobs.repo.ts`
  - `packages/db/src/repos/outfits.repo.ts`
  - `packages/db/src/repos/outfit-items.repo.ts`
  - `packages/db/src/repos/wear-log.repo.ts`
  - `packages/db/src/repos/palette.repo.ts`
  - `packages/db/src/repos/subscriptions.repo.ts`
  - `packages/db/src/repos/webhook-events.repo.ts`
  - `packages/db/src/repos/index.ts` (repos barrel + `QueryExecutor` interface)
  - `packages/db/src/index.ts` (top-level `@closet/db` barrel — currently `export {};`, replace with `export * from './repos/index.js';`)
  - `packages/db/test/wardrobe.repo.integration.test.ts`
  - `packages/db/test/parse-jobs.repo.integration.test.ts`
  - `packages/db/test/outfits.repo.integration.test.ts`
  - `packages/db/test/outfit-items.repo.integration.test.ts`
  - `packages/db/test/wear-log.repo.integration.test.ts`
  - `packages/db/test/palette.repo.integration.test.ts`
  - `packages/db/test/subscriptions.repo.integration.test.ts`
  - `packages/db/test/webhook-events.repo.integration.test.ts`
- **Dependencies:** `packages/db/migrations/0001`–`0009` (schema, RLS, grants, indexes), `packages/db/test/helpers/*` (harness), `@closet/shared` schemas (`WardrobeItemRow`, `ParseJobRow`, `OutfitRow`, `OutfitItemRow`, `WearLogRow`, `PaletteProfileRow`, `SubscriptionRow`, `WebhookEventRow` and the request schemas). No dependency on any handler; task-09a's prod executor imports `QueryExecutor` from this task's barrel.
- **Assumptions to flag if a sibling task disagrees:** (1) `QueryExecutor` is defined once, in the repos barrel, and exported through `@closet/db`; task-09a implements it rather than redefining it. (2) `makeSubscriptionsRepo.applyEvent` and `makeWebhookEventsRepo.record` are written to be driven under a `service_role` executor by `revenuecat-webhook`; they contain no role logic themselves. (3) Server page-size clamp is `≤ 100` per docs/06 §4; if a handler task sets a different ceiling, the repo's default clamp should match it.
