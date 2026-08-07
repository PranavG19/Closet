# Task: Wardrobe endpoint — list/filter + availability toggle + dedupe keep-one MERGE

## 1. Intent

The `wardrobe` Edge Function is the read/write surface for a user's own garments (docs/06 §4 F4/F7). Three operations, all under the caller's user-JWT running as `app_user` (never `service_role`), all scoped by RLS to the verified `sub`:

1. **List / filter (F4)** — return the caller's items, optionally filtered by `category` / `color` / `availability`, **keyset-paginated** on the `(user_id, created_at, id)` index and **server-clamped to `limit ≤ 100`**. The clamp is a server guarantee, not a client courtesy: a caller asking for 100 000 rows gets 100.
2. **Availability toggle (F7)** — a single-column `UPDATE` moving one owned item between `clean` / `dirty` / `unavailable`. RLS `WITH CHECK` confines it to the caller's row.
3. **Dedupe keep-one resolution (F4) as a MERGE, not a delete** — re-point every `wear_log.item_id` and `outfit_items.item_id` reference from the discarded item to the kept item, **then** delete the now-unreferenced discarded item, as a **single atomic statement**. `wear_log`'s FK is `ON DELETE RESTRICT` (task-03), so a bare delete of a worn item is *refused by the database*; the merge re-points first so the wear-history moat is preserved, never cascaded away. **Keep-both is a no-op** (zero DB writes). The moat must survive intact — differential row counts prove no wear row is lost.

The load-bearing correctness here is the merge: the wear-log is the retention moat, and the append-only / `ON DELETE RESTRICT` guarantees from task-03 must stay honest through a dedupe resolution.

## 2. Context and constraints

**Spec reference:** `docs/06-backend-design.md` §4 (`wardrobe` Edge Function: "Keyset-paginated, server-clamped page size"; F7 toggle; "Keep-one **merges** (re-points wear/outfit refs, then deletes the now-unreferenced item) — never a bare destructive delete of worn history"), §3 (`wardrobe_items` columns + the `(user_id, created_at, id)` keyset index, `(user_id, availability)` partial index, `(user_id, category)` index; the `availability` CHECK in `clean`/`dirty`/`unavailable`), and **§7** (the decided-now rule: *"Dedupe keep-one is a MERGE, not a hard delete … re-point `wear_log.item_id` and `outfit_items.item_id` from the discarded item to the kept item, then delete the now-unreferenced item in one plpgsql fn. `wear_log`'s FK is `ON DELETE RESTRICT` … Keep-both is always a no-op. Both `wear_log(item_id)` and `outfit_items(item_id)` are indexed."*).

**Codebase patterns:**
- `docs/PATTERNS.md` → *"Handler: AuthedHandler, identity from ctx"* — `export const <name>: AuthedHandler = async (req, { userId, exec, correlationId }) => {…}`. `user_id` is **ALWAYS `ctx.userId`** (the verified JWT `sub`), **NEVER** read from the body. Inputs pass `parseBoundary(<Schema>, x)` at the boundary; the response is `jsonResponse(200, parseBoundary(<ResultSchema>, result))`; failures go through `errorResponse`. `AuthedHandler`, `withAuth`, `serveAuthed`, `jsonResponse`, `errorResponse` live in `packages/functions/src/auth/` (built by task-09a). The Deno shim is out of scope for this task (task-09a owns `serveAuthed`; per-endpoint shims are wired at deploy time, not here).
- `docs/PATTERNS.md` → *"Repo: factory over an injected `QueryExecutor`"* — **repos are the ONLY DB seam**; `supabase.from()` and raw SQL are lint-banned outside `packages/db`. The handler issues **no SQL itself**; it calls repo methods on `makeWardrobeRepo(exec)` from `@closet/db`. The injected `exec` carries tenant context (`SET LOCAL ROLE app_user` + `request.jwt.claim.sub`); one tx per `query()` call. Repo SELECTs cast `timestamptz→::text`; `phash` (`bigint`) comes back as text (not `::float`, exceeds JS safe-integer range) — matching `WardrobeItemRow` from task-05.
- `docs/PATTERNS.md` → *"Integration test: real Postgres, `SET LOCAL ROLE app_user`"* — the §5 oracle reuses task-01's `packages/db/test/helpers` (`applyMigrations`, `makeTenantExecutor`, `startPg`), applies the FULL migration chain, and drives the built handler through a real executor as `app_user`. Suffix EXACTLY `*.integration.test.ts` or vitest's `integration` project silently skips it. **The container superuser bypasses RLS**, so a control that must fail as `app_user` is mandatory.

