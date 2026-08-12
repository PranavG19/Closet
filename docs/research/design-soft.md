# Design direction — Warm Soft-Depth / Tactile Modern

*A complete, concrete visual redesign spec for closet-app. Aesthetic: warm neutral
palette, generous rounded cards with soft real elevation, friendly-confident type —
Airbnb 2024 / Calm / iOS 18 soft surfaces. Premium through warmth, softness, polish.*

**Every value below drops into the EXISTING token interfaces in
`packages/mobile/src/tokens/tokens.ts` with no structural change** — same keys, same
shapes. The two places I add a key are called out explicitly in §7. Every AA ratio is
computed with the WCAG 2.x relative-luminance formula (the same one
`packages/mobile/src/tokens/contrast.test.ts` enforces), not asserted.

---

## 1. Palette (`ColorTokens` — exact hex)

The move that defines this direction: **the canvas goes warm cream, not near-white.**
`#FBFAF9` reads as "white app with a warm tint"; `#F6F2EC` reads as paper, linen, a
lit room. Surfaces stay pure white and now *lift* off the warm canvas — that
figure/ground separation is what makes the soft shadow read as depth instead of dirt.
The sunken well goes a full step warmer/darker (`#EDE6DB`) so garment cutouts sit in a
tactile recessed tray, not a barely-there grey box.

Pink is **kept** as the signature accent (this is an intimate, personal, feminine
product — warmth is on-brand and abandoning pink would fight the aesthetic), but
re-hued slightly warmer and deepened for AA. All three accent hues are preserved in
spirit; only lightness/saturation moved to clear contrast on the warmer, darker
backgrounds.

| Token | Hex | Role | AA (worst-case bg) |
|-------|-----|------|--------------------|
| `bg.canvas` | `#F6F2EC` | warm cream paper canvas | (bg) |
| `bg.surface` | `#FFFFFF` | white cards that lift off the cream | (bg) |
| `bg.sunken` | `#EDE6DB` | warm recessed tray for cutouts | (bg) |
| `text.primary` | `#221F1B` | warm near-black (not pure black — softer) | **13.24:1** on sunken |
| `text.secondary` | `#655F58` | warm taupe-gray supporting copy | **5.09:1** on sunken |
| `text.tertiary` | `#6C655C` | warm gray hints/metadata | **4.64:1** on sunken |
| `text.onAccent` | `#FFFFFF` | white label on accent fills | see below |
| `accent.pink` | `#B62E58` | signature warm highlight / primary (hue ~342°) | **4.81:1** on sunken |
| `accent.red` | `#B33A2C` | rare emphasis CTA (hue ~7°) | **4.76:1** on sunken |
| `accent.blue` | `#396595` | cool secondary highlight (hue ~209°) | **4.88:1** on sunken |
| `accentDecorative.pink` | `#E0708F` | dots, rules, strip edges — NO text | 2.46:1 (decoration only) |
| `accentDecorative.red` | `#D45647` | decoration only | 3.24:1 |
| `accentDecorative.blue` | `#5E8FC0` | decoration only | 2.75:1 |
| `border.hairline` | `#E4DCD0` | warm hairline, near-invisible on cream | (decoration) |
| `state.clean` | `#4E8A6A` | calm positive (hue ~148°) | **3.28:1** (≥3.0 UI floor) |
| `state.dirty` | `#9A7A38` | muted "in the wash" (hue ~42°) | **3.25:1** |
| `state.unavailable` | `#847E76` | neutral/dimmed | **3.24:1** |

