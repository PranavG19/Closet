# Task: Zod schemas for all rows + request/response + parseBoundary

## 1. Intent
Establish a single source of truth in `packages/shared` where every one of the 8 table rows and every request/response body is described by a Zod schema, and where `parseBoundary`/`parseBoundarySafe` are the only sanctioned way to turn untyped input into a typed value. The system property: no `as`-cast ever crosses a trust boundary — a value is either parsed-and-validated at the boundary or it does not become a typed domain object at all.

## 2. Context and constraints

**Spec reference:** docs/06 §3 (tables: wardrobe_items, parse_jobs, outfits, outfit_items, wear_log, palette_profile, subscriptions, webhook_events) — the column set, nullability, and enums there are authoritative. docs/06 §on request/response contracts for handler bodies. CLAUDE.md: **parse-don't-cast**.

**Codebase patterns** (from docs/PATTERNS.md, inlined below; real backup path `../fitapp` — do NOT open it):
- *Repo factory* block: repos SELECT with `timestamptz -> ::text` and `numeric -> ::float` casts. **Row schemas must model exactly what the repo returns**: `created_at`/`updated_at` as ISO-8601 `z.string().datetime()` (not `Date`), numeric/float columns as `z.number()`, uuids as `z.string().uuid()`. The schema is the contract the repo's cast output must satisfy.
- *Handler* block: `parseBoundary(Schema, x)` is called "at every boundary" — request body in, response body out. `user_id` is never in a request schema (it comes from `ctx.userId`); a request body schema that contains `user_id` is a bug.
- *Domain table + RLS* block: append-only tables (`wear_log`) and enum-bearing columns define the allowed value sets that the Zod enums must mirror.

**Explicit code-style rules (CLAUDE.md):**
- `const` over `let`/`var`; immutable by default.
- Early returns over nested conditionals; small single-purpose functions.
- **parse-don't-cast**: `parseBoundary` throws on invalid; no `as` to launder unknown input anywhere in the codebase.
- No `supabase.from()` outside `packages/db` (not relevant here but do not introduce DB access).
- Config/env via `envValue`, never `process.env` (not expected in this task).
- Use `git grep` for search; structured logger (not `console.log`) if any logging is added.
- Name schemas for what they hold: `WardrobeItemRow`, `CreateOutfitRequest`, `WearLogRow` — no bare `Schema`/`data`.

**What NOT to touch:** no migrations, no repos, no handlers, no `packages/db` or `packages/functions` runtime code. This task only writes `packages/shared/src/schemas/*` + `packages/shared/src/parse.ts` + their `*.test.ts`. Do not add a new external dependency beyond `zod` and `fast-check` (dev). Do not wire schemas into repos/handlers — that is a downstream wave's job (export them so those waves can import).

**Reversibility class:** reversible — pure additive library code in `packages/shared`, no schema/data/contract migration, deletable without side effects.

## 3. Technical requirements (numbered, dependency-ordered)

1. **Enum/primitive vocabulary first.** In `packages/shared/src/schemas/common.ts` define shared leaf schemas: `Uuid = z.string().uuid()`, `Timestamptz = z.string().datetime({ offset: true })` (matches `::text` cast of `timestamptz`), and any cross-table enums. Every column's type derives from these leaves — no ad-hoc `z.string()` where a uuid/timestamp is meant.

2. **One row schema per table, one file per domain.** Create `packages/shared/src/schemas/` with a file per domain grouping (e.g. `wardrobe.ts` → `WardrobeItemRow`, `ParseJobRow`; `outfits.ts` → `OutfitRow`, `OutfitItemRow`, `WearLogRow`; `profile.ts` → `PaletteProfileRow`; `billing.ts` → `SubscriptionRow`, `WebhookEventRow`). Each `*Row` schema:
   - Includes `id: Uuid`, `user_id: Uuid` (where the table has one — `webhook_events` may not), `created_at: Timestamptz`, `updated_at: Timestamptz` (only where the table has `updated_at`).
   - Types every domain column per docs/06 §3, including nullability (`.nullable()`) and enums (`z.enum([...])`) exactly as the column allows.
   - Numeric/`numeric` columns → `z.number()` (repo casts to `::float`).
   - Exports an inferred type: `export type WardrobeItemRow = z.infer<typeof WardrobeItemRow>` (schema and type share the name via a `const` schema + `type` alias, matching repo import ergonomics).

3. **Request/response schemas alongside rows.** For each write handler in docs/06, define its request body schema (`CreateWardrobeItemRequest`, `CreateOutfitRequest`, `LogWearRequest`, etc.) and response schema (usually a `*Row` or `{ items: WardrobeItemRow[] }`). **Request schemas MUST NOT contain `user_id`** (asserted by a test in §4). Idempotency: `parse_jobs` create-request carries the per-photo idempotency key; `wardrobe_items` create paths carry NO idempotency key (a request schema for creating a wardrobe item must not declare one).

