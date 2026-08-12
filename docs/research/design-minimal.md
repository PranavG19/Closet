# Design spec — crisp precision-minimal

*Direction: Linear / Things 3 / Apple / Vercel. Premium through restraint and precision,
not decoration. Near-monochrome canvas, ONE decisive accent, hairline-forward depth, tight
soft shadow, confident type with clear size jumps. "It looks expensive because nothing is
wrong."*

This is a **drop-in** spec: every value below fits the exact `Tokens` interface shape in
`packages/mobile/src/tokens/tokens.ts` (same keys, same nesting). No structural change, no
new key — **one exception, called out explicitly in §3 (shadow gains no new key; I reuse the
existing `ShadowToken` but note the Card needs a second, tighter shadow that the current
single-token shape cannot express — see §3 and §4-Card for the honest constraint and the
minimal path).**

All contrast ratios below are **computed** (WCAG 2.x relative-luminance, the same formula
`packages/mobile/src/tokens/contrast.test.ts` asserts), not asserted. The `contrast.test.ts`
oracle iterates the token objects against the 4.5 / 3.0 thresholds, so these values drop in
and the gate re-measures them; I ran the formula ahead of it and every pair clears.

---

## 1. Palette

The move: **cool near-monochrome greys** (the current palette is *warm* — `#FBFAF9`,
`#5C5A57`. Warm greys read cozy/editorial; Linear/Vercel-grade minimal reads *cool and
neutral*, which is what makes the one accent land as decisive rather than one warm tone among
many). Backgrounds go very slightly cooler and the canvas/sunken separation widens a touch so
hairlines and wells read as deliberate structure. **Keep pink as the lead accent** — but a
cleaner, more saturated crimson-pink (`#C81E5B`, hue 340°) rather than the muted rose. It is
the one decisive accent; red and blue stay in the token set (contract) but are used almost
never in this direction (red = destructive only, blue = the rare cool highlight).

### `color.bg`
| key | current | **new** | note |
|-----|---------|---------|------|
| `canvas` | `#FBFAF9` | **`#F7F7F8`** | cool near-white, faint blue-grey |
| `surface` | `#FFFFFF` | **`#FFFFFF`** | unchanged — pure white cards |
| `sunken` | `#F3F1EF` | **`#EEEEF1`** | cool neutral well; wider gap from canvas so cutouts lift |

### `color.text`
| key | current | **new** | worst-bg ratio | floor |
|-----|---------|---------|----------------|-------|
| `primary` | `#1A1A1A` | **`#18181B`** | **15.30:1** (on sunken) | 4.5 ✓ |
| `secondary` | `#5C5A57` | **`#5B5B63`** | **5.81:1** | 4.5 ✓ |
| `tertiary` | `#706C68` | **`#67676E`** | **4.85:1** | 4.5 ✓ |
| `onAccent` | `#FFFFFF` | **`#FFFFFF`** | ≥5.22:1 on every accent fill | 4.5 ✓ |

### `color.accent` (text- and fill-legal — AA on every bg AND white-on-fill)
| key | current | **new** | hue | worst-bg (as text) | white-on-fill |
|-----|---------|---------|-----|--------------------|---------------|
| `pink` | `#CF215E` | **`#C81E5B`** | 340° | **4.78:1** | **5.54:1** |
| `red` | `#CB3329` | **`#C5312A`** | 4° | **4.71:1** | **5.46:1** |
| `blue` | `#396FA9` | **`#3B6FA8`** | 211° | **4.51:1** | **5.22:1** |

*All three clear both the 4.5 text floor and the 5.19 white-label target the existing tokens
were tuned to. Pink is the only one used with any frequency; the change is a hair more
saturation and a cooler-cleaner cast, not a re-hue.*

### `color.accentDecorative` (decoration only — dots, rules, strip edges; never carries text)
| key | current | **new** | note |
|-----|---------|---------|------|
| `pink` | `#E8709A` | **`#EC4E7E`** | brighter, cleaner brand pink for the highlight strip edge + loading spinner |
| `red` | `#D8483F` | **`#E0463C`** | |
| `blue` | `#5A8FC7` | **`#5A8FC7`** | unchanged |

### `color.border`
| key | current | **new** | note |
|-----|---------|---------|------|
| `hairline` | `#E7E4E1` | **`#E4E4E7`** | cool hairline, ~1.27:1 on white — a *precise* 1px line, the primary depth cue in this direction |

