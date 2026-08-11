# Feature audit — promised vs built (2026-08-11)

Read against `docs/00-01-03`, the feature source under `packages/mobile/features/*`, the API
layer (`src/api/*`), server handlers (`packages/functions/src/*`), repos
(`packages/db/src/repos/*`), and `docs/RUN-LOG.md`. State is verified against code, not the
stale `LAUNCH-READINESS.md` (which e.g. wrongly called the paywall a dead stub — RUN-LOG wave 4
corrected that; confirmed here).

## Method note
"Built" = the daily-loop behaviour is reachable by a user and wired end to end. "Server capability
exists" is called out separately because much of this app's value is server-complete but has no UI
consuming it — that gap is exactly the agent-completable backlog.

---

## Feature matrix

| # | Feature | State | Why / evidence | Completability |
|---|---------|-------|----------------|----------------|
| F1 | Onboarding scan → gate → teaser → reveal | **Partial** | `AddGarmentScreen` is render+handlers only, wired as the "Add" tab; the on-device gate/upload chokepoint types + staging exist. But `PhotoIntakePort` reports `available:false` (no picker dep), `screeningAvailable:false` (no classifier), and there is NO scan→reveal→paywall *orchestration* — Add is a single-photo flow, not the onboarding conversion sequence. | **Owner/dep-blocked**: needs `expo-image-picker`/`expo-image-manipulator`/ML runtime + a classifier clearing a recall floor before the privacy claim is legal. |
| F2 | Hard paywall (RevenueCat) | **Built UI / owner-blocked runtime** | `PaywallScreen` is fully built: 3.1.2-compliant price via `subscriptionDisclosure`, real `usePurchase/useRestore/useOffer`, server-truth entitlement re-read, honest no-offer state. `makeBillingPort()` returns no offer until keys exist. | **Owner-blocked**: RevenueCat API keys + App Store product IDs; oracle must be a REAL webhook event (mock = mirror oracle, forbidden). |
| F3 | Post-payment full parse | **Partial / blocked** | `parse-photo` supports `teaser` and entitlement-gated `full` (402 without entitlement); rate-limit + teaser-cap exist. No orchestrated full-parse-progress screen; depends on F1+F2. | **Owner-blocked** (chained behind F1/F2). |
| F4 | Wardrobe library + filter + dedupe-by-pick | **Partial** | Grid **built** — cutouts render via signed URLs, windowed FlatList, memoized tiles (RUN-LOG wave 3, screenshot-verified). Server + `useWardrobe(params)` fully support `category`/`color`/`availability` filters, but `WardrobeScreen` calls `useWardrobe()` with **no filter UI**. Dedupe: `resolveDedupe` server (SECURITY DEFINER merge, RLS-scoped, integration-tested) + `useResolveDedupe` hook exist, but **no pick UI** and nothing surfaces duplicate candidate pairs. | **Agent-completable** (filters: high; dedupe UI: medium — see backlog). |
| F5 | Weather-aware suggestions | **Partial** | Heuristic **built + wired**: `suggestItems` + `harmony` + palette tie-break + "Why this?" rationale, all screenshot-verified (waves 4/6). BUT weather is a fixed `ASSUMED_TEMP_C = 18` — no `WeatherPort` implementation, no server seam (docs/06 §9 records the deliberate absence). | Suggestion core **built**; real weather is **owner/dep-blocked** (needs a weather provider seam + key). |
| F6 | Manual outfit builder | **Partial** | `outfits-create` server + `outfit_items` composite FK (integration-tested), `useCreateOutfit` hook, and the pure `draft.ts` slot model (place/remove/rename/isComplete/toItems, unit-tested) are ALL built. `OutfitsScreen` only **lists**; "Build an outfit" is `onAction={() => {}}`. `draft.ts` has **zero consumers** — the canvas screen is the only missing piece. | **Agent-completable, screenshot-verifiable** — top backlog item. |
| F7 | Availability tracking (clean/dirty/unavailable) | **Partial** | Enum has all 3 states; `setAvailability` repo + `wardrobe-availability` endpoint + `useToggleAvailability` exist. Laundry marks **dirty→clean** (batch). But there is **no UI to mark an item dirty or unavailable** from the closet, and `unavailable` items have no surface at all (Laundry queries only `availability:'dirty'`). | **Agent-completable** (mark dirty/unavailable from wardrobe). |
| F8 | Daily wear log (retention moat) | **Partial** | "I wore this" on Suggestions hero → `logWear` (idempotent, client-minted id). BUT it logs only the **hero item**, not the whole suggested outfit; the server `?flip=dirty` channel exists but `useLogWear`/client never send it (no laundry loop from wearing); no wear-history read at all (`wear-log.repo` is append-only, no `listByUser`). | Log-whole-outfit + flip = **agent-completable**; wear history = needs a new read endpoint (larger). |
| F9 | Color harmony (rules) | **Built** | `harmony()` deterministic rules, consumed by `suggestionNote`/`outfitVerdict`, wired into Suggestions. Never scolds a clash (verified by forbidden-vocab oracle, wave 4). | Done. |
| B1 | Self-identified swatch quiz | **Built end-to-end** | `SwatchQuizCard` in Account (`extraSection`), `palette-upsert` + `palette-read` seam, feeds `suggestItems` tie-break + rationale. Screenshot-verified (waves 5/6). Self-identified, advisory, never camera-detected. | Done. |

