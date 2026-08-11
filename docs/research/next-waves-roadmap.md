# Next-waves build roadmap — ranked for the autonomous optimize-and-build loop

**Date:** 2026-08-11 · **Basis:** the five research docs in this folder
(`feature-audit.md`, `perf-profile.md`, `metrics-logging-audit.md`,
`llm-efficiency-audit.md`, `color-theory.md`), re-verified against the code as it stands
today (uncommitted tree included). Read-only synthesis; this doc is the only artifact.

## Ranking rule

Each wave is scored by **(value to the daily user loop) × (low effort) × (unblocked)**,
with the highest-value **unblocked, non-colliding** wave first. "Blocked" means it needs a
vantage the agent cannot reach (RevenueCat keys, a real weather provider, a real device
for a perf number). Collision = touches a **shared barrel** (`src/api/client.ts`,
`hooks.ts`, `routes.ts`, the nav barrel `tabs.ts`/`NavShell.tsx`, or a `packages/shared`
pure-fn barrel) or needs the **single simulator** — both must be serialized against any
other lane that touches the same seam.

## Corrections to the source audits (verified in code)

- **F4 wardrobe filters is NOT unbuilt.** The feature-audit predates the current tree.
  `packages/mobile/features/wardrobe/FilterBar.tsx`, `wardrobeFilters.ts`, and
  `wardrobeFilters.test.ts` exist (untracked), and `WardrobeScreen.tsx` already renders
  `<FilterBar>` + `deriveListParams(filter)` + a distinct filtered-empty state. The work
  is **written but uncommitted and unverified** — so it is a *finalize + verify + commit*
  wave, not a *build* wave. That makes it the cheapest high-value item and the #1 below.
- **`withAuth` does no request logging and carries no route label** (`withAuth.ts:92-110`
  calls `handler(...)` directly; no timing, no `event:'request'`). Confirms the
  observability gap and that adding a `route` arg touches the ~20 shim entrypoints.
- **`logWear` has no flip channel client-side** (`client.ts:184`, `hooks.ts:112` send only
  the body; the server `?flip=dirty` at `log-wear.ts:20` is reachable but never called).
- **parse-photo providers are serial** (`parse-photo.ts`: `await vision…` then
  `await cutout…`; cutout does not read vision) — the perf win stands.

---

## Wave 1 — Finalize & verify F4 wardrobe filters ★ do first

- **Why (value):** browsing a real closet by category / colour / availability is the core
  daily-loop surface (docs/03), and the code is already written — the highest value-per-
  remaining-effort item in the repo.
- **Files:** `packages/mobile/features/wardrobe/WardrobeScreen.tsx`,
  `FilterBar.tsx`, `wardrobeFilters.ts`, `wardrobeFilters.test.ts` (all
  wardrobe-feature-scoped; no shared barrel touched — server + `useWardrobe(params)`
  already accept the filter params).
- **Oracle (independent):** (a) red-first unit test in `wardrobeFilters.test.ts` asserting
  `deriveListParams` maps each chip to the right `ListWardrobeParams` and `hasActiveFilter`
  is correct — an oracle over the pure mapping, not the UI; (b) **real dev-client
  screenshot** (memory `closet-sim-loop-works-devclient`): filter to `dirty`/`top`, confirm
  the grid narrows and the filtered-empty copy differs from the empty-closet copy. The grid
  narrows because the **server** re-queries under RLS, so a passing screenshot also proves
  the param plumbing end-to-end.
- **Effort:** S. **Collision:** single-sim (screenshot). **Blocked:** no.
- **Invariants:** `useTokens()` only, no `supabase.from()` (server filters), advisory —
  filtering is not a colour verdict.

## Wave 2 — Parallelize the two parse-photo provider calls

- **Why (value):** halves time-to-first-preview (the F1 "aha") from ~sum(vision,cutout)≈4s
  to ~max≈2s once real providers deploy; the single most load-bearing product latency
  number (perf-profile §"Highest-value win"). Code + test-floor change is doable now.
- **Files:** `packages/functions/src/parse/parse-photo.ts` (wrap the two independent calls
  in `Promise.all`; both consume only `sourcePhotoUrl`).
- **Oracle (independent):** the existing `teaser-parse-ttfp.perf.test.ts` clock — its
  injected-latency floor drops from `2×INJECTED_MS` to `1×INJECTED_MS` (a number the
  handler never sees); plus the degraded-fan-out lane confirms failures still return fewer
  items, never hang.
- **Effort:** S. **Collision:** none (single handler). **Blocked:** no for the code; the
  *real* latency payoff is realized only at deploy (no keys — perf-profile §blocked).