### `color.state` (dots, always paired with a label — 3.0 non-text floor)
| key | current | **new** | worst-bg | floor |
|-----|---------|---------|----------|-------|
| `clean` | `#589474` | **`#4E8C6A`** | **3.43:1** | 3.0 ✓ |
| `dirty` | `#A6823C` | **`#9C7A34`** | **3.46:1** | 3.0 ✓ |
| `unavailable` | `#8C8781` | **`#84848C`** | **3.20:1** | 3.0 ✓ |

*States nudged cooler to sit in the same neutral family as the greys; all clear 3.0 on the
worst bg (sunken). Meaning still never by hue alone — the chip keeps its label.*

---

## 2. Type scale

**Family: keep `'System'`** (SF Pro on iOS). This is the right call for precision-minimal —
SF Pro *is* the reference face for this genre (it's what Apple's own apps and Things 3 use),
it needs no bundle/licensing, and it renders optical sizes + Dynamic Type correctly. **Do not
add a custom font.** A custom face here would be a downgrade, not an upgrade, and costs a
dev-client rebuild for zero aesthetic gain in this direction.

The move: **widen the size jumps and make weights more confident.** The current scale is
timid — display 32 and title 22 are close, body/caption both `'400'` regular. Precision-minimal
wants a *decisive* hierarchy: a large confident display, a clear drop to title, body at a
comfortable read, a small precise caption. Tighten display line-height (large type over-breathes
at 40).

| variant | current (size/lh/weight) | **new** | rationale |
|---------|--------------------------|---------|-----------|
| `display` | 32 / 40 / 600 | **34 / 40 / 600** | slightly larger, tighter leading ratio (1.18) — confident headline, not airy |
| `title` | 22 / 28 / 600 | **20 / 26 / 600** | drop a touch so display leads decisively; 600 semibold holds |
| `body` | 16 / 24 / 400 | **16 / 23 / 400** | tightened leading (1.44) reads crisper; size unchanged (AA + comfort) |
| `caption` | 13 / 18 / 400 | **13 / 18 / 500** | **500 medium**, not 400 — captions/labels/metadata read as precise UI text, not faded body. This is the single highest-leverage type change: it makes chips, tab labels, and metadata look intentional. |

**Weights** (`weight.regular/medium/semibold` = `400/500/600`): unchanged keys/values. The
scale now actually *uses* medium (caption) and semibold (display/title) so the three-weight
system is visible rather than nominal.

**Tracking:** RN `<Text>` has no per-variant letterSpacing token in the current shape, and
adding one is a token-shape change I'm not proposing. SF Pro's optical tracking at these sizes
is already correct for this look — no manual tracking needed. (If ever wanted, it's a new
`letterSpacing` field on `TypographyScaleEntry` — flagged, not proposed.)

**Tabular numerals** (`fontVariant: ['tabular-nums']`): still not in the token shape. Out of
scope for this visual spec; it's a `Text.tsx` + token-shape change. Noted, not proposed.

---

## 3. Spacing / radius / shadow

### `spacing` — **unchanged.** `4/8/12/16/24/32/48` is already a clean 4px rhythm; precision
comes from *using* it consistently, not from changing the steps. Keep all seven keys as-is.

### `radius` — **crisper corners.** The current `lg: 20` and `pill: 999` are fine, but `lg: 20`
is too round for precision-minimal (it reads soft/friendly, not precise). Tighten:

