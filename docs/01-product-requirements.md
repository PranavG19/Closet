# 01 — Product Requirements (PRD)

*What we build **now**. Vision & "why" in [`00-north-star-vision.md`](./00-north-star-vision.md); everything out of scope in [`roadmap.md`](./roadmap.md); how it's built in [`02-engineering-requirements.md`](./02-engineering-requirements.md).*

---

## MVP scope in one sentence

Scan a camera roll → privately digitize a real closet → reveal a teaser → hard paywall → full parse → a wardrobe that answers "what do I wear today" every morning and logs what she actually wore.

## MVP feature list

| # | Feature | Kind | Complexity |
|---|---------|------|-----------|
| F1 | Onboarding scan flow (on-device gate → teaser parse → reveal) | Core | Medium |
| F2 | Hard paywall (RevenueCat) | Core · **human-gated** | Medium |
| F3 | Post-payment full camera-roll parse | Core | Medium |
| F4 | Wardrobe library (browse/filter) + dedupe-by-pick | Core | Small–Medium |
| F5 | Weather-aware outfit suggestions (heuristic v1) | Core | Medium |
| F6 | Manual outfit builder | Core | Small |
| F7 | Availability tracking (clean / dirty / unavailable) | Core | Small |
| F8 | Daily wear log | Core · retention loop | Small |
| F9 | Garment-to-garment color harmony (rules) | Core | Small |
| B1 | Skin-tone / seasonal palette — self-identified swatch quiz | **Beta** | Small |

Deferred features and rationale: [`roadmap.md`](./roadmap.md). Do not build them.

---

## Feature specs

### F1 — Onboarding scan flow

The conversion engine. Sequence:

1. **Welcome + value promise** — one screen, premium tone, sets the "digitize your closet" expectation.
2. **Photo access** — request permission (or "import specific photos" path for the cautious user). Explain the privacy promise plainly: *photos are checked on your device first; only clothing photos you approve are ever uploaded.*
3. **On-device gate** — filter the camera roll locally: keep likely full-outfit / garment photos of the user; drop intimate images, screenshots, non-person photos, and (best-effort) photos that aren't her. **Nothing is uploaded during this step.**
4. **Teaser processing** — a processing animation. In the background, upload and parse **only a small handful** (target: enough for one convincing preview, e.g. ~5–10 items) via the cloud parse pipeline.
5. **The reveal** — show her digitized items as clean cutouts in a wardrobe-preview. This is the aha.
6. **Paywall** (F2) immediately follows the reveal.

**Acceptance (GWT):**
- *Given* a camera roll with intimate photos, *when* the on-device gate runs, *then* those photos are neither displayed as candidates nor uploaded. (Privacy invariant — verified independently, not self-reported.)
- *Given* photo permission granted, *when* teaser processing completes, *then* at least one convincing cutout preview is shown within a target time budget (see perf envelope in eng reqs).
- *Given* the user declines full photo access, *when* she chooses manual import, *then* she can select specific photos and still reach a reveal.

### F2 — Hard paywall  ·  ⚠️ HUMAN-GATED

- Presented immediately after the reveal. **No free trial.** Premium positioning.
- Subscription via **RevenueCat**; entitlement checked before unlocking the full wardrobe + daily features.
- **Escalation:** the money/entitlement path is built and verified by agents but **parked for human review before ship** (agent-arch Rule 6). RevenueCat webhook → entitlement is the critical path; it is human-gated end to end.

**Acceptance (GWT):**
- *Given* a user without an active entitlement, *when* she tries to access the full wardrobe, *then* she sees the paywall and cannot proceed.
- *Given* a completed purchase, *when* the entitlement is confirmed (via the webhook, verified against a real event — not a mocked "success"), *then* the full parse (F3) begins.

### F3 — Post-payment full parse

- After entitlement is confirmed, parse the remaining approved photos from the camera roll.
- Runs during a full-onboarding screen with visible progress; the wardrobe fills in as items complete.
- Resumable and idempotent — a re-run must not create duplicate items (dedupe feeds F4).

**Acceptance (GWT):**
- *Given* a confirmed entitlement, *when* the full parse runs, *then* remaining approved photos are parsed into wardrobe items with cutouts + attributes.
- *Given* the parse is interrupted and restarted, *when* it resumes, *then* no duplicate items are created for already-parsed photos.

### F4 — Wardrobe library + dedupe-by-pick

- Browse the digitized closet; filter by category / color / availability.
- Each item = a normalized front-view cutout + attributes (category, color, pattern) + availability state.
- **Dedupe-by-pick:** when the pipeline flags two photos as likely the same garment, present both side by side. She either **keeps one** (they're the same item) or **keeps both** (they're genuinely different — e.g. two similar black tops). Simple, one tap.