4. **`parseBoundary` + `parseBoundarySafe` in `packages/shared/src/parse.ts`:**
   - `export function parseBoundary<T>(schema: z.ZodType<T>, input: unknown): T` — returns `schema.parse(input)`; on failure throws a typed `BoundaryParseError` (extends `Error`) carrying the Zod issues and an optional boundary label, so callers get a structured, loggable failure rather than a raw ZodError. No `as`, no silent coercion.
   - `export function parseBoundarySafe<T>(schema, input): { ok: true; value: T } | { ok: false; error: BoundaryParseError }` — the non-throwing variant for boundaries that convert failures to `errorResponse`. Built on `schema.safeParse`.
   - These are the ONLY exported parse entrypoints; do not re-export raw `.parse`.

5. **Barrel export.** `packages/shared/src/schemas/index.ts` re-exports every schema + inferred type; `packages/shared` public entry exports `schemas` and `parse`. Downstream repos/handlers import from here.

6. **No behavior beyond validation.** Schemas do not transform/default values silently (no `.default()` that masks a missing field at a boundary unless docs/06 specifies a server default). Prefer strict object schemas (`.strict()`) on **request** schemas so unknown keys are rejected, matching parse-don't-cast intent; row schemas mirror DB output and need not be strict.

## 4. Acceptance criteria (Given-When-Then)

- **Happy — row round-trips:** Given a `WardrobeItemRow` value with all required fields well-formed, When `parseBoundary(WardrobeItemRow, value)` runs, Then it returns a value deep-equal to the input and typed as `WardrobeItemRow`.
- **Happy — request accepted:** Given a valid `CreateOutfitRequest` body (no `user_id`), When parsed, Then it returns the typed request.
- **Edge — malformed rejected:** Given an object with `id: "not-a-uuid"` (or a missing required column, or a wrong enum value, or `created_at: "2026-01-01"` without time), When `parseBoundary` runs, Then it throws `BoundaryParseError` and `parseBoundarySafe` returns `{ ok: false }` with populated issues.
- **Edge — user_id forbidden on requests:** Given any request schema, When its shape is inspected, Then it has no `user_id` key (guards the "user_id is always ctx.userId" invariant).
- **Edge — idempotency placement:** Given the `wardrobe_items` create-request schema, Then it has no idempotency-key field; given the `parse_jobs` create-request schema, Then it does (per-photo).
- **Edge — unknown key on strict request:** Given a `CreateOutfitRequest` with an extra unexpected key, When parsed, Then it is rejected.
- **Empty:** Given a list-response schema (e.g. `{ items: WardrobeItemRow[] }`) with `items: []`, When parsed, Then it succeeds with an empty array (empty is valid, not an error).
- **Concurrent/independence:** N/A for pure schema code — no shared mutable state; `parseBoundary` is a pure function of `(schema, input)` and calling it concurrently on distinct inputs yields identical results to sequential calls. Assert purity by parsing the same frozen input twice and getting equal, non-aliased outputs.

## 5. Verification requirements — the independent oracle

**Tier:** docs/05 **Tier-1** (pure/property, no container, no DB).

**Mechanism:** **round-trip property test with `fast-check`**, in `packages/shared/src/schemas/*.test.ts` (and `parse.test.ts`). This is an independent oracle because the pass/fail signal comes from `fast-check`'s generator exploring thousands of machine-generated cases and from a red-first rejection suite — not from hand-picked examples the author also asserts on.

Implement both directions:
1. **Property (valid inputs):** For each `*Row` and request schema, build a `fast-check` arbitrary that generates *structurally valid* values (uuids via `fc.uuid()`, timestamps as ISO strings with offset, enums via `fc.constantFrom(...)`, numerics via `fc.double()`), then assert `parseBoundary(Schema, x)` succeeds and its output deep-equals a canonical serialization of `x` — i.e. `parse(serialize(x)) === x`. Run at fast-check default runs ≥ 1000 per schema (`fc.assert(fc.property(...), { numRuns: 1000 })`).
2. **Rejection (malformed inputs, red-first):** For each schema, an arbitrary that perturbs one field into an invalid value (wrong type, bad uuid, out-of-set enum, missing required key, extra key on strict request, `user_id` injected into a request) and assert `parseBoundary` **throws `BoundaryParseError`** and `parseBoundarySafe` returns `{ ok: false }`. Write at least one of these tests *first* and watch it fail against a stub (red-first) before the schema exists, to prove the test can fail.

**What green looks like:** the round-trip property holds over the full generated sample (thousands of cases, zero counterexamples) for every schema; every rejection case throws/returns-not-ok; and `pnpm --filter @closet/shared test` (vitest, non-integration — no `.integration.test.ts` suffix, no container) exits 0. A counterexample shrunk by fast-check (e.g. a nullable column the schema forgot, or a timestamp format mismatch with the repo's `::text` cast) is a real defect in the schema, not the test.

## Metadata
- **Parent spec:** docs/06 §3 (tables) + request/response contracts.
- **Step:** wave 2.
- **Demo (isolatable):** `pnpm --filter @closet/shared test` runs the fast-check round-trip + rejection suites standalone; no DB, no other packages.
- **Complexity:** M — mechanical breadth (8 tables + request/response bodies) plus one reusable parse layer and generator-based property tests; low conceptual risk.
- **Dependencies:** none upstream (pure `packages/shared`; only `zod` runtime + `fast-check` dev). Downstream: repos (wave — DB) and handlers (wave — functions) import these schemas and call `parseBoundary`; the migration/table shape in docs/06 §3 must match column-for-column.
