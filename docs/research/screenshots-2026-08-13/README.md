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

The grey gear (top-right) is the Expo dev-client Tools button, not part of the app.

## Known follow-up (observed, not yet fixed)
- The "Your colours" swatch grid (screenshot 04) uses fully-saturated crayon colours
  that break the muted editorial palette — flagged by critic-screens. A curated,
  desaturated swatch set is a follow-up design task.