**Acceptance (GWT):**
- *Given* two candidate items flagged as likely-duplicate, *when* shown the pick UI, *then* choosing "keep one" removes the other and "keep both" retains two distinct items.
- *Given* a wardrobe of items, *when* she filters by availability = clean, *then* only clean items show.

### F5 — Weather-aware outfit suggestions (heuristic v1)

- Suggest outfits for today from items that are **currently available (clean)**.
- **Weather-aware:** pull local weather; bias suggestions toward appropriate warmth/layers (heuristic rules, not ML, in v1).
- Respects color harmony (F9). Explicitly **v1 = heuristic**, not a learned recommender — the wear log will feed a smarter version later (roadmap).

**Acceptance (GWT):**
- *Given* cold weather today, *when* suggestions generate, *then* they favor layers/warmth-appropriate items and never suggest a dirty/unavailable item.
- *Given* insufficient clean items to form an outfit, *when* suggestions generate, *then* she gets a clear, non-empty fallback (e.g. "mark something clean" prompt) rather than a broken/empty screen.

### F6 — Manual outfit builder

- Compose an outfit by selecting items (slots by category); save it; name it optionally.
- Saved outfits are first-class objects (reused by suggestions and, later, by roadmap features — keep them self-contained).

**Acceptance (GWT):**
- *Given* selected items, *when* she saves an outfit, *then* it persists and appears in her saved outfits.

### F7 — Availability tracking

- Three states per item: **clean (available)** / **dirty** / **unavailable** (e.g. at the cleaners, packed, lent).
- Intuitive marking (e.g. mark dirty when worn — ties to F8; a simple toggle/swipe).
- Suggestions (F5) only ever draw from clean/available items.

**Acceptance (GWT):**
- *Given* an item marked dirty, *when* suggestions generate, *then* that item is excluded until marked clean again.

### F8 — Daily wear log  ·  retention loop / data moat

- One-tap "I wore this today" on an item or a saved outfit.
- Optionally moves worn items toward "dirty" (F7) — the natural laundry loop.
- Each wear is a timestamped row. **This dataset is the moat and must not be cut.** It powers future analytics/suggestions and is impossible to backfill.

**Acceptance (GWT):**
- *Given* she logs wearing an outfit, *when* the log is recorded, *then* a per-item wear row exists with a timestamp, and (if enabled) those items move to dirty.

### F9 — Color harmony (rules)

- Garment-to-garment color-pairing rules (complementary / analogous / neutral-safe), used to score and filter suggestions and to give gentle feedback in the manual builder.
- Rules-based and deterministic. Distinct from B1 (which is about *her* palette).

**Acceptance (GWT):**
- *Given* two items, *when* harmony is evaluated, *then* the rule verdict is deterministic and matches the documented rule table.

### B1 — Skin-tone / seasonal palette (BETA, self-identified)

- A short **swatch quiz**: she picks from swatches (undertone, contrast, favorite/flattering colors) — **self-identified, never camera-detected.**
- Produces an advisory palette of flattering hues, surfaced gently in suggestions. **Advisory, never prescriptive** — never blocks or nags; she wears whatever she wants.
- Labeled **beta** in-product. This is the one MVP-adjacent feature where the "day-sized" assumption is softest; it ships as a simple quiz precisely to keep it day-sized (the hard version is deferred — see roadmap #9).

**Acceptance (GWT):**
- *Given* she completes the quiz, *when* suggestions render, *then* palette-aligned items are gently highlighted, and *no* item is ever hidden or blocked for being "off-palette."
- *Given* she skips the quiz, *when* she uses the app, *then* everything works with no palette bias and no nagging.

---

## Cross-cutting product rules

- **Premium tone throughout.** No dark patterns, no nag screens, no free-trial bait. The paywall is honest: the value is already shown.
- **Advisory, never prescriptive.** Color and palette guidance suggests; it never forbids. She's in control.
- **Privacy is a visible feature, not fine print.** The on-device gate is explained plainly at the moment it matters.
- **Graceful empty/degraded states** everywhere — a wardrobe mid-parse, an all-dirty closet, a skipped quiz, no weather signal — each has a defined, non-broken state (agent-arch: degraded paths are specified, not hoped for).

## Out of scope (do not build) — pointer

Virtual try-on, gap-fill shopping/affiliate, analytics screens, social/poll, event planning, resale, fit ledger, travel/packing, camera-based skin tone, inspiration boards, calendar, stylist marketplace. Full list + why + the MVP seams that keep them cheap: [`roadmap.md`](./roadmap.md).
