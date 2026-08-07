# Task: Wear-log append (F8) + palette upsert (B1) + entitlement read

## 1. Intent
Ship the three user-JWT Edge endpoints that close the daily loop's write side: **wear-log append** (F8 — the moat: one-tap "I wore this", `client_id`-idempotent under retry, optionally flipping the worn item to `dirty`), **palette upsert** (B1 — persist the swatch-quiz hue result 1:1), and the **entitlement read** the client uses to gate paid UI. The system property established: a retried wear-log write can never create a second row (append-only + partial UNIQUE arbiter resolves onto the caller's own row), a client can read but never mint its own entitlement, and every write is confined to the caller by RLS running as `app_user` — never `service_role`.

## 2. Context & constraints

**Spec reference:** docs/06 §2 (on-device vs remote split — wear-log, palette, entitlement read rows), docs/06 §4 (`wear-log` and `palette` Edge Functions — "Append per-item wear rows … `client_id`-idempotent (partial UNIQUE); optionally flips worn items to dirty. Append-only." / "UPSERT `palette_profile` from the swatch quiz (B1); also serves the entitlement read for UI gating."), docs/06 §3 (`wear_log`, `palette_profile`, `subscriptions` columns — **authoritative**), docs/06 §7 (`client_id` minted by the caller at tap time), docs/06 §8.1 (the entitlement read is on the money path — read-only, no write path to the money table). docs/01 F8 (daily wear log), B1 (palette scoring). Test tier: docs/05 **Tier-3** (real-Postgres, `SET LOCAL ROLE app_user`) as the primary oracle, with the **Tier-4 offline/jitter idempotency** law ("retried under simulated network loss produce exactly one row") applied to wear-log.

**Codebase patterns (READ these files before coding — do not guess from names):**
- `docs/PATTERNS.md` → the **Handler** block (`AuthedHandler`, identity from `ctx.userId` never body, `parseBoundary` at the boundary, `jsonResponse`/`errorResponse`, ~3-line Deno shim) and the **Integration test** block (`applyMigrations` full chain; drive the handler through a real executor as `app_user`; write as A, SELECT as B → 0 rows; the superuser control that MUST fail as `app_user`).
- `packages/db/test/outfits-wearlog.rls.integration.test.ts` — the exact harness this task's integration tests mirror: `startPg()` → `applyMigrations(pool)` → `makeTenantExecutor(pool, userId)` / `makeSuperuserExecutor(pool)`, per-user UUID constants, a never-writing `USER_C` control. **Read the executor semantics in `packages/db/test/helpers/executor.ts`: every `query()` runs in its own `BEGIN … SET LOCAL ROLE app_user … COMMIT`.** This is the single most load-bearing fact for this task (see req 2).
- `packages/shared/src/schemas/outfits.ts` (`LogWearRequest`, `WearLogRow`), `packages/shared/src/schemas/profile.ts` (`UpsertPaletteRequest`, `PaletteProfileRow`), `packages/shared/src/schemas/billing.ts` (`EntitlementResponse`, `SubscriptionRow`) — the frozen boundary contracts. `parseBoundary` from `@closet/shared`.
- The migrations that define the ground truth these endpoints run against: `packages/db/migrations/0006_wear_log.sql` (INSERT+SELECT policies only, partial `UNIQUE(user_id, client_id) WHERE client_id IS NOT NULL`, FK `ON DELETE RESTRICT`, no `updated_at`), `packages/db/migrations/0007_palette_profile.sql` (PK `user_id`, upsert on conflict `(user_id)`), `packages/db/migrations/0008_subscriptions.sql` (SELECT-only for `app_user`, no write policy).

**Code style rules (from CLAUDE.md — enforced):**
- **Identity from `ctx.userId`** (verified JWT `sub`), **NEVER from the request body.** The frozen `LogWearRequest`/`UpsertPaletteRequest` schemas carry no `user_id` for exactly this reason.
- **parse-don't-cast:** every request in and every response out goes through its Zod schema via `parseBoundary(Schema, x)`. No `as` casts across the boundary.
- **Repos are the ONLY DB seam.** Handlers hold **no SQL** and never call `supabase.from()` (lint-banned). They compose repo factories over the injected `exec`.
- **One tx per `query()` call.** Any atomic multi-row effect (the append+flip) lives inside **ONE statement or ONE plpgsql function** — never two repo calls (they would be two transactions).
- `const` over `let`; early returns over nested conditionals; small single-purpose functions; no bare `data`/`result` names.
- Structured logger only if logging at all (no `console`); never log raw error text (PII). `envValue()` for any env, never bare `process.env` (Edge is Deno). These endpoints read no env — N/A unless you add one, which you should not.
- Use `git grep` to locate existing symbols to reuse.