**White-on-accent-fill (the filled Button's own label — must clear 4.5:1):**
white-on-pink **5.96:1**, white-on-red **5.90:1**, white-on-blue **6.05:1**. All pass.

**Contract preserved:** `accent.*` are legal as text AND as a fill under a white label
(all ≥4.5 on every bg, all ≥5.9 white-on-fill). `accentDecorative.*` are decoration-only
and deliberately below 4.5 — nothing readable ever touches them, exactly as the current
token file documents. This is the same two-family split the codebase already relies on;
I only re-hued within it. A newly-added color still cannot escape `contrast.test.ts`.

**Why warm-neutral over the current cool near-white:** the current `#FBFAF9`/`#FFFFFF`
pair has almost no figure/ground contrast (1.06:1), so the card edges must be drawn with
a hairline border to be seen at all — which is exactly the "flat hairline-bordered card"
look the owner wants gone. A warm cream canvas gives surfaces 1.12:1 of luminance lift,
enough that a soft shadow alone separates them and the border can drop to a whisper (or
vanish on elevated cards — see §4).

---

## 2. Type scale (`TypographyTokens`)

**Family: keep `'System'`** (SF Pro on iOS, Roboto on Android). No custom font. SF Pro
is already a warm, friendly, premium humanist face at display sizes — bundling a custom
face is a licensing + dev-client-rebuild cost this direction does not need. *No new
native dependency required.*

The move here is **a bigger, more confident display and more air in the scale.** The
current display (32/40) is barely larger than title (22/28); a cinematic app leads with
a genuine hero size. I bump display to 34/41 and, critically, weight it to **`'600'`**
(semibold, the top of the allowed `TypographyWeight` union) — the union is `400|500|600`,
so I cannot go heavier without widening the type, and I deliberately don't (§7 notes the
option). Line-heights open up ~1.25–1.3× for calm.

| Variant | fontSize | lineHeight | fontWeight | Change |
|---------|----------|------------|------------|--------|
| `display` | 34 | 42 | `'600'` | +2 size, +2 lh — bigger hero moment |
| `title` | 22 | 30 | `'600'` | +2 lh — more air |
| `body` | 16 | 25 | `'400'` | +1 lh |
| `caption` | 13 | 18 | `'500'` | weight 400→500: warm-gray captions need the extra stroke weight to feel intentional, not faint |

All within the existing `TypographyWeight = '400'|'500'|'600'` union and the
`TypographyScaleEntry` shape. Drop-in.

---

## 3. Spacing / Radius / Shadow

### Spacing (`SpacingTokens`) — UNCHANGED
The 4/8/12/16/24/32/48 scale is correct and generous; the fix is not new numbers, it's
*using the larger steps more* (see per-primitive §4). Keep all seven values.

### Radius (`RadiusTokens`) — lean larger, this is where "soft" lives
| Key | Current | **New** | Use |
|-----|---------|---------|-----|
| `sm` | 8 | **12** | chips, small controls |
| `md` | 12 | **18** | default card / button radius |
| `lg` | 20 | **28** | hero cards, sheets, the Today card |
| `pill` | 999 | **999** | chips, avatars, the tab active-pill |

Larger radius is the single cheapest lever for "soft-depth." 18pt on a standard card and
28pt on the hero card read as pillowy and modern without tipping into toy-like.

### Shadow (`ShadowToken`) — one soft, layered-feeling triple
RN gives us exactly one shadow triple, so it must do all the work. The current
`opacity 0.06 / radius 12 / offset (0,4)` is the "barely-there shadow" the owner
criticized — too tight and too faint to read as elevation. The soft-depth move is
**larger blur, slightly more opacity, warm-tinted shadow color, modest offset**:

```
shadowColor:   '#3A2E23'   // warm brown-black, not neutral #1A1A1A — a warm shadow on
                            // a cream canvas reads as soft daylight, not a hard drop
shadowOpacity: 0.10
shadowRadius:  24           // wide, diffuse — the key to "soft" not "harsh"
shadowOffset:  { width: 0, height: 8 }
elevation:     6            // Android companion, bumped to match the softer iOS look
```

Wide radius (24) + low opacity (0.10) + a gentle downward offset (8) is the profile that
reads as a surface floating a few mm above the page in soft light. A tight, dark,
high-opacity shadow reads as a sticker; a wide diffuse warm one reads as physical. This
is the whole "tactile" claim, in one triple.

