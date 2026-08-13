# Simulator screenshots — 2026-08-13

Real iPhone 16 simulator captures verifying the nav restructure + outfit-card cleanup
(commits `2412199` feat, `c0f2f2c` dep-fix). Taken via dev-client + harness Metro
(fixtures backend, entitled test user), after fixing the SDK-version skew that had been
bricking the app on device (dyld symbol mismatch — see `c0f2f2c`).

| File | Screen | Verifies |
|------|--------|----------|
| `01-closet-4tab-fab.png` | Closet | **4-tab bar + center Add FAB** (Closet · Today · ⊕ · Outfits · You) — down from 7 tabs; FAB clears the home indicator; "SET ASIDE" filter label (was "Unavailable") |
| `02-outfits-clean-rows.png` | Outfits | **Clean editorial list rows** — name + count + chevron, no per-card action bar (the "two bars" are gone) |
| `03-outfit-detail.png` | Outfit detail | **New tap-through OutfitDetailScreen** — Rename + Remove (with "your garments stay in your closet" copy) live here, off the list |
| `04-you-membership.png` | You (Account) | Tab **relabelled "You"**; Membership section. The "Upgrade to Premium" row is correctly ABSENT here because the harness user is entitled (gate: `isSuccess && !entitlement_active`) |
| `05-add-back-privacy-copy.png` | Add (via FAB) | **FAB → Add surface + "‹ BACK" affordance** (the tabless surface isn't a dead end). Copy fixes live: title "What are we adding?"; privacy line is the honest APPROVAL_ONLY_PROMISE ("Nothing is uploaded until you approve it…"), NOT the blocked on-device "screening" claim |
| `06-you-version-complete.png` | You (settings, scrolled) | **Full settings stack**: Sign out · Membership · Your colours · Your data (Export) · Delete account · **"Version 0.1.0" footer** (new). Legal correctly hidden (no URLs in harness) |
| `07-today.png` | Today | Hero + "camel outerwear / with black", "Why this?", "Wore this today" (now logs the whole look, not just the hero) |
| `08-signin.png` | Sign in | **Previously never visually verified.** Serif hero, honest privacy line ("Nothing leaves your phone until you choose the pieces to add"), Apple-first buttons, footer references "You" (was "Profile") |

| `09-swatches-muted.png` | You (Your colours) | Swatch grid **softened** from vivid crayon (0.65 sat) to muted editorial tones (0.42) — fixes the rainbow tonal break; hues preserved so the palette scorer's round-trip still holds |
| `10-dedupe-banner.png` | Closet | **F4 dedupe-by-pick**: "REVIEW 1 POSSIBLE DUPLICATE" prompt (on-device findDuplicatePairs found a near-dup) — captured with a temporarily-seeded Hamming-3 fixture pair, reverted after |
| `11-dedupe-review-sheet.png` | Dedupe review sheet | Both garments side by side, "Keep this one" per side (→ keep-one merge, wear history re-points), quiet "Keep both" (client-side, non-destructive) |

## Resolved since first draft
- Rainbow swatch grid → **fixed** (screenshot 09).
- "Save my colours 3rd pink" → **false positive** (it's the crimson at disabled opacity 0.5, not a new token).

## Known follow-ups (not launch blockers)
- Today reads sparse in-harness (unsigned cutouts show a hanger glyph; real cutouts fill the hero).
- Item-detail view / duplicate-outfit / color-facet: competitor-parity SUGGESTIONS, not MVP scope (F4 is satisfied by grid+filters+dedupe); roadmap, not gaps.

The grey gear (top-right) is the Expo dev-client Tools button, not part of the app.

## Known follow-up (observed, not yet fixed)
- The "Your colours" swatch grid (screenshot 04) uses fully-saturated crayon colours
  that break the muted editorial palette — flagged by critic-screens. A curated,
  desaturated swatch set is a follow-up design task.