**Reused schemas (task-05, `@closet/shared` — FROZEN, one-writer):** `WardrobeItemRow`, `Availability`, `WardrobeCategory`, `UpdateAvailabilityRequest` (`{ item_id, availability }`, `.strict()`), and `parseBoundary` / `parseBoundarySafe`. **Decision (stated explicitly):** the **list-query request** (filters + `cursor` + `limit`), the **dedupe-resolve request** (`{ keep_id, discard_id }`), and the **paginated list response** (`{ items, next_cursor }`) are **not** present in `@closet/shared` (W2 shipped only `WardrobeListResponse = { items }`). Because `packages/shared` is committed and one-writer-owned by W2, this task defines those three request/response schemas **locally** in `packages/functions/src/wardrobe/schemas.ts` (in scope), built on the reused primitives above (`WardrobeItemRow`, `Availability`, `WardrobeCategory`, `Uuid`). Do **not** edit `packages/shared`.

**Explicit code-style rules (CLAUDE.md):**
- `const` over `let`; early returns over nested conditionals; small single-purpose handlers.
- **parse-don't-cast:** every boundary crossing goes through `parseBoundary`/`parseBoundarySafe`; **no `as` casts** across boundaries. Decode the cursor with a schema, not a bare cast.
- **identity from `ctx.userId`, never the body** — the request body carries NO `user_id`; the repo receives the `sub` only via the injected `exec`'s tenant context. A `user_id` field in any request schema is a bug.
- **`supabase.from()` / raw SQL banned outside `packages/db`** — the handler calls repo methods; it never opens a connection, sets a role, or holds `service_role`.
- **`envValue()` not bare `process.env`**; **structured logger keyed by `correlationId`, never `console`**; **`git grep` not `grep`/`rg`**.

**Dependency contract on task-09 (repos, same wave — must land first).** The handler consumes `makeWardrobeRepo(exec)` from `@closet/db`. This task requires task-09 to expose exactly these methods (the merge SQL lives behind the repo seam because repos are the sole DB seam and one-writer-per-file forbids this task writing `packages/db`):
- `listItems({ category?, color?, availability?, cursor?, limit }): Promise<WardrobeItemRow[]>` — keyset SELECT (below), `limit` already clamped by the handler.
- `setAvailability(itemId, availability): Promise<WardrobeItemRow | null>` — single-column `UPDATE … RETURNING`; `null` when 0 rows (not owned / not found).
- `mergeKeepOne({ keepId, discardId }): Promise<{ merged: boolean }>` — the **single atomic data-modifying CTE** merge (§3.3 below).

If task-09 has not yet exposed these, this task's oracle is red-first against the missing method — that is the intended red state, not a reason to inline SQL in the handler.

**What NOT to touch:** `packages/shared/**` (W2, frozen), `packages/db/**` (task-01/02/03 migrations + task-09 repos — this task only *consumes* `@closet/db`), `packages/functions/src/auth/**` (task-09a), any migration, `conventions.json`, `scripts/`, gate config (human-owned cage). Touch ONLY `packages/functions/src/wardrobe/*.ts` and the matching `*.integration.test.ts`.

**Reversibility class:** reversible. New handler code + one integration test; no schema change, no destructive DDL, no money path, no approval token. The *runtime* merge deletes a user-chosen duplicate item — but only after re-pointing its references, it is user-gated (explicit keep-one), and it is confined to the caller's own rows by RLS; it changes no schema and requires no human gate.

## 3. Technical requirements (dependency-ordered, testable)