---

## 4. Per-primitive treatment

### `Card.tsx` — the heart of soft-depth
- **Radius:** `tokens.radius.md` → now 18 (was 12). Hero/sheet callers pass a style
  override to `radius.lg` (28) — or see §7 for a cleaner `elevation` prop.
- **Border:** on the `surface` variant, **drop the hairline border entirely** and let the
  soft shadow do the separation. The warm canvas + white surface + wide shadow now carry
  the figure/ground on their own; a border on top of a shadow is the belt-and-suspenders
  look that reads as "prototype." Keep the hairline border ONLY on the `sunken` variant
  (a recessed tray reads better with a faint inset edge than with a shadow).
- **Shadow:** unchanged code path — it already spreads the `ShadowToken` onto `surface`
  only. The new softer triple (§3) flows in automatically.
- **Padding:** default `md` (12) → recommend callers use `lg` (16) for hero cards; the
  primitive default stays `md` so dense lists aren't forced wide. No code change.

Net: `Card` variant `surface` = white, 18pt radius, **no border**, soft warm 24-blur
shadow. That single change is ~80% of the visual upgrade.

### `Button.tsx`
- **Radius:** `tokens.radius.md` → 18. With `minHeight 44` and 18pt radius the button
  reads as a soft pill-ish tablet, not a sharp box.
- **Fill:** `accent` intent unchanged (filled `accent.pink`, white label — now 5.96:1).
- **Secondary intent:** today it's a hairline outline on white. In soft-depth, make it a
  **filled `bg.sunken` tonal button** (warm cream fill, `text.primary` label, no border) —
  a soft tonal button is warmer and more tactile than an outline and matches iOS 18's
  filled-gray secondary. This is a one-line change to the `secondary` variant style
  (`{ backgroundColor: tokens.color.bg.sunken }` instead of borderWidth+border+surface).
- **Ghost:** unchanged (transparent, text-only).
- Consider a subtle pressed state (`opacity 0.85` on `pressed`) via Pressable's style
  callback — optional, additive, no token change.

### `Text.tsx`
- No structural change. Picks up the new scale (§2) automatically. The display variant
  now renders 34/42 semibold — the confident hero type — with zero code change.

### `AvailabilityChip.tsx`
- **Roundness:** already `radius.pill` — stays pillowy, good.
- **Fill:** today `bg.sunken` (`#EDE6DB` now — warmer, reads as a soft tonal chip). Good
  as-is; the warmer sunken makes it feel more tactile for free.
- **Padding:** bump to `paddingVertical: xs (4)` / `paddingHorizontal: md (12)` (from
  sm=8) so the pill has more breathing room around the dot+label — reads pillowier.
- Dot stays `state.*` color (now ≥3.0:1 AA, paired with label — meaning never by hue).

### `StateView.tsx` (Loading / Empty / Error)
- `LoadingState` spinner: switch `accentDecorative.pink` → **`accent.pink`** (`#B62E58`).
  A decorative-tone spinner on the warm canvas is too faint; the AA-legal accent reads
  as a calm, present brand moment. (Decoration tone was chosen when pink-as-fill failed
  AA; it now passes, so the primary accent is the honest choice.)
- Empty/Error: wrap the centered content's title+body in a soft `Card` (surface, lg
  padding, radius.lg) so an empty state feels like a designed, held moment rather than
  floating text on the canvas — directly addresses "sparse unbalanced layouts." The
  `EmptyState`/`ErrorState` action already uses `Button intent="secondary"`, which now
  renders as the warm tonal button. Optional but recommended.

### `Screen.tsx`
- No structural change. Canvas now paints warm cream `#F6F2EC` automatically. Default
  padding `lg` (16) is right for this direction; hero screens can pass `xl` (24) for the
  boutique feel. Keep the inset-on-canvas fix exactly as-is.

---

## 5. Tab bar (`NavShell.tsx`) — 7 tabs, no icon lib