- **Caveat that keeps this a decision, not a silent fix:** serial order means a `vision`
  failure currently *skips* the paid Photoroom cutout; parallelizing adds a cutout charge
  on the vision-failure path — a provider-spend tradeoff. Money autonomy is granted
  (CLAUDE.md), but the tradeoff must be recorded in the RUN-LOG, and the spend-limiter (20/h,
  fail-closed, before any provider call) already bounds blast radius. Identity/path/privacy
  invariants untouched.

## Wave 3 — F6 outfit-builder canvas

- **Why (value):** the entire write path is built and has **zero UI consumers** —
  `outfits-create` server (composite-FK, integration-tested), `useCreateOutfit`, and the
  pure tested `draft.ts` (place/remove/rename/isComplete/toItems). One screen unlocks a
  whole promised feature; highest-value *new* UI that is screenshot-verifiable and
  unblocked.
- **Files:** new `features/outfits/OutfitBuilderScreen.tsx`; edit
  `features/outfits/OutfitsScreen.tsx` (wire the `onAction` stub at line 47/50) and
  `features/outfits/index.ts` (outfits-owned barrel).
- **Oracle (independent):** real dev-client screenshot — place a top + a bottom, confirm
  Save enables exactly when `draft.isComplete` flips, and the saved look then appears in the
  outfits list (a re-fetch from Postgres, not client state). `draft.ts`'s own unit tests
  already oracle the slot logic; the screenshot oracles the wiring.
- **Effort:** M (L if the sim proof is treated as its own step). **Collision:** single-sim,
  and the outfits barrel — keep it **in-feature state**, do NOT add a nav route: `tabs.ts`
  is a flat 7-tab shell with no push nav and is the single-writer nav barrel. **Blocked:** no.
- **Invariants:** `useTokens()`, no `supabase.from()`, no color literals.

## Wave 4 — `withAuth` request line + `x-correlation-id` + coverage test

- **Why (value):** 18 of 20 handlers emit no log and no timing, and every 400/500 in
  `respond.ts` is invisible (metrics-logging §2, §4). One edit at the wrapper — not 18 —
  gives every handler a `{event:'request', route, status, durationMs, correlationId}` line +
  an error line, and returns the correlationId to the client so the two halves can join.
- **Files:** `packages/functions/src/auth/withAuth.ts` (time + log around the `handler`
  call), `respond.ts` (add `x-correlation-id` response header), and the ~20
  `serveAuthed(handler, sql)` shims to pass a static `route` string label.
- **Oracle (independent):** (a) **structural coverage test** — spy the logger sink, drive
  every route registered in `serveAuthed` once, assert exactly one `request` line with the
  right `route`; this makes "a handler with no log" a *red test*, not an eyeball check.
  (b) In `api-load.perf.test.ts`, assert the emitted `durationMs` tracks the harness's
  independent `hrtime.bigint` wall-clock within tolerance — proves the *instrument* is
  accurate, not just that the path is fast. Neither oracle is a self-count.
- **Effort:** M. **Collision:** shared-barrel — the `serveAuthed`/`withAuth` signature is
  the cage-adjacent entrypoint for all ~20 shims (mechanical but wide; serialize against any
  handler lane). **Blocked:** no.
- **Invariants:** the logger's field type structurally forbids passing a raw `Error`/body
  (no PII); `correlationId` is a random uuid (no tenant info on the wire). The webhook's
  `parse.done`/`revenuecat.applied` domain events stay — the generic line only covers the 18
  dark handlers. Keep the money line graded against the **real replayed RevenueCat event**,
  never a mock (metrics-logging §6, unchanged bar).

## Wave 5 — F7: mark dirty / unavailable from the closet

- **Why (value):** `useToggleAvailability` supports all three states but only clean-from-
  Laundry is wired; `unavailable` items have no surface anywhere. Closes the F7↔F8 loop
  from the closet side and reuses an existing hook (no API-barrel change).
- **Files:** `features/wardrobe/WardrobeScreen.tsx` (+ optional in-feature `ItemDetail`
  sheet). Reuses `useToggleAvailability` — no `client.ts`/`hooks.ts` edit.
- **Oracle (independent):** real dev-client screenshot — mark an item unavailable, confirm
  the chip changes and the item is excluded from the Suggestions pick (the heuristic filters
  non-clean itself, so exclusion is a genuine downstream effect, not a client hide).
- **Effort:** M. **Collision:** single-sim (screenshot); no barrel if wardrobe-scoped.
  **Blocked:** no.

## Wave 6 — F8: log the whole outfit + flip-to-dirty

- **Why (value):** the retention moat. Today only `hero.id` is logged
  (`SuggestionsScreen.tsx:201`) and wearing never dirties anything, so the natural laundry
  loop is broken. Log all `selectedRows` and thread `?flip=dirty` so a worn item moves to
  dirty.