1. **`packages/functions/src/wardrobe/schemas.ts`** — local boundary schemas (see §2 decision), all built on `@closet/shared` primitives:
   - `ListWardrobeRequest` = `.strict()` `{ category?: WardrobeCategory, color?: string, availability?: Availability, cursor?: string (opaque), limit?: number.int().positive() }`. `limit` is *advisory* — the handler clamps it regardless.
   - `WardrobeCursor` = `{ created_at: Timestamptz, id: Uuid }` — the decoded keyset position. Encoded as an opaque base64 string; **decoded via `parseBoundarySafe(WardrobeCursor, …)`**, and a cursor that fails to parse → `errorResponse(400, …)`, never a silent full scan.
   - `WardrobeListResult` = `{ items: WardrobeItemRow[], next_cursor: string | null }` — `next_cursor` is non-null iff a full clamped page was returned (there may be more).
   - `DedupeResolveRequest` = `.strict()` `{ keep_id: Uuid, discard_id: Uuid }`. **No `mode` field**: keep-one is the only server operation; keep-both is a client-side no-op that never reaches this endpoint. Reject `keep_id === discard_id` at the boundary (a self-merge would delete a referenced item).
   - `DedupeResolveResult` = `{ merged: boolean }`.
   - **Constant** `MAX_PAGE_SIZE = 100` and `DEFAULT_PAGE_SIZE = 50`.

2. **`packages/functions/src/wardrobe/list.ts`** — `export const listWardrobe: AuthedHandler`:
   - `parseBoundary(ListWardrobeRequest, query)` from the request query params.
   - **Server clamp (load-bearing):** `const limit = Math.min(req.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)` (and floor at 1). Never trust the client's `limit`.
   - Decode `cursor` (if present) via `parseBoundarySafe(WardrobeCursor, decode(cursor))`; on failure → `errorResponse(400)`.
   - Call `repo.listItems({ …filters, cursor, limit })`. The repo issues the keyset SELECT:
     ```sql
     SELECT id, user_id, category, color, pattern, attributes, availability,
            cutout_path, parse_job_id, phash,
            created_at::text, updated_at::text
     FROM public.wardrobe_items
     WHERE user_id = auth.uid()
       AND ($category::text IS NULL OR category = $category)
       AND ($color::text    IS NULL OR color    = $color)
       AND ($availability::text IS NULL OR availability = $availability)
       AND ($cursor_created_at::timestamptz IS NULL
            OR (created_at, id) < ($cursor_created_at, $cursor_id))
     ORDER BY created_at DESC, id DESC
     LIMIT $limit
     ```
     (Keyset, **never `OFFSET`** — `OFFSET` re-scans and drifts under concurrent inserts. Uses the `(user_id, created_at, id)` index. RLS still scopes to owner; the explicit `user_id = auth.uid()` is a redundant fast-path, not the security control.)
   - Build `next_cursor` = encoded `(last.created_at, last.id)` iff `items.length === limit`, else `null`.
   - Return `jsonResponse(200, parseBoundary(WardrobeListResult, { items, next_cursor }))`.

3. **`packages/functions/src/wardrobe/availability.ts`** — `export const toggleAvailability: AuthedHandler`:
   - `parseBoundary(UpdateAvailabilityRequest, body)` (reused from `@closet/shared`; `{ item_id, availability }`).
   - `const row = await repo.setAvailability(req.item_id, req.availability)`. Repo runs `UPDATE public.wardrobe_items SET availability = $2 WHERE user_id = auth.uid() AND id = $1 RETURNING …::text`. RLS `WITH CHECK` + the `user_id = auth.uid()` predicate confine it to the caller's row.
   - `null` (0 rows: not owned / not found) → `errorResponse(404)`. Otherwise `jsonResponse(200, parseBoundary(WardrobeItemRow, row))` — the round-tripped row reflects the new `availability`.

