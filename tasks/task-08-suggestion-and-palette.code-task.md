# Task: Weather-aware suggestion heuristic (F5) + palette scoring (B1)

## 1. Intent
The system produces an outfit suggestion that is **safe by construction**: it never proposes a garment the user cannot actually wear right now (dirty or unavailable), it always returns *something* wearable when any clean item exists and a defined non-empty fallback when none do, and colder weather never lowers the aggregate warmth of what it recommends. Self-identified palette scoring is purely **advisory** — it ranks and annotates but can never remove, hide, or block an item. Both are on-device pure functions with no I/O, no clock, no randomness.

## 2. Context and constraints

**Spec ref:** docs/01 F5 (weather-aware suggestion heuristic v1), docs/01 B1 (self-identified palette scoring); docs/06 "on-device pure fns" (suggestion/palette run client-side in `packages/shared`, deterministic, inputs passed in — no DB, no `Date.now()`, no network).

**Codebase patterns** (inlined from docs/PATTERNS.md; real backup path `../fitapp/packages/shared/src/`):
- These are **not** repos/handlers/migrations. They are the pure-function layer that `packages/shared` exposes to `mobile` and (via wardrobe reads) to `functions`. The Repo-factory / AuthedHandler / migration blocks do **not** apply here — no `QueryExecutor`, no `exec`, no `auth.uid()`, no SQL. If you find yourself importing from `packages/db` you are in the wrong layer.
- Follow the shared-package convention: named exports, no default export, pure functions typed against interfaces declared in this file. Domain types that already exist in `packages/shared/src` (e.g. wardrobe item shape) should be imported, not redefined — but this task defines only the *input view* each function needs (see req 1), it does not touch the canonical table types.

**Code-style rules from CLAUDE.md (enforced):**
- `const` over `let`/`var`; immutable by default — no in-place mutation of input arrays (copy before sort).
- Early returns over nested conditionals (the zero-clean-items fallback is an early return).
- **Parse, don't cast** — validate the input shape at the function boundary with the shared `parseBoundary(Schema, x)` helper before reasoning over it; never `as`-cast untrusted callers' data.
- No `supabase.from()` anywhere in `packages/shared` (lint-banned outside `packages/db` regardless).
- Config/env via `envValue(...)`, never `process.env` — **N/A here**: these functions take all inputs as arguments and read no env.
- Use `git grep` (not ad-hoc find) when locating existing types to reuse.
- Structured logger only if logging at all — **prefer no logging**; these are pure functions, a caller logs.

**What NOT to touch:** any migration (`packages/db/migrations/**`), any repo (`packages/db/src/repos/**`), any handler (`packages/functions/**`), the mobile UI. Do not add a dependency other than `fast-check` (dev) if not already present. Do not change the canonical wardrobe-item / outfit table types. **One-writer-per-file: touch ONLY** `packages/shared/src/suggestion.ts`, `packages/shared/src/palette.ts`, and their matching `packages/shared/src/suggestion.test.ts`, `packages/shared/src/palette.test.ts`.

**Reversibility class:** reversible (pure additive functions in shared; no schema, no data, no external side effects). Deleting the four files fully reverts.

## 3. Technical requirements (numbered, dependency-ordered)

1. **Input view + boundary parse.** In `suggestion.ts` define a minimal `SuggestionItem` view (the fields the heuristic actually reads: `id: string`, `status: 'clean' | 'dirty' | 'unavailable'` — or the spec's equivalent availability flag, `warmth: number` on a fixed ordinal scale, `category: string`) and a Zod (or the repo's existing schema lib) schema `SuggestionInputSchema` covering `{ items: SuggestionItem[]; tempC: number }`. Entry point calls `parseBoundary(SuggestionInputSchema, input)` first and reasons only over the parsed value.

2. **Wearability filter (never-dirty / always-available).** `suggestItems` considers **only** items whose status is `clean` AND available. Dirty or unavailable items are excluded before any scoring. This filter is the first thing after parsing and is unconditional — no temperature or palette branch can re-admit an excluded item.

3. **Warmth-monotone selection.** Given `tempC`, compute a target warmth band such that lower `tempC` never selects a *lower* aggregate warmth. Selection picks clean items to meet/exceed the target; the returned outfit's summed (or per-category max, define which) warmth must be **non-decreasing as `tempC` decreases**, holding the wardrobe fixed. Document the exact aggregate in a one-line comment (the *why*, not the *what*).

4. **Fallback (always-non-empty when possible).** If ≥1 clean item exists, the result is a non-empty, well-formed suggestion (never empty, never a partial/broken record). If **zero** clean items exist, return the *defined* fallback: a well-formed result with an explicit `fallback: true` flag and a non-empty, human-meaningful reason (e.g. `'no_clean_items'`) — never a throw, never `null`, never an empty item list masquerading as a real suggestion. Decide and document the fallback shape in the return type.

