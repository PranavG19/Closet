# 03 — Design System (look & feel)

*The feel of the product — the **intent** coding tasks build against. This is not a description of the current app; for that read [`07-ui-state.md`](./07-ui-state.md), which is derived from real screenshots and lists where the shipped tokens fall short of this doc.*

*Colors in code come from `useTokens()` only — never raw hex. **This is a convention, not a gate.** The doc previously said "CI-gated per 02 §8"; there is no such gate — not in `scripts/verify.mjs`, not in `scripts/gates/`, not in `eslint.config.mjs` (which names it as a future rule in a comment). The behaviour is in fact clean (`git grep -nE '#[0-9a-fA-F]{3,8}' -- packages/mobile/features packages/mobile/src/ui` → 0 hits) — by discipline. There is also **no CI at all** (`ls .github/` → `CODEOWNERS` only), so no doc should claim a CI gate for anything.*

---

## Design principles

1. **The clothes are the content.** The UI recedes; garments (clean cutouts on calm backgrounds) are the hero. Chrome is quiet.
2. **Premium calm.** Generous whitespace, soft edges, restrained motion. It should feel like a well-lit boutique, not a busy feed. This is a paid product and must feel like one from the first screen.
3. **Advisory, never bossy.** Guidance (palette, harmony) is gentle highlight and suggestion — never a red error, never a block, never a nag.
4. **Light, feminine, minimal.** Light theme; pink/red/blue accents used sparingly as highlights, not fills. Clean typography.
5. **Every state is designed.** Empty, loading, mid-parse, all-dirty, offline, declined-permission — each has a calm, intentional treatment, not a spinner-or-crash.

---

## Color

Light theme. A mostly-neutral canvas with **pink / red / blue accents used as highlights**, not backgrounds. Semantic tokens (exact values finalized with mockups; ranges below give intent):

| Token | Role | Intent |
|-------|------|--------|
| `bg.canvas` | App background | near-white, warm |
| `bg.surface` | Cards, sheets | white / faintest tint |
| `bg.sunken` | Wells, cutout backdrops | soft neutral so cutouts pop |
| `text.primary` | Headings, item names | near-black, high contrast |
| `text.secondary` | Supporting copy | warm gray |
| `text.tertiary` | Hints, metadata | lighter gray |
| `accent.pink` | Primary accent / brand highlight | the signature warm highlight |
| `accent.red` | Emphasis / occasional CTA | used rarely, deliberate |
| `accent.blue` | Cool highlight / secondary | balances the warm accents |
| `border.hairline` | Dividers, card edges | barely-there |
| `state.clean` | Available (clean) | calm positive |
| `state.dirty` | Dirty | muted, non-alarming (laundry is normal, not an error) |
| `state.unavailable` | Unavailable | neutral/dimmed |

**Accent discipline:** one accent leads per screen; the others are used for small highlights. Accents never become large fills — they punctuate.

**Never** encode meaning in hue alone (accessibility); pair color with label/icon/position. Availability states carry an icon + label, not just a color.

---

## Typography

- **Clean, minimal typeface** — a modern humanist/geometric sans; one family, a small weight range (e.g. regular / medium / semibold). **`typography.family` is now REQUIRED (not `string | undefined`) and set to `'System'`** — SF Pro on iOS, Roboto on Android, both modern humanist sans faces. That is a stated decision, not a placeholder: no bundled font file, no licensing question, correct Dynamic Type behaviour. A custom face remains an owner call and is a one-line change in `tokens.ts`. The type makes "no typeface at all" unrepresentable, which is what previously shipped.
- Clear hierarchy: display (reveal moment, big and confident) → title → body → caption. Generous line-height; nothing cramped. *(Implemented: display 32/40, title 22/28, body 16/24, caption 13/18.)*
- Numbers (counts, later cost-per-wear) tabular-aligned. **Not implemented** — no `fontVariant` anywhere.

---

## Spacing & layout

- One spacing scale (4px base: 4/8/12/16/24/32/48). Whitespace is a feature — err generous.
- Rounded corners on cards/sheets (soft, consistent radius). Soft shadows/elevation, never harsh.
- The wardrobe grid is the signature surface: even, breathable, cutouts centered on `bg.sunken` so garments feel lifted off the page.

---

## Components (MVP inventory)

- **Item card** — cutout on sunken backdrop, name, availability chip.
- **Wardrobe grid** — filterable (category / color / availability).
- **Outfit card / builder canvas** — item slots by category.
- **Suggestion card** — today's outfit(s), weather context, gentle palette/harmony highlight.
- **Availability chip / toggle** — clean·dirty·unavailable, icon + label + color.
- **Wear-log affordance** — one-tap "I wore this" (prominent but not loud).
- **Dedupe pick sheet** — two candidates side by side; "keep one" / "keep both."
- **Onboarding / processing** — the animation and the **reveal** (the emotional peak — design it as the hero moment).
- **Paywall** — premium, honest, no dark patterns; value already shown.
- **Swatch quiz (beta)** — swatch picker; clearly labeled beta.
- **Empty/degraded states** — one calm illustration + one clear next action per state.

---

## Motion