The current bar is a flat white strip with a hairline top border and 7 text-only labels
at ~1/7 width each — the cramped look the owner named. **Recommendation: add
`@expo/vector-icons`** (Expo-bundled, *no custom-font-file / no licensing question*, but
it IS a new native asset that wants a dev-client rebuild — state that cost explicitly).
Icons are the single biggest upgrade for a 7-tab bar because they let each tab be an
icon+tiny-label stack that survives narrow width where text-only truncates.

**If the rebuild is acceptable — the on-brand treatment:**
- A **soft floating bar**: a white `bg.surface` bar with `radius.lg` (28) top corners
  (or a fully floating rounded rect inset from the edges by `spacing.md`), lifted with
  the soft shadow triple — it floats above the canvas like the cards do.
- Each tab: an Ionicons glyph (~22pt) stacked over the `caption`-scale label. Suggested
  glyphs: Closet `shirt-outline`, Add `add-circle-outline`, Today `sparkles-outline`,
  Outfits `layers-outline`, Laundry `water-outline`, Plan `star-outline`, Account
  `person-outline`.
- **Active state = a soft pill** behind the active tab's icon: a `radius.pill` capsule
  filled with a tint of the canvas (`bg.sunken`) — the iOS-18 "selected segment" look —
  with the icon+label in `accent.pink` (active) vs `text.tertiary` (inactive). Meaning is
  carried by pill + color + the always-present label, never hue alone.

**If NO rebuild (pure token/layout change, ships today):**
Keep text-only but make it a **floating soft bar**: white surface, `radius.lg` top
corners, soft shadow, drop the hairline top border. Active tab gets a small
`radius.pill` `bg.sunken` capsule behind its label with `accent.pink` text; inactive
stays `text.tertiary`. This alone lifts the bar from "flat strip" to "floating control"
with zero new dependencies. Icons remain the stronger option — flag the rebuild trade.

---

## 6. Hero moments

### The Today suggestion card (`SuggestionsScreen.tsx`)
Today it's one `Card variant="surface" padding="lg"` holding a square sunken well +
title + a left-border highlight strip + buttons. Make it *the* cinematic surface:
- Card → `radius.lg` (28), `padding lg` (16→ consider 24), soft shadow, no border. It
  becomes a single generous floating panel — the boutique's front window.
- The `heroWell` (currently `radius.md`) → `radius.lg` (28) to match the card's softness,
  and give it more height (`aspectRatio` ~4/5 portrait rather than 1/1) so the suggested
  garment gets a gallery-format frame, not a thumbnail.
- The highlight strip (`borderLeftColor: accentDecorative.pink`) stays — it's the one
  correct use of a decorative accent (a rule, no text on it). On the warmer canvas the
  `#E0708F` edge reads as a soft blush accent. Good as-is.
- "I wore this" button: the filled `accent.pink` primary now at 18pt radius, white label
  at 5.96:1 — a confident, tactile primary CTA anchoring the card.
- "Why this?" ghost button stays quiet below it. The calm hierarchy holds.

### The wardrobe grid (`WardrobeScreen.tsx`)
The signature surface. Today each tile is a `radius.md` sunken well + text + chip, and
the whole FlatList sits on one bordered `wellSurface`.
- **Tile wells → `radius.lg` (28)** and keep `bg.sunken` (now the warmer `#EDE6DB`): each
  garment sits in a soft, warm, deeply-rounded tray — the cutout genuinely reads as
  lifted off the page, which is the stated product promise. This is a one-token bump in
  the `well` style.
- **The list `wellSurface`:** drop the hairline border and the sunken fill; let tiles
  float directly on the warm cream canvas instead of on a bordered inner panel. Removing
  the panel-within-panel is what turns a cramped grid into a breathable gallery. (If a
  container is still wanted, make it a `surface` white card with soft shadow — but the
  cleaner move is no container.)
- Keep `contain` resize, keep the 48%-width 2-column layout, keep FlatList windowing —
  all correct, untouched.