4. **`packages/functions/src/wardrobe/dedupe.ts`** — `export const resolveDedupe: AuthedHandler`, the **keep-one MERGE**:
   - `parseBoundary(DedupeResolveRequest, body)` → `{ keep_id, discard_id }` (`keep_id !== discard_id` enforced in the schema).
   - `const { merged } = await repo.mergeKeepOne({ keepId: req.keep_id, discardId: req.discard_id })`.
   - The repo issues **one atomic data-modifying CTE** (one `exec.query()` = one `BEGIN…COMMIT`; atomicity is *why* it is a single statement — the `ON DELETE RESTRICT` FK is checked at statement end, after all re-pointing):
     ```sql
     WITH repoint_wear AS (
       UPDATE public.wear_log SET item_id = $keep
       WHERE user_id = auth.uid() AND item_id = $discard
       RETURNING 1
     ),
     drop_dup_membership AS (           -- avoid UNIQUE(outfit_id,item_id) collision:
       DELETE FROM public.outfit_items d -- if an outfit already contains $keep, drop
       WHERE d.user_id = auth.uid() AND d.item_id = $discard  -- the $discard membership
         AND EXISTS (SELECT 1 FROM public.outfit_items k
                     WHERE k.user_id = auth.uid() AND k.item_id = $keep
                       AND k.outfit_id = d.outfit_id)
       RETURNING 1
     ),
     repoint_outfit AS (                 -- re-point the rest
       UPDATE public.outfit_items SET item_id = $keep
       WHERE user_id = auth.uid() AND item_id = $discard
       RETURNING 1
     )
     DELETE FROM public.wardrobe_items
     WHERE user_id = auth.uid() AND id = $discard
     RETURNING 1;                         -- 0 rows ⇒ discard not owned/absent ⇒ merged=false
     ```
   - `merged=false` (discard not owned / already gone) → `jsonResponse(200, { merged: false })` (idempotent no-op, not an error — a retried resolution must not 500). `merged=true` → `jsonResponse(200, { merged: true })`, validated through `DedupeResolveResult`.
   - **Keep-both** is deliberately *unrepresentable* on the server: there is no endpoint/branch for it. Document this in a one-line `// why` comment (the non-obvious *why*, per CLAUDE.md): keep-both is a client-side dismissal, zero server state change.

5. **`packages/functions/src/wardrobe/wardrobe.integration.test.ts`** — the independent oracle (§5). Suffix EXACTLY `*.integration.test.ts`. Reuses task-01's `applyMigrations` + `makeTenantExecutor` + `startPg` helpers; drives the three built handlers through a real `app_user` executor against a throwaway Postgres testcontainer; every query carries `request.jwt.claim.sub`. **Red-first:** written before `makeWardrobeRepo`'s methods exist / before the clamp lands (see §5).

## 4. Acceptance criteria (Given-When-Then)

**List — keyset + clamp (F4):**
- Given tenant A owns 250 items, When A calls `listWardrobe` with `limit = 100000`, Then **at most 100** items are returned (server clamp), sorted `created_at DESC, id DESC`, and `next_cursor` is non-null.
- Given the first page's `next_cursor`, When A pages forward until `next_cursor` is `null`, Then every one of A's 250 items appears **exactly once** — no gaps, no duplicates across page boundaries.
- Given filters `category='top'` and `availability='clean'`, When A lists, Then only A's rows matching both are returned.
- Given a malformed `cursor` string, When A lists, Then `errorResponse(400)` (not a silent unfiltered full scan).

**Availability toggle (F7):**
- Given A owns an item that is `clean`, When A toggles it `clean → dirty → unavailable → clean`, Then each response round-trips the new `availability` and a fresh SELECT as A reflects it.
- Given B owns an item, When A calls `toggleAvailability` for B's `item_id`, Then `errorResponse(404)` (0 rows under RLS) and B's item is unchanged on a fresh SELECT as B.

**Dedupe keep-one MERGE (F4, §7) — history preservation:**
- Given A owns items `KEEP` and `DISCARD`, with `w` `wear_log` rows and `o` `outfit_items` rows pointing at `DISCARD`, When A calls `resolveDedupe({ keep_id: KEEP, discard_id: DISCARD })`, Then: `DISCARD` is gone from `wardrobe_items`; `KEEP` remains; **the total `wear_log` row count for A is unchanged** (moat preserved), with `DISCARD`'s `w` wear rows now pointing at `KEEP`; `outfit_items` referencing `DISCARD` now reference `KEEP` (minus any dropped to satisfy `UNIQUE(outfit_id,item_id)`); response `{ merged: true }`.
- Given an outfit that already contains `KEEP` **and** `DISCARD`, When A merges, Then no `UNIQUE(outfit_id,item_id)` violation is raised — the `DISCARD` membership in that outfit is dropped, the others re-point.
- **Control (proves it is a MERGE, not a cascade):** Given `DISCARD` has `wear_log` rows, When a bare `DELETE FROM public.wardrobe_items WHERE id = DISCARD` is attempted as `app_user` (no re-pointing), Then the DB raises a **foreign-key violation** (`ON DELETE RESTRICT`) — proving the moat cannot be silently cascaded and that the merge's re-point-first ordering is load-bearing.
- Given A already merged (or `DISCARD` never existed), When A retries `resolveDedupe`, Then `{ merged: false }` and no error (idempotent).
- Given B's item ids, When A calls `resolveDedupe` naming B's `discard_id`, Then nothing of B's changes (RLS: 0 rows re-pointed/deleted) and A gets `{ merged: false }`.

