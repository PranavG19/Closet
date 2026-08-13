# Screenshot-quality + accessibility evaluation — 2026-08-13

Every screen was captured on a **real iPhone 16 simulator** (dev-client + harness backend,
entitled test user) and is in this folder. Three background audit agents (`a11y-deep`,
`a11y-deep2`, `screen-a11y-eval`) died mid-response on connection errors, so this evaluation
was done directly: each PNG viewed, the code behind each screen read. Findings are ranked
most-impactful first, tagged FIXED / FALSE-POSITIVE / FOLLOW-UP / HUMAN.

## Verdict

The app reads **premium and composed**, not plain or broken. The type hierarchy is confident
(serif display mastheads + small-caps eyebrows), the one-accent-per-screen discipline holds
(crimson used once per surface), whitespace is generous, and the copy is distinctly on-brand.
The 7→4-tab restructure removed the clipping/overflow; the center Add FAB clears the home
indicator. No visual bug survives that would read as "unfinished" to a user in a real build.

## Screenshot-quality findings

| # | Screen | Finding | Status |
|---|--------|---------|--------|
| 1 | Closet (01) | 7-tab bar clipped "Account" off the right edge | **FIXED** — 4 tabs + center Add FAB |
| 2 | Outfits (02/03) | every card carried a permanent two-link action bar ("two bars") | **FIXED** — clean tappable rows; management moved to a tap-through detail screen |
| 3 | You / colours (04→09) | swatch grid was vivid primary/secondary crayon, the sharpest tonal break vs. the warm palette | **FIXED** — softened to 0.42 saturation, hues preserved (scorer round-trip still passes) |
| 4 | You (04) | "Save my colours" looked like a 3rd pink | **FALSE POSITIVE** — it's the crimson accent at disabled opacity 0.5 (no complete palette selected), not a new token |
| 5 | all | top-right blue/grey gear overlapping the header | **NOT A DEFECT** — the Expo dev-client Tools button (harness chrome); absent in a production build |
| 6 | Today (08) | hero reads sparse — a hanger glyph, not a garment | **HARNESS ONLY** — cutouts don't sign in-harness; a real signed cutout fills the hero. Not a code defect |
| 7 | Add (05) | title was "Add clothing"; body leaked the dev word "This build" | **FIXED** — "What are we adding?" + "We can't open your photo library right now" |
| 8 | SignIn (08) | privacy line claimed on-device "screening" (a BLOCKED store claim) | **FIXED** — states only the approval-tap truth; footer "You" (was stale "Profile") |

## Accessibility findings

Baseline that was already correct (verified in code, not re-flagged): NavShell tabs carry
`accessibilityRole="tab"` + selected state + filled/outline icon (meaning never by hue alone);
Laundry rows are `checkbox` + checked; StateView Loading/Empty/Error have live regions
(`progressbar`/`polite`/`assertive`); the palette swatches are `checkbox` + checked + labelled;
the delete-account field is labelled; all buttons ≥44pt via the Button primitive's `minHeight`.

| # | Where | Finding | Status |
|---|-------|---------|--------|
| A1 | NavShell Add FAB | was `role="button"` carrying tab `selected` state inside a `tablist` — mixed semantics; its glyph wasn't marked decorative | **FIXED** — dropped the `selected` state, `accessible={false}` on the glyph; VoiceOver reads "Add clothing, button" |
| A2 | new back affordances (NavShell, OutfitDetail) | back chevrons sit inside labelled `Pressable`s (role=button, label "Back"/"Outfits") — RN aggregates the icon into the labelled parent | **OK** — correct by the codebase convention; no change |
| A3 | new OutfitCard row | whole row is one labelled button ("Weekend brunch, 2 pieces. Open to rename or delete.") | **OK** — one focus stop, descriptive |
| A4 | new DedupeReviewSheet | each cutout well has an a11y label; both "Keep this one" buttons are labelled; keep-both is a labelled link; scrim swallow-Pressable is `accessible={false}` | **OK** |
| A5 | new Restore Purchases | labelled link with a `Checking…` pending label; notice is plain text | **OK** |

No blocker- or high-severity a11y defect remains in the surfaces changed this cycle. A
full-app VoiceOver pass on a real device (rotor navigation, focus order across the FlatLists,
Dynamic Type at the largest sizes) is the one a11y check that genuinely needs a human on a
device — it cannot be proven from code or a static screenshot. **[HUMAN]**

## What's deliberately NOT changed (scope discipline)

Item-detail view, duplicate-outfit, and a color-filter facet were flagged by the product-gap
review as competitor-parity **suggestions**. They are NOT MVP gaps — F4 is satisfied by the
grid + filters + dedupe-by-pick — and CLAUDE.md forbids implementing roadmap. Building them
would be scope creep, not gap-closing. (The color-facet suggestion is also technically wrong as
proposed: deriving facets from the loaded page is incorrect under keyset pagination.)