5. **Palette scoring is advisory-only.** In `palette.ts` define `scorePalette(items, paletteProfile)` returning, for each **input** item, an annotation `{ id, score, withinPalette: boolean }`. The output array length **equals** the input array length and preserves every `id` — it is a pure annotation/ranking, it does **not** filter, drop, hide, reorder-away, or block any item. `scorePalette` performs **no** wearability judgement and has no authority over `suggestItems`' filter.

6. **Composition boundary.** If suggestion consumes palette at all, it may only use it to *rank among already-wearable clean items*; palette can never cause a clean+available item to become unselectable when it is the only candidate meeting the warmth target (advisory-never-blocks holds at the composed level too).

7. **Purity.** No `Date`, `Math.random`, no I/O, no mutation of arguments. Same inputs → same outputs. All fields returned as plain serializable values.

## 4. Acceptance criteria (Given-When-Then)

- **Happy (warm):** Given a mixed wardrobe with several clean items and `tempC = 24`, When `suggestItems` runs, Then it returns a non-empty suggestion containing only clean+available items and no `fallback` flag.
- **Happy (cold):** Given the same wardrobe and `tempC = -5`, When `suggestItems` runs, Then the aggregate warmth of the result is ≥ the aggregate warmth returned at `tempC = 24`.
- **Edge — all dirty:** Given every item `dirty`/`unavailable`, When `suggestItems` runs, Then it returns the defined fallback (`fallback: true`, non-empty reason), never a clean-looking empty suggestion and never a throw.
- **Edge — one clean item only:** Given exactly one clean item that is off-palette, When `suggestItems` runs, Then that item is still selected (palette never blocks the sole wearable candidate).
- **Empty wardrobe:** Given `items: []`, When `suggestItems` runs, Then fallback with reason (e.g. `'no_clean_items'`), well-formed.
- **Palette advisory:** Given any `items` array and any `paletteProfile`, When `scorePalette` runs, Then output length == input length and the set of returned `id`s == the set of input `id`s (nothing hidden or dropped).
- **Malformed input:** Given input failing `SuggestionInputSchema` (e.g. `tempC` missing, unknown status), When the entry point runs, Then `parseBoundary` rejects at the boundary (no partial reasoning over bad data).
- **Concurrent/repeated:** Given the same input evaluated twice, Then byte-identical outputs (determinism — stands in for "concurrent" since pure).

## 5. Verification requirements — the independent oracle

**Tier:** docs/05 **Tier-1 property tests** (fast-check), in `suggestion.test.ts` and `palette.test.ts`. This is the named independent oracle for this task — **not** a hand-picked example unit test the author grades green. Mechanism: **property/invariant with generated arbitraries** (mutation-target style: the generator adversarially mixes statuses, warmths, temperatures, palette profiles, and empties). Red-first: each law must be shown to fail against a deliberately broken implementation stub before the real one turns it green (note this in the test file header).

Implement these four laws over `fast-check` arbitraries (arbitrary mixed wardrobes: random mix of clean/dirty/unavailable, random `warmth`, random `tempC`, random palette):

1. **Never-dirty / always-available:** ∀ generated wardrobe, every item in `suggestItems(...)`'s selected list has status `clean` AND available. (Fails on any leak.)
2. **Always-fallback / never-empty-broken:** ∀ wardrobe with ≥1 clean item → result is non-empty and well-formed with no fallback flag; ∀ wardrobe with 0 clean items → result is the defined fallback (`fallback: true`, non-empty reason). Never empty-and-unmarked, never a throw.
3. **Warmth monotonicity:** ∀ fixed wardrobe and ∀ temps `t1 < t2`, aggregate-warmth(`suggestItems(w, t1)`) ≥ aggregate-warmth(`suggestItems(w, t2)`). (Monotonic non-decreasing as temperature falls.)
4. **Palette advisory-never-blocks:** ∀ `items`, ∀ `paletteProfile`: `scorePalette` returns exactly one annotation per input `id` (length and id-set preserved, nothing hidden/blocked); and at the composed level, an off-palette item that is the unique clean candidate meeting the warmth target is still selected.

**Green =** all four properties hold across the full fast-check run (default ≥100 cases each, no falsifying shrink) with no `.skip`/`.only` and no property weakened to a fixed example. A property that only asserts on a single crafted input does **not** satisfy this section.

## Metadata
- **Parent spec:** docs/06 (on-device pure fns); docs/01 F5, B1.
- **Step:** wave 2.
- **Demo (isolatable):** `pnpm --filter @closet/shared test suggestion palette` runs the four property suites in isolation with no DB/container.
- **Complexity:** M — pure logic, but the monotonicity + advisory-never-blocks composition invariants require care.
- **Dependencies:** none upstream at runtime (pure fns); dev-only `fast-check`. Consumes the shared wardrobe-item view type (import, do not redefine). No dependency on the db/functions waves.