- **Files:** `features/suggestions/SuggestionsScreen.tsx`; `src/api/client.ts` (add a flip
  option to `logWear`); `src/api/hooks.ts` (`useLogWear`). The server `?flip=dirty` channel
  already exists (`log-wear.ts:20`, repo `flipToDirty` gated on `EXISTS(ins)` so a duplicate
  never re-flips).
- **Oracle (independent):** RLS-enforced Postgres integration — after logging with
  `flip=dirty`, the worn item's row shows `availability='dirty'` and appears in the Laundry
  query, and a **re-send of the same client_id does not re-flip** (the idempotency property
  is the oracle the author can't fake); plus a screenshot that the worn item leaves the clean
  suggestion pool.
- **Effort:** M. **Collision:** **shared-barrel** — `client.ts` + `hooks.ts` are the API
  barrels every screen imports; do NOT run concurrently with Wave 4 or Wave 7. Serialize.
  **Blocked:** no.
- **Invariants:** `client_id` stays caller-minted at tap time (already correct); no new DB
  seam (server channel exists).

## Wave 7 — Mobile logger + `ApiClient.request()` timing + reveal timing

- **Why (value):** the client half is entirely dark (metrics-logging §4) — no screen-load,
  API-call, upload, or tap→reveal timing, and the server correlationId is never surfaced.
  Depends on Wave 4's `x-correlation-id` header to join the two halves.
- **Files:** new `packages/mobile/src/api/logger.ts` (mirror the functions logger's
  JSON-line shape — mobile imports `shared` only, so copy not import, matching the existing
  `config.ts` pattern); instrument the one transport choke `ApiClient.request()` in
  `client.ts`; time `addApprovedGarment` in `mobile/src/photo/addGarment.ts` for the F1
  reveal.
- **Oracle (independent):** the F1 reveal timing is graded by a **real simulator stopwatch**
  on the visible reveal vs the emitted `add_garment` durationMs (dev-client sim loop) — not a
  self-assertion. API-line correctness is oracled by the server correlationId matching across
  the two logs.
- **Effort:** M. **Collision:** **shared-barrel** (`client.ts`) — serialize with Wave 6;
  single-sim for the reveal oracle. **Blocked:** no (depends on Wave 4).
- **Invariants:** log durations/counts and the closed `AddGarmentOutcome` token set only —
  never a photo path, image bytes, a classifier verdict, or skin tone. The on-device gate
  runs before any of this.

## Wave 8 — Colour engine: emit lightness+chroma, make "neutral" a chroma threshold (A1+A2)

- **Why (value):** value contrast carries more signal than hue (color-theory §4), and the
  `monochromatic` "quietly layered" note over-promises for two near-identical-lightness
  items. Emitting `{lightnessL, chromaC}` from `toColorFamily` lets the note gate on value
  spread and rescues muted dusty-rose/sage/taupe out of a spurious `clash`.
- **Files:** `packages/shared/src/colorFamily.ts`, `harmony.ts`, `suggestionNote.ts`.
- **Oracle (independent):** **metamorphic property tests** (not a mirror) — (a) lowering a
  pair's chroma can only ever move it *out* of `clash`, never into it; (b) the `mono` note
  only says "layered" when `|lightnessL_a − lightnessL_b|` exceeds the band; (c) no output is
  ever a scold. Cutpoints are `[SOFT]` tuning, the axes are `[GROUNDED]`.
- **Effort:** M. **Collision:** shared-barrel (pure `packages/shared` fns) — pure and
  property-testable, no sim. **Blocked:** no.
- **Invariants:** advisory only (never filters/blocks/scolds), self-identified palette
  untouched, colour never prescriptive.

## Wave 9 — Colour → ranking: graded palette + soft equal-warmth re-rank + causal copy (A3+A4+C1)

- **Why (value):** closes the central gap — today `harmony` never touches ranking and
  `scorePalette` is binary `{0,1}`. Grade palette by hue distance and blend palette+harmony
  into a soft affinity applied **only among clean, equally-warm candidates**; then (and only
  then) copy may become causal instead of observational.
- **Files:** `packages/shared/src/palette.ts` (graded score), `suggestion.ts` (soft
  re-rank), `suggestionNote.ts`/`suggestionRationale.ts` (C1/C2/C3 causal + de-jargoned +
  wheel-relativity caveat).
- **Oracle (independent):** property test over generated closets — output **id-multiset ==
  input id-multiset** (colour never adds/drops an item), toggling the colour signal changes
  **at most ordering, never membership**, and warmth-monotonicity under temperature still
  holds (keep thermal warmth and hue temperature as *separate* fields; never sum hue into the
  warmth ordinal). This oracle is generated, not authored per-case.
- **Effort:** L. **Collision:** shared-barrel (`suggestion.ts`); depends on Wave 8.
  **Blocked:** no.
- **Invariants:** `withinPalette` stays a soft label above a threshold, never a gate; colour
  is a within-tier tie-break, never a filter; never scolds a clash (stays silent).

## Wave 10 — LLM cost-guard tests (A/B/C/D)

- **Why (value):** the one LLM call site is already lean/idempotent/throttled, but the
  current guards miss the input-cost axes: model tier and env-lever plumbing. Cheap red-first
  regression protection against a silent upgrade to a pricier model or a dead cost lever.
- **Files:** `packages/functions/src/adapters/openai-vision.adapter.test.ts` (Tests A model-id
  default+override, B env `OPENAI_VISION_MODEL`/`OPENAI_VISION_IMAGE_DETAIL` reach the wire);
  new `openai-vision.effectiveness.test.ts` (Test C ~6 recorded envelopes → exact
  `AIVisionResult` or `BoundaryParseError`); `parse-photo.integration.test.ts` (Test D
  named cost guard: second submit of same `source_photo_hash` keeps `visionCalls()==1`).
- **Oracle (independent):** recorded-payload corpus + the injected-`fetch` harness (no live
  key); the effectiveness test locks the prompt→schema contract from *outside* the adapter.
- **Effort:** S. **Collision:** none (adapter/integration test files). **Blocked:** no.
- **Invariants:** no cross-tenant caching (would break RLS); env via `envValue()`.

---

## Blocked / deferred (honest — not padded into the ranked list)

| Item | Why blocked / deferred | Missing vantage |
|------|------------------------|-----------------|
| **F1 scan→gate→teaser→reveal orchestration** | `PhotoIntakePort` is `available:false`/`screeningAvailable:false` — no picker dep, no on-device classifier clearing a recall floor. The privacy claim is not *legal* until the classifier exists. | Dep: `expo-image-picker`/`expo-image-manipulator` + an ML runtime + a labeled recall corpus. |
| **F2 RevenueCat runtime** | UI is fully built; `makeBillingPort()` returns no offer until keys exist. Oracle **must** be a real webhook event (mock = forbidden mirror). Money autonomy is granted to *build/verify/commit/merge*, but not to fabricate the oracle. | Owner: RevenueCat API keys + App Store product IDs + a replayable real webhook. |
| **F3 post-payment full parse UI** | Chained behind F1 + F2. | Same as above. |
| **F5 real weather** | Heuristic is built; temp is a hardcoded `ASSUMED_TEMP_C = 18`. No `WeatherPort` impl, deliberately (docs/06 §9). | Dep: a weather provider seam + key. |
| **gpt-4o-mini / detail:low cost flip** | Both are env knobs already; flipping blind risks `material`/`pattern` accuracy (the make-or-break metric). Correctly gated behind a labeled-corpus decision, not neglected. | Owner: the bench-scan labeled corpus + a go decision. |
| **Real provider RTT / RN render+upload / pool sizing / JWKS latency** | Every parse p95 uses a 75ms injected floor, not the real ~2s; the ~30s client aha is client-inclusive but only the server side is measured. | Owner: real keys + a real device under load (perf-profile §blocked). |
| **Outfit / wear history read** | `wear-log.repo` is append-only (no `listByUser`); a read crosses `db`+`functions`+`shared` barrels and adds an endpoint — not pure UI, needs its own spec. | Its own decomposed spec (Rule 1). |
| **F4 dedupe-by-pick UI** | Server merge + `useResolveDedupe` + `dedupeCompare` are done, but the value is mostly realized *after* the (blocked) full parse produces near-duplicates. | Deferred behind F3, not blocked. |
| **Free-text search** | Only exact `color`/`category` filter exists server-side; needs a new server query. Filters (Wave 1) cover the daily need first. | Deferred. |

## Sequencing notes (single-writer discipline)

- **Serialize the shared-barrel lanes:** Waves 4, 6, 7 all touch API barrels
  (`withAuth`/`serveAuthed` shims, `client.ts`, `hooks.ts`) — run them one at a time, never
  concurrently. Wave 7 depends on Wave 4 (the `x-correlation-id` header).
- **Serialize the sim:** Waves 1, 3, 5, 7 each need the single dev-client for their
  screenshot/stopwatch oracle — only one boots at a time (iOS first; ask before booting).
- **Colour is its own clean lane:** Waves 8→9 are pure `packages/shared` with generated
  property-test oracles, no sim, no API barrel — a good parallel track to the mobile-UI
  waves, but 9 depends on 8.
- **Wave 2 (parse parallelize)** is independent of everything and needs no sim — a good
  first parallel pick alongside Wave 1, subject to the provider-spend sign-off note.
</content>
</invoke>
