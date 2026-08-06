# 03 — Design System (look & feel)

*The feel of the product. Visual demos/mockups are added later; this is the token + principle foundation coding tasks build against. Colors in code come from `useTokens()` only — never raw hex (CI-gated per [`02-engineering-requirements.md`](./02-engineering-requirements.md) §8).*

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

- **Clean, minimal typeface** — a modern humanist/geometric sans; one family, a small weight range (e.g. regular / medium / semibold). Exact face chosen with mockups.
- Clear hierarchy: display (reveal moment, big and confident) → title → body → caption. Generous line-height; nothing cramped.
- Numbers (counts, later cost-per-wear) tabular-aligned.

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

## Accessibility (baseline, non-negotiable)

- WCAG AA contrast for text and meaningful UI.
- Meaning never by color alone (states carry icon + label).
- Dynamic type / scalable text; hit targets ≥ 44pt.
- Reduced-motion honored; screen-reader labels on all interactive elements and on item cards (item name + availability announced).

---

## Open (finalize with mockups)

Exact hex values, the chosen typeface, precise radii/shadow, the reveal animation choreography, and the illustration style for empty states. This doc defines the *system and intent*; the visual demos slot in against these tokens without changing the structure.