**Cross-cutting built:** account delete/export (Apple 5.1.1(v) + GDPR), auth/session gate, nav
shell (flat 7-tab, no push navigation yet), design tokens, FlatList perf on all 3 list screens.

---

## Ranked agent-completable backlog (value to daily loop × low effort)

Ranking favours items where the **server capability already exists** and the only gap is
UI-over-existing-capability that a dev-client screenshot can verify (the unblocked oracle per
RUN-LOG wave 3). Each names files touched and single-writer/barrel collision risk.

### 1. F4 wardrobe filters — HIGH value, LOW effort ★ do first
Server + `useWardrobe(params)` already accept `category`/`color`/`availability`; only a filter-chip
row on the grid is missing. Highest daily-loop value (browsing a real closet) for the least work.
- **Files:** `packages/mobile/features/wardrobe/WardrobeScreen.tsx` only (add filter state + chip row; category enum is the 6 values in `shared/schemas/common.ts`).
- **Collision:** none. Self-contained in one feature file; no shared barrel, no API-layer change. Category chip labels can reuse existing `Text`/tokens.
- **Oracle:** screenshot — filter to `dirty`/`top` and confirm the grid narrows.

### 2. F6 outfit builder canvas — HIGH value, LOW–MEDIUM effort
The entire write path (server + `useCreateOutfit` + pure tested `draft.ts`) is built with **zero UI
consumers**. A slot-canvas screen that reads the closet, uses `place/remove/isComplete/toItems`, and
calls `useCreateOutfit` finishes F6.
- **Files:** new `features/outfits/OutfitBuilderScreen.tsx`; edit `features/outfits/OutfitsScreen.tsx` (wire "Build an outfit" `onAction`) and `features/outfits/index.ts` (barrel, but outfits-owned).
- **Collision:** low IF built as in-screen modal/state within the outfits feature. Risk rises if it needs a nav route — flat `tabs.ts` has no push navigation, and `tabs.ts`/`NavShell.tsx` are the **navigation barrel** (single-writer). Recommend in-feature state to avoid touching nav.
- **Oracle:** screenshot — place a top+bottom, confirm Save enables (`isComplete`), saved look appears in the list.

### 3. F8 log the whole outfit + flip-to-dirty — HIGH value (moat), MEDIUM effort
Today only the hero item is logged and wearing never dirties anything, so the natural laundry loop
(F7↔F8) is broken. Log all `selectedRows`, and thread `?flip=dirty` so a worn item moves to dirty.
- **Files:** `features/suggestions/SuggestionsScreen.tsx`; `src/api/client.ts` (add flip to `logWear`); `src/api/hooks.ts` (`useLogWear`).
- **Collision:** **single-writer risk** — `client.ts` and `hooks.ts` are the shared API barrels every screen depends on. Coordinate; don't run this concurrently with any other API-layer lane.
- **Oracle:** screenshot + it invalidates wardrobe cache; the worn item should appear in Laundry after.

### 4. F7 mark dirty / unavailable from the closet — MEDIUM value, LOW–MEDIUM effort
`useToggleAvailability` supports all 3 states; only clean-from-Laundry is wired. Add a per-item
availability control (long-press or a detail sheet) so a user can set dirty/unavailable directly, and
give `unavailable` items a surface (currently invisible everywhere).
- **Files:** `features/wardrobe/WardrobeScreen.tsx` (+ optional new `ItemDetail` sheet in the wardrobe feature).
- **Collision:** none if kept in the wardrobe feature; reuses existing `useToggleAvailability` (no API-barrel change).
- **Oracle:** screenshot — mark an item unavailable, confirm chip + exclusion from suggestions.

### 5. F4 dedupe-by-pick UI — MEDIUM value, MEDIUM–HIGH effort
Server merge + hook are done and the list returns `phash`, so candidate pairs can be computed
client-side via `dedupeCompare`. But it needs a side-by-side cutout pick screen, and its value is
mostly realized only **after** the (blocked) full parse produces near-duplicates.
- **Files:** new `features/wardrobe/DedupeScreen.tsx` (or in-grid banner); uses `useResolveDedupe` + `dedupeCompare` from shared. `shared/src/index.ts` already exports `dedupeCompare` (no barrel edit).
- **Collision:** low (reuses existing hook + shared export). Effort is the pairing UX, not plumbing.
- **Oracle:** screenshot — two flagged items, "keep one" removes the discard; "keep both" is a client no-op.

### Not ranked / deferred (not "UI over existing capability")
- **Richer suggestion reasons** — largely **already built** (`suggestionRationale`, wave 4). Incremental value now low; the honesty-vocab oracle constrains changes. Skip unless a specific new reason is requested.
- **Outfit history / wear-plan** — moat data exists but `wear-log.repo` is **append-only (no read)**. Needs a new repo read + handler + route + shared schema → crosses `db`/`functions`/`shared` barrels and adds an endpoint. Not pure UI; larger, coordinate as its own spec.
- **Search** — only exact `color`/`category` filter exists server-side; free-text search needs a new server query. Filters (item 1) cover most of the daily need first; defer text search.
- **Real weather (F5)** — needs a `WeatherPort` implementation + provider key → **owner/dep-blocked**, not agent-completable UI.

## Invariants the backlog respects
All ranked items are UI over existing repo-backed endpoints (no new `supabase.from()`), use
`useTokens()` (no color literals), don't touch the on-device privacy gate, and keep palette/color
guidance advisory. None weakens RLS or the money path.