- Increase `marginBottom` between rows from `lg` (16) to `xl` (24) for gallery spacing.

Both hero moments are achieved with radius bumps + border removal + the softer shadow —
no new components, no new APIs.

---

## 7. New keys / structural notes (explicit call-outs)

The palette, type, spacing, radius, and shadow all fit the EXISTING interfaces with no
shape change — pure value swaps. Two OPTIONAL additions worth surfacing, neither required
to ship the direction:

1. **`Card` `elevation` prop (optional, not a token change):** hero cards currently need a
   `style={{ borderRadius: radius.lg }}` override to get the bigger radius. A cleaner API
   is a `variant`/`elevation` prop on `Card` (`'flat' | 'raised' | 'hero'`) mapping to
   radius+shadow presets. This is a component change, not a token-shape change — mentioned
   for the implementer's convenience, not required. Without it, callers just pass a style
   override as they do today.

2. **A heavier display weight (NOT taken):** `TypographyWeight` is `'400'|'500'|'600'`, so
   display cannot go bolder than semibold without widening the union — a token *shape*
   change I deliberately avoid. 600 at 34pt is confident enough for this warm direction
   (bold would read as loud, off-brand for "calm"). Flagging that the ceiling exists; I
   recommend staying at 600.

3. **`@expo/vector-icons` for the tab bar (§5):** the one genuinely new dependency, and
   only if the icon treatment is chosen. Expo-bundled, no licensing, but needs a
   dev-client rebuild. The no-rebuild floating-bar fallback is fully specified in §5.

Nothing else needs a new token. `border.hairline` keeps its key even though the
`surface` Card stops using it (the `sunken` Card and dividers still do).

---

## 15-line headline summary (for cross-direction comparison)

1. **Direction:** warm soft-depth — cream canvas, white cards floating on a soft warm shadow.
2. **`bg.canvas` `#F6F2EC`** (warm cream, was cool `#FBFAF9`) — the defining move; gives surfaces figure/ground lift.
3. **`bg.surface` `#FFFFFF`**, **`bg.sunken` `#EDE6DB`** (warmer, deeper tray for cutouts).
4. **`text.primary` `#221F1B`** (warm near-black), **secondary `#655F58`**, **tertiary `#6C655C`** (all ≥4.64:1).
5. **Pink KEPT & deepened: `accent.pink` `#B62E58`** (4.81:1 min, white-on-it 5.96:1); red `#B33A2C`, blue `#396595`.
6. **`accentDecorative.*`** re-hued warmer (`#E0708F`/`#D45647`/`#5E8FC0`), decoration-only, same two-family contract.
7. **`state.*`** unchanged intent, verified ≥3.0:1 (clean `#4E8A6A`, dirty `#9A7A38`, unavailable `#847E76`).
8. **Radius up:** sm 8→12, md 12→**18**, lg 20→**28**, pill 999. Softness lives here.
9. **Shadow soft & warm:** color `#3A2E23`, opacity **0.10**, radius **24**, offset (0,**8**), elevation 6.
10. **Type bigger/warmer:** display **34/42/600**, title 22/30/600, body 16/25/400, caption 13/18/**500**. Family stays `'System'`.
11. **Card:** `surface` variant **drops the border**, keeps only the soft shadow — the single biggest upgrade.
12. **Button secondary → filled tonal `bg.sunken`** (was hairline outline); all buttons 18pt radius.
13. **Tab bar:** floating soft white bar + active `bg.sunken` pill + `accent.pink` label; **recommend `@expo/vector-icons`** (needs dev-client rebuild) with a fully-specified no-rebuild fallback.
14. **Hero grid/Today:** tile & hero wells → radius **28**, drop the panel-within-panel border, more row spacing — a breathable gallery.
15. **Zero token-shape changes; all values drop into existing interfaces.** Two optional component-level adds (`Card` elevation prop, icons) called out, neither required.
