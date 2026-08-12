# Simulator screenshots — 2026-08-12

Real iPhone 16 simulator captures of the shipped Atelier redesign, taken via the
dev-client + harness Metro loop (fixtures backend, entitled test user). Every one of
the 7 tabs verified rendering correctly.

| File | Screen | Notes |
|------|--------|-------|
| `closet.png` | Closet (Wardrobe) | serif masthead, filter chips, garment grid (cutouts don't sign in-harness → hanger glyph) |
| `add.png` | Add clothing | privacy promise in serif italic ("nothing uploaded until you approve"), one filled "Choose photos" CTA |
| `today.png` | Today (Suggestions) | Hero + "camel outerwear / with black", "Why this?" disclosure, "Wore this today" link |
| `outfits.png` | Outfits | "Weekend brunch / 2 pieces", "Office Monday / no pieces yet", rename/remove |
| `laundry.png` | Laundry | checkbox rows, "Mark clean" / "Select all" |
| `plan-member.png` | Plan (Paywall) | entitled state ("You're a member"); pre-purchase price/subscribe/restore state needs a non-entitled fixture to view |
| `account-top.png` | Account ("You") — top | **NEW**: Membership section (Premium status + Manage subscription link) |
| `account-bottom.png` | Account ("You") — bottom | Your data (export) + Delete my account (type-to-confirm). **Legal section correctly hidden** — no legal URLs configured in harness (the one human-required launch step). |

The floating blue/grey gear (top-right in several shots) is the Expo dev-client tools
button, not part of the app.