- Restrained and purposeful. Gentle fades/slides for navigation; a slightly more expressive, satisfying moment for **the reveal** (items settling into the wardrobe) — this is the aha and earns a beat.
- Respect reduced-motion settings. No motion that blocks interaction.

---

## Tone of voice

- Warm, confident, concise. Like a stylish friend who's genuinely helpful — never preachy, never salesy, never anxious.
- Laundry/availability language is neutral and kind ("in the wash," not "DIRTY"). Guidance suggests ("this pairs beautifully with…"), never commands.
- Privacy copy is plain and reassuring at the moment it matters: *"We check your photos on your device first. Only clothing photos you approve are ever uploaded."*
- The paywall is honest about being premium; it doesn't apologize and it doesn't manipulate.

---

## Accessibility (baseline, non-negotiable) — with the honest current status

The requirements stand. Each carries where the code actually is as of `ab25513`, because this section previously read as if met and most of it is not.

- **WCAG AA contrast for text and meaningful UI.** ❌ **NOT MET — 7 of 10 foreground tokens fail**, including `accent.pink` (the brand accent, 2.91 on `bg.surface`), `text.tertiary` (2.58 on `bg.sunken`), all three `state.*` colours (sub-3.0, so they fail even the relaxed non-text threshold), and `text.onAccent` white-on-pink at **2.91** — the filled `Button`'s own label. Full table + a recompute snippet: [`07-ui-state.md`](./07-ui-state.md) §4.4. **This is a defect in the palette, not in this requirement** — the values in §Color are provisional (see §Open) and now have a numeric target.
- **Meaning never by color alone** (states carry icon + label). ✅ **MET** — `src/ui/AvailabilityChip.tsx` renders a dot **plus** a text label, confirmed in the screenshots ("In the wash", "Ready to wear"). This addresses colour-blindness and does **not** rescue the contrast failure above; separate requirements.
- **Hit targets ≥ 44pt.** ⚠️ **PARTIAL** — `minHeight: 44` in `src/ui/Button.tsx`, `features/navigation/NavShell.tsx`, `features/auth/AccountScreen.tsx`. No token encodes it and nothing enforces it, so a new pressable can miss it silently.
- **Screen-reader labels on interactive elements and item cards.** ⚠️ **PARTIAL** — 7 `accessibilityLabel`/`accessibilityRole` sites (`Button`, `NavShell` tablist + tabs, `AvailabilityChip`, the item wells in `WardrobeScreen`/`SuggestionsScreen`, the delete-confirmation field). Real coverage, not complete: the item wells announce the **category**, not the required "item name + availability."
- **Dynamic type / scalable text.** ❌ **NOT MET, structurally absent.** The typography scale uses fixed `fontSize`/`lineHeight` numbers; no `allowFontScaling`, no `PixelRatio.getFontScale()`, no `useWindowDimensions` anywhere in `packages/mobile`. Honoring it means the scale becomes a function of the system font scale — a real change to the token shape, not a flag.
- **Reduced-motion honored.** ⚠️ **VACUOUSLY TRUE** — no `AccessibilityInfo`/`isReduceMotionEnabled` anywhere, and **no motion exists yet**, so nothing is currently violated. It becomes a live requirement with the reveal animation.
- **Tabular numerals** (§Typography). ❌ **NOT MET** — no `fontVariant` in `tokens.ts` or `src/ui/Text.tsx`.

**CONTRAST IS NOW ENFORCED; the rest is not.** `packages/mobile/src/tokens/contrast.test.ts` implements the WCAG 2.x relative-luminance formula and asserts the published thresholds (4.5:1 normal text, 3.0:1 large text + non-text UI) against **every** foreground token on **every** background, plus white-on-every-accent-fill. It runs in `pnpm verify`. It deliberately does **not** hardcode expected ratios — that would be a mirror oracle agreeing with whatever the tokens happen to be; the oracle is the spec's formula, so changing a hex changes the measurement while the threshold stays put. It iterates the token objects, so a newly added colour cannot be introduced untested. Proven by restoring the pre-fix palette: **11 tests went red**, each naming the exact ratio and the offending background.

The other commitments on this page — hit targets, "never encode meaning in hue alone", motion durations, one-family typography — remain **held by review, not by a gate**, which is why the screenshot audit found violations that a 228-test suite could not see. Contrast was the one that reduced cleanly to arithmetic.

---

## Open (finalize with mockups)

- **Exact hex values** — the revision now has a hard constraint, not only taste: the palette must clear **4.5** for text and **3.0** for meaningful non-text UI. Current numbers + the recompute snippet are in `07-ui-state.md` §4.4.
- **A CUSTOM typeface, if one is ever wanted.** `typography.family` is now required and set to `'System'`, so the "nothing fails when it is `undefined` at ship" hole is closed — the field cannot be absent. What remains is purely a taste + licensing call: whether to bundle a specific face instead of the platform sans.
- Precise radii/shadow, the reveal animation choreography, and the empty-state illustration style — the empty states currently render as text + a button with no illustration (`wardrobe-empty.png`).

This doc defines the *system and intent*; the visual demos slot in against these tokens without changing the structure.