**Keep-both:**
- Keep-both never calls the server: assert no endpoint accepts a keep-both `mode` and that a `resolveDedupe` is the only mutation path (structural — there is no keep-both branch). A test that constructs the "keep-both" scenario performs **zero DB writes** and both items remain present.

## 5. Verification requirements — the independent oracle

**Tier (docs/05):** Tier-2 (adversarial: cross-tenant + moat-preservation + clamp-enforcement) realized on the Tier-3 real-Postgres substrate (`applyMigrations` full chain + `SET LOCAL ROLE app_user`). **The response is never the oracle** — every claim is checked against **persisted database state observed from a vantage the handler does not control** (a fresh SELECT / a superuser count), and via **differential row counts** across the merge.

**Red-first (mandatory, per docs/05 + CLAUDE.md):** write the oracle before the behavior exists and record the red:
- Before the clamp lands (handler passes the client `limit` straight through), the `limit = 100000` case returns 250 rows → **red**. After the clamp, ≤100 → green. This is the mutation the clamp test kills.
- Before `mergeKeepOne` re-points references, the merge's final `DELETE` of a worn `DISCARD` raises the `ON DELETE RESTRICT` FK error → the merge **fails red**. Only re-point-then-delete turns it green — proving the ordering is what preserves the moat.

**Mechanism — three differential/mutation-target checks + one anti-mirror control, all as `app_user`:**

1. **Moat preservation (differential row counts — the core oracle).** As A, seed `KEEP` + `DISCARD`, `w ≥ 2` `wear_log` rows on `DISCARD`, and `o ≥ 1` `outfit_items` on `DISCARD` (including one outfit that *also* contains `KEEP`, to exercise the UNIQUE-collision branch). Record `wearCountBefore = SELECT count(*) FROM wear_log WHERE user_id=A`. Run `resolveDedupe`. Then assert against fresh SELECTs (not the response): `wearCountAfter === wearCountBefore` (**no wear row lost**); `count(wear_log WHERE item_id=DISCARD) === 0`; `count(wear_log WHERE item_id=KEEP)` increased by exactly `w`; `wardrobe_items` has no `DISCARD` and still has `KEEP`; no duplicate `(outfit_id, item_id)` exists. The mutant this kills: a keep-one implemented as a bare `DELETE` (would either lose the wear rows via cascade or be refused by RESTRICT) — either way `wearCountAfter` ≠ `wearCountBefore` or the call errors.