**What NOT to touch:**
- `packages/shared/**` is **frozen** (W2, committed). Do NOT add a field to `LogWearRequest`, `UpsertPaletteRequest`, or any schema. If the flip toggle needs a channel, it comes from the request **URL query string**, validated by a small **local** Zod schema declared inside the wear-log handler file (req 3) — never by editing the shared body schema.
- `packages/db/migrations/**` — no schema changes; these endpoints run against the landed chain as-is.
- `packages/db/src/repos/*` — **owned by task-09** (one-writer-per-file). This task **consumes** repo factories; it does not write them (see Dependencies + req 1).
- `packages/functions/src/auth/*` (`AuthedHandler`, `withAuth`, `serveAuthed`, `respond`) — owned by task-09a; consumed, not written here.
- The other Wave-3 handler domains (`wardrobe/`, `outfits/`), the parse pipeline, the money-**writer** (`revenuecat-webhook`). This task reads `subscriptions`; it never writes it.
- **One-writer-per-file — touch ONLY:** `packages/functions/src/wear-log/*.ts` (+ its `*.integration.test.ts`) and `packages/functions/src/palette/*.ts` (+ its `*.integration.test.ts`). Suggested files: `packages/functions/src/wear-log/log-wear.ts`, `packages/functions/src/wear-log/log-wear.integration.test.ts`, `packages/functions/src/palette/upsert-palette.ts`, `packages/functions/src/palette/read-entitlement.ts`, `packages/functions/src/palette/palette.integration.test.ts`. The Deno shims under `supabase/functions/<name>/index.ts` are ~3 lines each and MAY be added if the shim dir is in scope; if not present in the repo yet, note it and skip (the handler + integration test are the deliverable).

**Reversibility class:** reversible. Additive handler files + tests only; no schema, no migration, no data mutation outside a user's own tenant rows through their own RLS. Deleting the listed files fully reverts. (Note: the *runtime* wear-log append is append-only and the flip mutates the caller's own `wardrobe_items.availability` — both reversible at the code level and confined by RLS; the endpoints introduce no irreversible or cross-tenant capability.)

## 3. Technical requirements (numbered, dependency-ordered)

1. **Consume repo factories over the injected `exec` (no SQL in the handler).** The handlers compose three repo factories provided by task-09 (`@closet/db`), each taking the per-request `QueryExecutor`. The contracts this task depends on (state them precisely so task-09 delivers them — see Dependencies):
   - **Wear-log repo** — an idempotent append method, e.g. `appendWear(exec)({ userId, itemId, outfitId, clientId, flipToDirty })` → returns the **canonical** `wear_log` row (the newly-inserted row, or on retry the pre-existing row for that `(user_id, client_id)`). It MUST be **one statement**: `INSERT INTO public.wear_log (...) VALUES (...) ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING …`, combined via a **writable CTE** with a conditional `UPDATE public.wardrobe_items SET availability='dirty' WHERE user_id=$… AND id=$… AND <flip> = true` and a `UNION ALL` fallback `SELECT` of the existing row `WHERE NOT EXISTS (SELECT 1 FROM ins)`, so that exactly one row is returned whether inserted or pre-existing, the flip is atomic with the append, and everything is a single transaction. SELECT casts follow the pattern (`timestamptz→::text`).
   - **Palette repo** — `upsertPalette(exec)({ userId, hues })` → `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET hues = EXCLUDED.hues RETURNING user_id::text, hues`, returning the persisted `PaletteProfileRow`.
   - **Subscription repo** — `getEntitlement(exec)(userId)` → `SELECT entitlement_active, expires_at::text FROM public.subscriptions WHERE user_id=$1`, returning the row or `null` when absent.
   If task-09 has not yet defined these exact methods, that is the one cross-task dependency to resolve at build time — this handler MUST NOT inline the SQL to route around it (repos-only is a locked invariant).

