# Task: Outfits endpoint — outfit + outfit_items CRUD (F6)

## 1. Intent
The manual outfit builder (F6): create/read/update/delete outfits and their member items. Every referenced `item_id` must belong to the caller — guaranteed structurally by the composite FK, so a cross-tenant reference is unrepresentable, not merely validated. Outfit *create* is idempotent under retry via a client-minted `id` (see decision D-001), so a double-tap never creates two outfits.

## 2. Context & constraints
- **Spec reference:** docs/06 §3 (`outfits`, `outfit_items` — composite FKs `(user_id,id)`), §4 (outfits endpoint, client_id-idempotent). **Decision docs/decisions/D-001** (READ IT): outfit-create idempotency uses a **client-minted `id`** + `ON CONFLICT (user_id, id) DO NOTHING` — do NOT add a `client_id` column (that contradicts §3 and needs a migration; the `UNIQUE(user_id, id)` constraint already exists in 0004).
- **Codebase patterns:** docs/PATTERNS.md "Handler" + "Integration test" blocks. Use the repo factories from task-09b (`makeOutfitsRepo`, `makeOutfitItemsRepo`) and `withAuth`/`AuthedHandler`/`respond` from task-09a — both built earlier in this same Wave 3.
- **Code-style rules (CLAUDE.md):** identity from `ctx.userId`, never the body; `parseBoundary(CreateOutfitRequest, body)` etc. at the boundary; repos are the only DB seam (no `supabase.from()`); `const` over `let`; early returns; structured logger.
- **What NOT to touch:** any `packages/shared` schema file **except** `packages/shared/src/schemas/outfits.ts` (see below — an orchestrator-approved one-file widening per D-001); no migrations; no other endpoint's files; nothing orchestrator-owned.
- **Reversibility class:** reversible.

## 3. Technical requirements
1. **Schema edit (the ONLY shared-schema change, per D-001):** in `packages/shared/src/schemas/outfits.ts`, add an **optional** `id: Uuid` field to `CreateOutfitRequest` (keep `.strict()`; `id` is the only new field). This is the caller-minted idempotency key. Do NOT add any other field and do NOT touch any other schema file.
2. `packages/functions/src/outfits/` handlers: create, get, list, update (rename / re-slot items), delete.
3. **Create** (`POST`): `parseBoundary(CreateOutfitRequest, body)`; insert the outfit via `INSERT ... ON CONFLICT (user_id, id) DO NOTHING`, then read the row back (so a retry with the same `id` returns the same outfit — not a racy SELECT-then-INSERT); insert `outfit_items` for each input item. If the caller omits `id`, mint one server-side (still idempotent for callers that supply one).
4. **Cross-tenant safety:** rely on the composite FK `outfit_items(user_id, item_id) → wardrobe_items(user_id, id)` — a foreign `item_id` raises `23503`; map that to a 400/409 via `errorResponse`. Handler validation is a fast-fail, the FK is the guarantee.
5. All reads/writes go through the repos as `ctx.userId`; RLS scopes every row.
6. Deno shim `supabase/functions/outfits/index.ts` = `serveAuthed(handler)`.

## 4. Acceptance criteria (Given-When-Then)
1. **Create + read.** Given a valid `CreateOutfitRequest` with items the caller owns, When created, Then the outfit + its `outfit_items` persist and read back scoped to the caller.
2. **Idempotent create.** Given create with client-minted `id = X`, When the same request is retried with `id = X`, Then exactly ONE outfit row exists and both responses return the same outfit (ON CONFLICT DO NOTHING + read-back).
3. **Cross-tenant item rejected.** Given a `CreateOutfitRequest` naming another tenant's `item_id`, When created, Then it fails the composite FK (23503) and no `outfit_items` row lands; a SELECT as the other tenant shows nothing.
4. **Isolation.** Given tenant A's outfit, When tenant B lists/gets, Then 0 rows.
5. **Delete cascade.** Given an outfit with items, When deleted, Then its `outfit_items` cascade (per the FK) and wear_log rows are unaffected (F8 moat; wear_log FK is RESTRICT/SET NULL, not cascade).
6. **Empty/edge.** Empty `items` array is valid (an outfit with no items yet); a malformed body 400s.

## 5. Verification requirements (independent signal)
docs/05 **Tier-2 + Tier-3**. Integration test (`packages/functions/test/outfits.integration.test.ts`, exact suffix) against real Postgres as `app_user`:
- **Idempotency oracle:** create with id X, retry with id X → assert `COUNT(*) = 1` for that outfit via a fresh SELECT (differential row count, not the handler's response).
- **Cross-tenant oracle:** the foreign-`item_id` insert raises `23503` AND a SELECT as the victim tenant returns 0 — graded from the DB, not the handler's status.
- **Red-first:** demonstrate the idempotency assertion FAILS against a naive plain-`INSERT` implementation (two rows), then passes with `ON CONFLICT`. Green = all 6 criteria pass.

## Metadata
- **Parent spec:** docs/06 §3/§4; decision D-001
- **Step:** Wave 3
- **Demo:** Create an outfit, double-submit it → one outfit; try to reference someone else's garment → rejected.
- **Complexity:** Medium
- **Dependencies:** task-09a (withAuth/respond), task-09b (repos), W1 tables, W2 `CreateOutfitRequest`.