2. **RESTRICT bites without re-pointing (mutation-target control).** As A, attempt a bare `DELETE FROM public.wardrobe_items WHERE user_id=auth.uid() AND id=DISCARD` (a worn item) through the executor. Assert it **raises a foreign-key-violation SQLSTATE (`23503`)** — catch the error and assert its class, do not merely assert "0 rows." This proves the moat is structurally protected (task-03's `ON DELETE RESTRICT`) and that the merge's value is the *re-point ordering*, not a permissive schema. Removing `RESTRICT` (or making the FK cascade) would flip this control and silently allow moat loss — the test asserts the *presence* of the refusal.

3. **Clamp enforcement (differential).** As A with 250 items, call with `limit = 100000` → assert `items.length <= 100` **and** page-through with `next_cursor` visits all 250 exactly once (a `Set` of ids has size 250, no id seen twice). Kills the "trust the client limit" mutant and the "OFFSET drift / duplicate across pages" mutant.

4. **RLS-in-effect control (anti-mirror — mandatory).** Include one query that **succeeds as the container superuser but MUST fail / return 0 as `app_user`**: e.g. as A, `listWardrobe` returns 0 of B's items; a `toggleAvailability` on B's item → 404 and B's row unchanged on a fresh SELECT as B; `resolveDedupe` naming B's `discard_id` → `{ merged: false }` and a superuser count shows B's items and wear rows untouched. Without this control, forgetting `SET LOCAL ROLE app_user` would let every "isolation" assertion pass vacuously under RLS bypass (the exact fitapp trap).

**What green looks like:** the file runs under the vitest `integration` project (exact `*.integration.test.ts` suffix), applies the full migration chain (`0001`→`0007`), and: (1) merge preserves the wear-row count and re-points refs (differential counts equal, `DISCARD` refs → 0); (2) the bare delete raises FK `23503`; (3) `limit=100000` clamps to ≤100 and keyset paging visits all rows exactly once; (4) the anti-mirror control fails-as-`app_user`-as-required; and the happy paths (own-row list, toggle round-trip, keep-both zero-write) hold. If any "merge preserved history" claim passes only because a handler returned `{ merged: true }` (rather than the DB showing the wear rows re-pointed and the count unchanged), that is a mirror oracle and does not count.

## 7. Hot-path / performance notes

- **Merge touches the moat.** `wear_log` is the ~180M-row retention moat (docs/06 §7). The re-point `UPDATE`s and the RESTRICT FK check MUST hit the `wear_log(item_id)` and `outfit_items(item_id)` child indexes (task-03), not seq-scan. The single-statement CTE keeps the whole merge in one transaction so the FK is validated once at statement end rather than per re-point. No `EXPLAIN` gate is added here, but the query is written index-first (predicates on `(user_id, item_id)`); if a later scale test shows a seq-scan on `wear_log`, that is a task-03 index regression, not a handler bug.
- **List is keyset, never OFFSET.** `OFFSET` re-scans skipped rows (O(offset)) and drifts under concurrent inserts, producing duplicates/gaps across pages. The `(created_at, id) < (cursor)` keyset on the `(user_id, created_at, id)` index is O(log n) per page and stable under inserts.
- **Clamp caps blast radius.** `MAX_PAGE_SIZE = 100` bounds the worst-case row scan + JSON serialization per request regardless of a hostile or buggy client.

## Metadata

- **Parent spec:** `docs/06-backend-design.md` §4 (`wardrobe` Edge Function, F4/F7), §3 (`wardrobe_items` columns + indexes), §7 (dedupe keep-one MERGE rule + `ON DELETE RESTRICT`).
- **Step:** Wave 3 (repos + read/write endpoints). Depends on **task-01** (test helpers: `applyMigrations`, `makeTenantExecutor`, `startPg`; `app_user` role), **task-02/03** (`wardrobe_items` + `wear_log` + `outfit_items` migrations, the child indexes, the `ON DELETE RESTRICT` FK), **task-05** (`@closet/shared` schemas: `WardrobeItemRow`, `UpdateAvailabilityRequest`, `parseBoundary`), **task-09** (`makeWardrobeRepo` exposing `listItems` / `setAvailability` / `mergeKeepOne` — the DB seam), **task-09a** (`AuthedHandler`, `withAuth`, `jsonResponse`, `errorResponse`).
- **Demo (isolatable):** `pnpm --filter @closet/functions test -- wardrobe.integration.test.ts` (or `pnpm verify:full`) against a throwaway Postgres testcontainer — no external services, no provider, no money path.
- **Complexity:** medium. Two thin handlers (list, toggle) + one subtle one (the merge's atomic re-point-then-delete with the `UNIQUE(outfit_id,item_id)` collision branch) + a differential-count oracle. The subtlety is entirely in the merge ordering and the clamp being a server guarantee.
- **Dependencies:** task-01, task-02, task-03, task-05, task-09, task-09a. **File ownership:** owns `packages/functions/src/wardrobe/*.ts` + `packages/functions/src/wardrobe/wardrobe.integration.test.ts` exclusively; consumes (never writes) `@closet/db` and `@closet/shared`. No cross-task file overlap.