2. **Wear-log append handler** (`log-wear.ts`, `AuthedHandler`, POST). `parseBoundary(LogWearRequest, body)` → `{ item_id, outfit_id?, client_id }`. `user_id` is `ctx.userId`, never the body. Call the wear-log repo's `appendWear`. On success, `jsonResponse(200, parseBoundary(WearLogRow, row))`. Because the executor wraps **each `query()` in its own transaction**, the append and the optional flip MUST be delivered as the **single repo statement** of req 1 — do not "insert then update" as two calls. **Scope:** the frozen `LogWearRequest` is single-item (with an optional `outfit_id` grouping key); the multi-row outfit-wear expansion (docs/06 §3 "N rows sharing `outfit_id`+`worn_at`") is the client calling this endpoint N times, each with its own tap-time `client_id` — this endpoint appends exactly one row per call. Do not invent a batch shape.

3. **Optional flip-to-dirty (decision — documented, opt-in via query string).** The flip is caller-controlled. Since `LogWearRequest` is `.strict()` and `packages/shared` is frozen, the toggle **cannot** ride in the JSON body. Read it from the request **URL query string** (e.g. `?flip=dirty`), parsed by a small **local** Zod schema in `log-wear.ts` (a `functions`-local schema, not a shared one), coerced to a boolean `flipToDirty`. **Default: OFF** (no `flip` param ⇒ append only, item availability untouched) — the conservative, least-surprising, most-reversible default; auto-dirtying every logged wear would surprise callers logging a past wear. When `flip=dirty` (or the agreed truthy value) is present, the append statement also sets the worn item's `availability='dirty'` atomically (req 1). *(Assumption flagged for confirmation: default-OFF opt-in. The alternative — default-ON with `?flip=false` to suppress — is defensible if product treats "I wore this" as implicitly soiled; pick default-OFF unless product says otherwise, and note it in the PR.)*

4. **Palette upsert handler** (`upsert-palette.ts`, `AuthedHandler`, PUT or POST). `parseBoundary(UpsertPaletteRequest, body)` → `{ hues }`. `user_id` is `ctx.userId`. Call the palette repo's `upsertPalette`. Return `jsonResponse(200, parseBoundary(PaletteProfileRow, row))`. 1:1 by PK `user_id` — a second upsert for the same user updates the single row in place (never a duplicate). `hues` is opaque `jsonb`; store and echo it verbatim — this endpoint does no palette scoring (that is the on-device pure fn `scorePalette`, task-08).

5. **Entitlement read handler** (`read-entitlement.ts`, `AuthedHandler`, GET). Call the subscription repo's `getEntitlement(ctx.userId)`. When a row exists → `jsonResponse(200, parseBoundary(EntitlementResponse, { entitlement_active, expires_at }))`. **When NO row exists** (a user who never subscribed) → return the **default** `parseBoundary(EntitlementResponse, { entitlement_active: false, expires_at: null })` (200), never a 404 and never a throw — an absent money row means "not entitled", which is exactly what the UI gate needs. This endpoint is **read-only** on the money table; there is no code path here that writes `subscriptions` (RLS grants `app_user` SELECT only — a write would be denied anyway, but the handler must not attempt one).