| key | current | **new** | note |
|-----|---------|---------|------|
| `sm` | 8 | **8** | unchanged — inner elements, image clips |
| `md` | 12 | **10** | the workhorse (cards, buttons, wells) — 10 reads precise, 12 reads soft |
| `lg` | 20 | **14** | large surfaces/sheets — decisively less round |
| `pill` | 999 | **999** | unchanged — chips, dots stay fully round (the one soft note, and it's intentional contrast) |

### `shadow` — **tighter, softer, lower.** The current shadow (radius 12, offset y=4) is a
diffuse drop that reads generic. Precision-minimal wants a *tight, close* shadow that reads as
a crisp lift, paired with the hairline doing most of the separation work.

| field | current | **new** |
|-------|---------|---------|
| `shadowColor` | `#1A1A1A` | **`#18181B`** (match new text.primary) |
| `shadowOpacity` | 0.06 | **0.05** |
| `shadowRadius` | 12 | **8** |
| `shadowOffset` | `{0, 4}` | **`{0, 2}`** |
| `elevation` | 2 | **1** |

**Honest constraint (the one deviation):** the *ideal* precision-minimal card uses a
**two-layer shadow** — a tight 1px ambient shadow + a slightly larger soft one — which the
single `ShadowToken` shape cannot express (RN takes one shadow per View; `boxShadow` string
arrays are RN 0.76+ only). I am **not** proposing a token-shape change. The single tightened
shadow above is the correct minimal call within the existing shape, and with the hairline
carrying the edge definition it reads clean. If a two-layer shadow is ever wanted, that's a
`ShadowToken → readonly ShadowLayer[]` shape change — flagged here, not proposed.

---

## 4. Per-primitive treatment

**`Text.tsx`** — no code change needed. It already reads `typography[variant]` and
`text[tone]`; the new scale values (§2) flow through. The caption weight bump to `500` lands
automatically.

**`Card.tsx`** — no structural change; the new `radius.md: 10`, tightened `shadow`, and cool
`border.hairline` flow through the existing `base`/`elevation` composition. The result: a card
that is a **precise hairline rectangle with a barely-there tight lift**, not a soft floating
panel. The `sunken` variant (no shadow, hairline + cool `#EEEEF1`) becomes the crisp well.
*Recommendation, no code:* this is exactly right for the direction — leave the composition,
let the tokens do it.

**`Button.tsx`** — no structural change. `radius.md: 10` makes the filled pink CTA read
precise. The three intents stay: `accent` (filled pink, the one primary action per screen),
`secondary` (hairline outline on white — now a crisp 1px cool line), `ghost` (text-only, used
for "Why this?"). In this direction the **secondary/ghost buttons carry most of the UI** and
the filled pink is reserved hard — which the existing "accents punctuate" comment already
encodes. Label uses `body` weight; consider (optional, one-line at call sites, not a primitive
change) that primary CTAs read well with the label at `body` as-is — no change needed.

**`AvailabilityChip.tsx`** — no structural change. The chip sits on `bg.sunken` with a
`pill` radius and now a `caption`/**500-medium** label — reads as a precise status pill rather
than faded text. The state dot uses the cooler `state.*` colors (§1). This is the one
intentionally-round element and it's the right contrast note against the crisper card corners.

**`StateView.tsx`** (Loading/Empty/Error) — no structural change. `LoadingState` spinner uses
`accentDecorative.pink` (now the brighter `#EC4E7E`) — a single decisive spot of brand color
on an otherwise monochrome calm state, which is the direction exactly. Empty/Error use
`title` (now 20/26/600) + `body` secondary + a `secondary`-intent (hairline) button. The
`title` drop to 20 makes these states feel composed, not shouty.

**`Screen.tsx`** — no change. Canvas is `bg.canvas` (now cooler `#F7F7F8`), padding `lg`
default. Correct as-is.

---

## 5. Tab bar (the 7-tab problem)

The current bar is 7 text-only labels at `caption` `tertiary`, ~1/7 width each — cramped, and
the code comments already flag it as a mid-word-wrap risk that "only a screenshot can settle."
Precision-minimal has a clear answer: **add icons.**

**Recommendation: adopt `@expo/vector-icons`** (SF Symbols-style via `Ionicons`, Expo-bundled —
**no custom native dep, no dev-client rebuild**, it ships with the Expo SDK). This is the one
dependency I recommend, and it's a safe one. Icons + a small label is *the* modern iOS tab-bar
idiom (it's what Apple's own apps do), and it solves the width problem: a 22pt icon over a
`caption`/500 label reads clean at 1/7 width where text-only does not.

Concrete treatment (all token-driven; icon color from `useTokens()`):
- **Icon 22pt** over label, `spacing.xs` (4) gap, centered, `minHeight: 44` (keep).
- **Active:** icon + label in `accent.pink`, label weight already `500` (caption). **Inactive:**
  icon + label in `text.tertiary`. Meaning is not by color alone — the *filled vs outline* icon
  variant (e.g. `shirt` vs `shirt-outline`) carries the active state too, satisfying the a11y
  rule the same way the availability chip does.
- Suggested Ionicons: Closet `shirt`, Add `add-circle`, Today `sparkles`, Outfits `albums`,
  Laundry `water`, Plan `star`, Account `person`.
- Bar keeps `border.hairline` top, `bg.surface`, `spacing.sm` + inset padding — unchanged.

**Alternative if the icon dep is rejected:** reduce to **5 tabs** by moving `Add` into a
prominent CTA on the Closet screen (it's the flow every other surface depends on, but it
doesn't need to be a permanent tab) and folding `Account` into `Plan` as a sub-screen — **but**
Apple Guideline 5.1.1(v) requires account deletion reachable in-app, so `Account` must stay
findable; safest is keep 7 and add icons. **I recommend the icons.**

*This is a real native-dep decision → it needs the owner's OK for the dev-client rebuild
(icons render as tofu/boxes until the rebuild). Everything else in this spec is a pure
`tokens.ts` value change with zero rebuild.*

---

## 6. Hero moments

**Today suggestion card** (`SuggestionsScreen`): make it feel like *one confident object on a
calm page*. With the new tokens it already improves (crisper 10px radius, tight shadow, cool
well). Concrete premium beats within the existing structure:
- The hero garment sits in a large `sunken` well (cool `#EEEEF1`) — the cutout floats, the
  card is a precise white rectangle with a 1px hairline and a barely-there lift.
- The `display` "Today" (now 34/40/600) leads decisively; the garment color name at `title`
  (20/26/600) is the confident sub-head.
- The highlight strip keeps its 3px `accentDecorative.pink` (now `#EC4E7E`) left rule — the
  *one* spot of decisive color on the card, which is the whole point of the direction.
- "I wore this" is the single filled-pink CTA; "Why this?" stays `ghost`. One decisive action,
  one quiet one.

**Wardrobe grid** (`WardrobeScreen`): the signature surface. The direction rewards it —
- Cutouts on cool `#EEEEF1` wells with 10px radius read as a **precise, even grid of lifted
  garments**, the boutique-shelf feeling.
- The `display` "Your closet" title (34/40) + the whole grid inside one hairline `wellSurface`
  panel reads composed.
- Item color name at `body`, availability chip below as a precise 500-medium pill. The
  restraint (monochrome grid, color only in the actual garments + the one pink chip-dot on
  clean items) is what makes the clothes the content — exactly docs/03 principle 1.

The premium feeling in this direction comes from: **cool neutral canvas + precise hairlines +
one tight shadow + one decisive pink + confident type hierarchy** — nothing decorative, nothing
wrong.

---

## Headline moves (15-line comparison summary)

1. Direction: crisp precision-minimal (Linear/Things/Vercel) — cool monochrome, one pink, hairline-forward.
2. `bg.canvas` `#FBFAF9`→**`#F7F7F8`** (warm→cool near-white).
3. `bg.sunken` `#F3F1EF`→**`#EEEEF1`** (cooler, wider gap from canvas so cutouts lift).
4. `text.primary` `#1A1A1A`→**`#18181B`**; `secondary`→**`#5B5B63`** (5.81:1); `tertiary` `#706C68`→**`#67676E`** (4.85:1).
5. `accent.pink` `#CF215E`→**`#C81E5B`** (hue 340°, cleaner/more saturated; 4.78:1 text, 5.54:1 white-on-fill) — **pink kept as the one lead accent**.
6. `accent.red`→**`#C5312A`** (4.71/5.46), `accent.blue`→**`#3B6FA8`** (4.51/5.22) — kept in contract, used almost never.
7. `accentDecorative.pink` `#E8709A`→**`#EC4E7E`** (brighter brand pink for strip edge + spinner).
8. `border.hairline` `#E7E4E1`→**`#E4E4E7`** (cool 1px — the primary depth cue).
9. `state.*` nudged cooler: clean **`#4E8C6A`** (3.43), dirty **`#9C7A34`** (3.46), unavailable **`#84848C`** (3.20) — all clear 3.0.
10. Type `display` 32/40→**34/40/600**, `title` 22/28→**20/26/600**, `body` 16/24→**16/23/400**, `caption` 13/18/400→**13/18/500** (medium — precise UI text).
11. Family **stays `'System'`** (SF Pro) — no custom font; it's the reference face for this genre.
12. `radius.md` 12→**10**, `radius.lg` 20→**14** (crisper corners); `sm: 8`, `pill: 999` unchanged.
13. `shadow` tightened: radius 12→**8**, offset y 4→**2**, opacity 0.06→**0.05**, elevation 2→**1** (tight lift; hairline carries the edge).
14. `spacing` **unchanged** (4/8/12/16/24/32/48 already clean).
15. Tab bar: **recommend `@expo/vector-icons`** (Expo-bundled, needs dev-client rebuild) — 22pt icon + 500 label, active=pink filled-icon, inactive=tertiary outline; keeps 7 tabs, solves the width/wrap risk. Everything else is a pure `tokens.ts` value swap, zero rebuild.