6. **Response validation + errors.** Every response body is `parseBoundary(<ResponseSchema>, …)` so the wire shape is Zod-checked at the boundary. On a boundary parse failure of the request, return `errorResponse` with a 4xx (the shared `respond` helper's shape) — do not 500 on bad input. Do not leak raw DB error text to the client or the log (PII rule); a structured log line with `correlationId` is the most that is logged, and only if logging at all.

## 4. Acceptance criteria (Given-When-Then)

1. **Wear-log happy path**
   - Given an authenticated user A with an owned `wardrobe_items` row, and a body `{ item_id, client_id: 'k1' }`
   - When A POSTs to wear-log
   - Then exactly one `wear_log` row exists for A with that `item_id`, `client_id='k1'`, `worn_at` set, and the response is the validated `WearLogRow`.

2. **Idempotent under retry (the moat law — Tier-3/Tier-4)**
   - Given A already logged `client_id='k1'` for an item
   - When A POSTs the identical `{ item_id, client_id: 'k1' }` again (a retry)
   - Then still **exactly one** `wear_log` row exists for `(A, 'k1')` (partial UNIQUE arbiter resolved onto A's own row, no error surfaced to the caller), and the response is that same canonical row.

3. **Flip-to-dirty is atomic and opt-in**
   - Given A owns an item currently `availability='clean'`
   - When A POSTs the wear with `?flip=dirty`
   - Then the item's `availability` is `'dirty'` AND the wear row exists — both effects present (proving one-statement atomicity). And: when A POSTs a wear **without** `flip`, the item's `availability` is **unchanged**.
   - And a retry with `?flip=dirty` and the same `client_id` still yields exactly one wear row and a `dirty` item (flip is idempotent).

4. **Wear-log append is tenant-confined**
   - Given A logs a wear
   - When B reads `wear_log` as `app_user`
   - Then B sees zero of A's rows (RLS SELECT scoped). And a never-writing control tenant C also sees zero, so B's zero is not "empty table".

5. **Wear-log cannot name another tenant's item**
   - Given B does not own item `X` (owned by A)
   - When B attempts to append a wear referencing `X`
   - Then the write fails (the composite FK `(user_id, item_id)` to `wardrobe_items` is unrepresentable across tenants under B's `user_id`) and no `wear_log` row lands for B.

6. **Palette upsert round-trips and stays 1:1**
   - Given A PUTs `{ hues: <h1> }`, then PUTs `{ hues: <h2> }`
   - When A's `palette_profile` is read back as owner under `app_user`
   - Then exactly one row exists for A with `hues == h2` (in-place update, PK `user_id`), and each response echoes the persisted `PaletteProfileRow`. A's and B's upserts produce two distinct rows; A sees only its own.

7. **Entitlement read reflects the money table, scoped and defaulted**
   - Given a `subscriptions` row for A with `entitlement_active=true` written by the **service_role/superuser** path (app_user cannot write it)
   - When A GETs the entitlement read → `entitlement_active=true` with `expires_at`; When B (no row) GETs it → `entitlement_active=false, expires_at=null` (the default, 200, not 404); When B reads A's entitlement it is invisible (RLS scoped — B gets its own default, never A's `true`).

8. **Malformed request rejected at the boundary**
   - Given a wear-log body missing `client_id` (or `item_id`), or a palette body with an extra key (strict schema)
   - When the handler runs
   - Then `parseBoundary` rejects at the boundary → a 4xx `errorResponse`, and no row lands. No partial reasoning over bad data.

## 5. Verification requirements — the independent oracle

**Tier:** docs/05 **Tier-3 — real-Postgres + RLS FORCE + `SET LOCAL ROLE app_user`**, extended with the **Tier-4 offline/jitter idempotency** law for wear-log. Files: `packages/functions/src/wear-log/log-wear.integration.test.ts` and `packages/functions/src/palette/palette.integration.test.ts` (EXACT `*.integration.test.ts` suffix — the vitest `integration` project silently skips anything else). This is the named independent oracle; it is **not** a self-graded mock.

**Why it escapes the author (the anti-mirror argument).** The grading signal is **real persisted state observed through a vantage the writing statement does not control** — a fresh independent `SELECT` executed under a *different* tenant's RLS-scoped executor, and differential **row counts** the handler never returns. The response body is never the oracle. Two structural disciplines make it real:
- **`SET LOCAL ROLE app_user` is mandatory** — the container superuser bypasses RLS, so a test that forgets the role proves nothing. Reuse `makeTenantExecutor` (drops to `app_user` + sets `request.jwt.claim.sub`) for the caller path and `makeSuperuserExecutor` ONLY for the money-row seed (req below) and the negative control.
- **A control that must FAIL as `app_user`** and a **never-writing tenant C** whose 0-row read distinguishes "RLS-scoped" from "empty table".

**Mechanism per law:**
- **Idempotency-under-retry (differential row count):** apply the full chain via `applyMigrations`; seed an owned item for A; drive the wear-log handler through A's `makeTenantExecutor` **twice** with the same `client_id`; then `SELECT count(*) FROM wear_log WHERE user_id=A AND client_id='k1'` as A → **exactly 1**. This is the moat's core law and the Tier-4 "retried → exactly one row" oracle. **Red-first:** note in the test header that this law fails against a stub `appendWear` that omits the `ON CONFLICT` arbiter (a plain INSERT would land 2 rows / raise) — demonstrate that red before the real repo turns it green.
- **Flip atomicity (differential):** after a `flip=dirty` append, an independent `SELECT availability FROM wardrobe_items WHERE user_id=A AND id=item` as A returns `'dirty'` AND the wear row count is 1 — both in the same assertion block, proving the single-statement effect. A no-flip append leaves `availability='clean'`.
- **Tenant isolation + composite-FK unrepresentability:** write as A, `SELECT … as B` → 0 rows; C control → 0 rows; B's attempt to append a wear naming A's `item_id` **throws / lands 0 rows** (FK, not just validation). A superuser cross-owner count (`wear_log.user_id <> wardrobe_items.user_id` join) is 0.
- **Palette round-trip (create→read):** upsert `h1` then `h2` through A's executor; independent `SELECT` as A → single row, `hues == h2`; count of A's `palette_profile` rows is 1 (1:1 preserved). B's upsert is invisible to A.
- **Entitlement scoping + default:** seed `subscriptions(user_id=A, entitlement_active=true)` via `makeSuperuserExecutor` (app_user has no write path — this itself confirms the sole-writer boundary); entitlement read as A → `true`; as B (no row) → the `false`/`null` default; B never observes A's `true`.

**Green =** every law above holds against the real migration chain as `app_user`, with the idempotency law shown red-first against a no-`ON CONFLICT` stub, no `.skip`/`.only`, and no law weakened to a single crafted input. A test that asserts only on the handler's own return value (not a fresh independent SELECT / row count) does **not** satisfy this section.

## 6. Failure & degradation
- **Missing `subscriptions` row (entitlement read):** the expected steady state for any un-subscribed user — return the `{ entitlement_active:false, expires_at:null }` default with 200, never 404/500. The UI gate treats absent-as-not-entitled.
- **Duplicate `client_id` (wear-log retry):** not an error to the caller — the `ON CONFLICT DO NOTHING` + fallback SELECT returns the canonical row with 200. The client, offline/jittery, may retry freely; the partial UNIQUE guarantees one row.
- **Foreign/absent `item_id` in a wear-log append:** the composite FK to `wardrobe_items(user_id, id)` rejects it (own missing item OR another tenant's item — both unrepresentable under the caller's `user_id`); the handler surfaces a 4xx/DB-constraint error via `errorResponse`, logs nothing sensitive, and lands no row.
- **Bad request body:** `parseBoundary` throws at the boundary → 4xx `errorResponse`; no DB call is attempted.
- **DB error:** never leak raw error text (PII rule); return the shared error shape and, at most, a structured log line keyed on `correlationId`.

## 7. Performance envelope
- **`wear_log` is the moat — the ~180M-row hot table (docs/06 §3, §7).** The append is a **single-row INSERT** guarded by the partial `UNIQUE(user_id, client_id)` index; the optional flip is a single-row keyed `UPDATE` on `wardrobe_items(user_id, id)` (PK/anchor lookup). Both are O(1) index operations — no scan. The whole append+flip is one round trip / one transaction.
- **No read fan-out here** — these are point writes (wear append, palette upsert) and a single point read (entitlement by PK `user_id`). No pagination needed; the caller mints `client_id`, so no server-side sequence.
- **Bound:** one statement per request, no N+1, no unindexed predicate. The FK-child index `wear_log(item_id)` (from migration 0006) keeps the `ON DELETE RESTRICT` check off a seq-scan for the downstream dedupe-merge path (not exercised here, but the write must not regress it).

## Metadata
- **Parent spec:** docs/06 §2, §4, §3, §8.1; docs/01 F8, B1. Patterns: `docs/PATTERNS.md` (Handler + Integration-test blocks).
- **Step:** Wave 3 (task-12 of the backend wave plan), after task-09 (repos) + task-09a (auth infra).
- **Demo (isolatable):** `pnpm --filter @closet/functions test log-wear palette` — the two `*.integration.test.ts` suites spin a real Postgres via testcontainers, apply the full migration chain, and prove idempotent-under-retry (exactly one row), atomic flip, palette round-trip, and scoped entitlement read as `app_user`, with no external service.
- **Complexity:** Medium — the handlers are thin; the load-bearing care is (a) the append+flip being one statement under the one-tx-per-query executor, (b) the flip-toggle channel (query string, not the frozen body), and (c) the entitlement default-when-absent.
- **Dependencies:**
  - **task-09 (repos)** — `appendWear`, `upsertPalette`, `getEntitlement` factory methods over `QueryExecutor` (req 1). **This is the one hard cross-task dependency**: the F8 append+flip is a specialized writable-CTE method; confirm task-09 exposes it (or coordinate its addition there) rather than inlining SQL in this handler.
  - **task-09a (auth infra)** — `AuthedHandler`, `withAuth`, `serveAuthed`, `jsonResponse`/`errorResponse` from `packages/functions/src/auth/*`.
  - **W1** — the landed migration chain (`applyMigrations`, `makeTenantExecutor`, `makeSuperuserExecutor`, `startPg` in `packages/db/test/helpers`). **W2** — the frozen `@closet/shared` schemas (`LogWearRequest`, `WearLogRow`, `UpsertPaletteRequest`, `PaletteProfileRow`, `EntitlementResponse`, `parseBoundary`).
  - Runtime: `pg`-backed executor (test) / `withAuth`'s `pgExecutor` (prod). No new npm dependency.
