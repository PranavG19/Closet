# Atelier — the reconciled implementation spec (wave-2 SSOT)

This document merges the 6 screen mockups into ONE implementable system. It is the spec a
single implementer follows next. Every hex/px/prop below is load-bearing.

Grounded against the REAL files: `packages/mobile/src/tokens/tokens.ts`,
`packages/mobile/src/ui/{Text,Button,Card,StateView,AvailabilityChip}.tsx`,
`packages/mobile/src/tokens/contrast.test.ts`, `packages/mobile/features/navigation/tabs.ts`,
`packages/mobile/src/App.tsx`, `packages/mobile/features/navigation/NavShell.tsx`.

**The single most important gate fact:** the redesign changes LAYOUT + TYPE + one radius step
and adds ZERO color tokens. The `color.*` block of `tokens.ts` is edited **byte-for-byte
never**. `contrast.test.ts` iterates only the color sub-objects, so it stays green untouched.

---

## 1. The exact delta to `packages/mobile/src/tokens/tokens.ts`

### 1a. SHAPE changes (touch the `Tokens` interface — need care; the one `lightTokens` literal must be updated in lockstep, `tsc` will force it)

**`TypographyScaleEntry` — extend with three OPTIONAL fields (backward-compatible; existing
`display/title/body/caption` literals compile unchanged):**

```ts
export interface TypographyScaleEntry {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: TypographyWeight;
  readonly letterSpacing?: number;          // NEW — points (RN unit), not em
  readonly textTransform?: 'uppercase';     // NEW — overline only
  readonly fontStyle?: 'italic';            // NEW — note only
}
```

**`TypographyTokens` — add one family field and two scale entries (all REQUIRED → the lone
`lightTokens` literal must set them):**

```ts
export interface TypographyTokens {
  readonly family: string;        // existing sans ('System')
  readonly serifFamily: string;   // NEW — see value note (Platform-selected)
  readonly weight: { regular; medium; semibold };
  readonly display: TypographyScaleEntry;   // now rendered in SERIF (family swap lives in Text)
  readonly title: TypographyScaleEntry;
  readonly body: TypographyScaleEntry;
  readonly caption: TypographyScaleEntry;
  readonly overline: TypographyScaleEntry;  // NEW
  readonly note: TypographyScaleEntry;      // NEW — serif italic advisory line
}
```

**`RadiusTokens` — add one step (REQUIRED → update the literal):**

```ts
export interface RadiusTokens {
  readonly xs: number;   // NEW — 6; barely-rounded corners on garment cutouts / thumbs
  readonly sm: number;   // 12
  readonly md: number;   // 18
  readonly lg: number;   // 28
  readonly pill: number; // 999
}
```

### 1b. VALUE deltas in the `lightTokens` literal (safe — no interface change)

`typography`:
```ts
family: 'System',
serifFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' })!,
// ^ MUST be Platform-selected. 'Georgia' on Android silently falls back to the default SANS —
//   the exact "absent decision" bug the family-field comment already warns about. Android's
//   generic 'serif' = Noto Serif, bundled, no dependency, matches the brief's "no dependency".
//   Requires `import { Platform } from 'react-native'` at the top of tokens.ts (new import).
weight: { regular: '400', medium: '500', semibold: '600' },   // unchanged
display:  { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 }, // serif, iOS Title-1 footprint — see §1d sizing
title:    { fontSize: 22, lineHeight: 28, fontWeight: '600' }, // lineHeight 30→28 per brief
body:     { fontSize: 16, lineHeight: 25, fontWeight: '400' }, // unchanged
caption:  { fontSize: 13, lineHeight: 18, fontWeight: '500' }, // unchanged
overline: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' },
note:     { fontSize: 16, lineHeight: 23, fontWeight: '400', fontStyle: 'italic' }, // serif (family swap in Text)
```
- `letterSpacing: 2` = 0.18em × 11px ≈ 1.98 → 2 (RN uses points, not em). This is the brief's
  canonical overline tracking; the .20/.22em variants some mockups used collapse to it (see §3).
- `display` at `fontWeight '600'` + Georgia: at the smaller 28pt size (§1d) a bold Georgia gives
  the headline presence without needing the larger point size the mockups used to feel like a
  display face. iOS Georgia's bold face is real (unlike a synthetic 500), so this renders cleanly.
  If it reads too heavy on the sim in wave 3, drop to `'400'`; a taste call, not a blocker.

`radius`: add `xs: 6`.

### 1d. Sizing — the mockups read too large; here is why, and the grounded fix

The owner's one issue with the mockups: "some of the buttons and font seem too large… doesn't
seem like a normal size." That read is real, and it comes from the MOCKUPS, not the shipped app.
Three causes, each with a source-grounded correction:

1. **Serif carries more optical weight than the system sans at the same px.** The shipped
   `display` is 34pt SANS and the owner was fine with that size. The mockups kept ~34 but swapped
   to serif (Fraunces/Georgia), which reads roughly one size-step larger at the same px. **Fix:
   drop `display` to 28/34** — iOS's *Title-1* footprint (Apple HIG default type: Large-Title 34,
   Title-1 28, Title-2 22). A 28pt serif reads at about the visual size of the 34pt sans the owner
   already accepted, so the headline still feels like a display face without shouting.
2. **The mockups used display-size for EVERY screen header (33–40px; Add 38, Laundry 40).** iOS
   reserves Large-Title (34) for a SINGLE top-level title per screen and steps everything else down
   to Title-tier (20–28). **Fix: exactly one `display` (28) per screen — the hero headline or the
   screen title, never both; every other heading uses `title` (22) or `overline` (11).** The 38/40
   one-offs are deleted (§3.3), not preserved via override.
3. **The 340px mock frame ≠ a 393pt iPhone.** Sizes tuned to fill the narrow mock frame read
   proportionally larger than they will on device. This is exactly why the wave-3 sim screenshot
   (Rule 3) is the real oracle — not the HTML.

**The type scale after this fix (all within Apple HIG norms; min legible 11pt):**

| variant | px / lineHeight | iOS HIG anchor | note |
|---------|-----------------|----------------|------|
| display | 28 / 34 serif   | Title-1 (28)   | one per screen; was 34 sans, mocks pushed to 38–40 |
| title   | 22 / 28         | Title-2 (22)   | unchanged from shipped |
| body    | 16 / 25         | Body/Callout (16–17) | unchanged |
| caption | 13 / 18         | Footnote (13)  | unchanged |
| overline| 11 / 16 +2 caps | Caption-2 (11) | at the 11pt legibility floor — never smaller |
| note    | 16 / 23 serif italic | Body (16) | unchanged |

**Buttons — already normal; no change needed, just confirm the numbers.** The shipped `Button`
is `minHeight: 44` (Apple's 44×44 hit-target minimum; Material's 48dp is comparable), `16px` body
label, `12/16` vertical/horizontal padding — squarely standard. The mockups' large-looking CTAs
were oversized *serif* headlines and full-width pink pills, both already removed by the redesign
(loud pill → quiet `link` intent; one earned filled button per screen). No sizing change to
`Button`; the `link` intent's label is `overline` (11pt) which is a label, not a headline, so it
does not inflate. Keep the 44pt target unconditionally (add `hitSlop` where the visible underline
is shorter than 44pt, per §2 Button).

### 1c. What is DELIBERATELY NOT added

- **No `--wine` (#9F4560).** Add + Outfits mockups invented it for the 2px action underline;
  both designers flagged "maps to accent.pink if preferred." It IS preferred — see §3.1. Adding
  a color would either land in `color.accent` (then it must pass the AA-as-text + onAccent-fill
  tests) or `color.accentDecorative` (then it must pass the hue-within-2°-of-pink test). Neither
  is worth it for a rule that resolves cleanly to the existing signature `accent.pink`.
- **No new spacing token.** Mockups' 22px page margin collapses to the existing `spacing.xl` (24).
- **No fabric/swatch color tokens.** The camel/black/ivory/rose SVG fills are stand-ins for real
  ApprovedPhoto cutout PNGs (production renders the PNG, not a fill). The You swatch hexes come
  from `familySwatchHex()` in `@closet/shared` — quiz stimuli, computed, never theme tokens.

---

## 2. The delta to the UI primitives (`packages/mobile/src/ui/*`)

### `Text.tsx` — add `overline` + `note` variants; `display` becomes serif

```ts
export type TextVariant = 'display' | 'title' | 'body' | 'caption' | 'overline' | 'note';
```
Inside `Text`, resolve family + fontStyle + letterSpacing + textTransform from the variant:
- `family = (variant === 'display' || variant === 'note') ? tokens.typography.serifFamily : tokens.typography.family`
- spread `scale.letterSpacing`, `scale.textTransform`, `scale.fontStyle` when present.
- **Default tone by variant:** when `tone` is not passed, `overline` defaults to `tertiary`
  (the brief pins overline→tertiary); all others keep the current `primary` default. (Implement
  as a small `DEFAULT_TONE: Partial<Record<TextVariant,TextTone>>` map, fall back to 'primary'.)
- Over-image hero text passes `tone="onAccent"` (white `#FFFFFF`) — the hero's gradient scrim
  guarantees contrast, and `onAccent` is intentionally outside the bg-graded contrast set, so
  this is legitimate reuse, NOT a new "inverse" color token.

### `Button.tsx` — add a quiet underlined `link` intent

```ts
export type ButtonIntent = 'accent' | 'secondary' | 'ghost' | 'link';
```
`intent === 'link'` renders the owner-approved quiet action (used as the PRIMARY affordance on
Today, Add, Outfits, You, and the Laundry "Select all"/"Clear" micro-actions):
- transparent background, no radius, `alignSelf: 'flex-start'` (left-aligned, law 4).
- label via `Text variant="overline"` with `tone="primary"` (so it reads as an action, darker
  than a plain overline key).
- `borderBottomWidth: 2`, `borderBottomColor: tokens.color.accent[accent]`, `paddingBottom: 4`.
- keep `accent` prop: default `pink`; the destructive "Delete this look" (Outfits armed) uses
  `accent="red"` for the rule. Hit target: keep `minHeight: 44` on the Pressable (add hitSlop if
  the visible label is shorter).
- The filled `accent` intent stays reserved for the ONE earned filled button per screen
  (Laundry batch "Mark N clean", You red "Permanently delete everything").

### `Card.tsx` — no API change; add usage doctrine (law 2: "not everything is a card")

Card is now the EXCEPTION, not the default wrapper. Reserve `Card` for:
- the serialized data-export block on You (`variant="sunken"` — it is literally a payload),
- modal sheets / the F7 status sheet (surface over scrim),
- the Laundry docked batch bar (surface + shadow earns its own plane for a committed action).

Do NOT wrap in a Card: list rows (Outfits, Laundry), grid tiles (Closet, Add), the Today body,
or the You sections — those float on the canvas, divided by `Divider`.

### `StateView.tsx` — drop the Card wrapper from `EmptyState` / `ErrorState`

Both currently center their content inside `<Card variant="surface">`. Per law 2 + the Outfits/
Today empty mockups (bare authored section, ghost-hanger motif, left-aligned), render them as a
bare left-aligned block: overline eyebrow + serif `display`/`title` + body + a `link` action
(replacing the `intent="secondary"` filled Button). `LoadingState` keeps its calm spinner.

### New primitives (each a new file, then exported from the barrel `ui/index.ts`)

- **`Hero.tsx`** — full-bleed image/gradient band with a bottom-up gradient scrim overlay.
  Props: `{ background?: ImageSource | gradient, height: number, eyebrow?: string,
  title: string, subtitle?: string, statusSlot?: ReactNode, children?: ReactNode }`. Renders
  eyebrow (overline, onAccent) top-left, optional status (dot+label) top-right, the garment
  cutout as `children`, and title (`display`, onAccent) + subtitle (caption, onAccent) bottom-
  left. Used by Today (452px), Outfits featured look (392px), You wardrobe portrait (236px).
- **`Grid.tsx`** — edge-to-edge N-column grid, no card wrappers. Props:
  `{ columns?: 2, gap?: number, children }`. Tiles are bare (cutout on a `radius.xs` well +
  name + `overline` key line). Used by Closet + Add.
- **`Divider.tsx`** — a 1px `border.hairline` rule. Props: `{ inset?: number }`. Replaces every
  ad-hoc `.rule` div. Used on every screen.
- **`SectionHeader.tsx`** — left-aligned overline eyebrow + optional serif `display`/`title`,
  with an optional right-aligned `Button intent="link"` on a shared baseline row (asymmetric,
  law 4). Props: `{ eyebrow?, title?, titleVariant?: 'display'|'title', action?: {label,onPress} }`.
  Used by Closet header, Outfits masthead, You sections, Laundry header.
- **`SelectMark.tsx`** — the circular selection check. Props: `{ selected: boolean, size?: 24 }`.
  Unselected: hairline border + transparent glyph. Selected: `accent.pink` fill + `onAccent`
  tick. Reuses `accent.pink` / `border.hairline` / `text.onAccent` only. Used by Add (chosen
  tile) + Laundry (selected row) — two consumers, so it earns extraction (duplicate-twice rule).

**Stays feature-local (NOT a shared primitive — single consumer):** the Closet `FilterRail`
(underline category rail + overline availability row) lives in `features/wardrobe/`.

---

## 3. Cross-screen inconsistencies found + the single canonical resolution

**3.1 — Three different action-underline colors.** Today/Laundry used `accent.pink`; Add/Outfits
invented `--wine #9F4560`; You used `text.primary` (ink) for Sign out/Export and `pink` for Save.
→ **Canonical: `accent.pink` for every quiet-action underline** (the `Button intent="link"`
default). Ink underlines and wine both drop. Exception: the destructive "Delete this look" rule
uses `accent="red"`. No `--wine` token is created.

**3.2 — Overline letter-spacing drifted (.18 / .20 / .22em).** Closet/Laundry/You used .18em;
Add/Outfits used .20em; some page eyebrows .22em. → **Canonical: the single `overline` token,
`letterSpacing: 2` (≈0.18em at 11px).** All screen overlines use it; the .20/.22 variants were
only on the dark demo-page eyebrows, which are outside the app.

**3.3 — Serif display size ranged 30–40px across screens.** Today 33, Closet/Outfits 34, You
32/30, Add 38, Laundry 40. → **Canonical: one `display` token, 28/34 serif (§1d), used at most
ONCE per screen** (the hero headline OR the screen title, never both). This is the direct fix for
the owner's "too large" note: a 28pt serif reads at the visual size of the 34pt sans already
shipping, and the 38/40 one-offs are deleted. **No per-screen `fontSize` override and no
`displayLarge` token** — the earlier override escape hatch is removed precisely because it would
let the oversized headlines back in. A screen needing a second heading uses `title` (22).

**3.4 — Two "featured hero" inventions vs none in code.** Outfits and You both add a hero the
shipped screens don't have; Today's hero is real. → **Canonical: one shared `Hero` primitive**
(§2). Outfits' featured look needs one derived datum (most-worn saved outfit) the wear-log repo
can already supply — no schema change. You's portrait counts (48 pieces / 12 outfits) are data
the app already holds. Both are composition additions built on the same primitive.

**3.5 — Serif italic used four ways with no token.** Today harmony note, Add privacy promise,
Laundry "kind" subhead, Outfits untitled-look name all want serif italic. → **Canonical: the
`note` typography variant** (serif italic 16/23). Untitled-look names reuse it inline.

**3.6 — Selection affordance rendered two ways.** Add = 24px wine circle + tick; Laundry = 26px
pink check + 2px ring on the cutout. → **Canonical: `SelectMark` (pink fill + onAccent tick)**,
plus a 2px `accent.pink` ring on the cutout (`radius.xs`), NEVER a background tint (tinting would
move the surface the labels were contrast-checked against — faithful to both source notes).

**3.7 — Empty/error treatment: held Card vs bare authored section.** StateView wraps in a Card;
Outfits/Today mockups render bare, left-aligned, with a ghost-hanger motif. → **Canonical: bare
left-aligned StateView** (§2 StateView delta). Consistent with law 2.

**3.8 — "Add" tab styling.** Closet mockup fills the Add tab as a pink circle; other mockups
render it flat like the rest. → **Canonical: keep the Add tab flat**, consistent with the other
four, to preserve "one filled accent per surface" (the NavShell already carries selection via
filled-icon + accent color + sunken pill). A single pink-circle Add tab is a nice-to-have that
can be revisited on the sim; not part of the wave-2 contract.

---

## 4. Ordered implementation plan

### Wave 2 — foundation (shared files; SINGLE-WRITER, mostly serial)

Files that MUST be edited by one writer alone (they are the barrels/SSOT everything else reads):

| Order | File | Writer | Notes |
|-------|------|--------|-------|
| 2.1 | `src/tokens/tokens.ts` | A (alone) | §1 deltas. Blocks all of 2.2–2.6. `tsc` forces the literal update. Adds the `Platform` import. |
| 2.2 | `src/ui/Text.tsx` | B | overline+note variants, serif display, per-variant default tone. Needs 2.1. |
| 2.3 | `src/ui/Button.tsx` | B | `link` intent. Needs 2.1. |
| 2.4 | `src/ui/StateView.tsx` | B | drop Card wrapper; use `link` action. Needs 2.2/2.3. |
| 2.5 | `src/ui/{Hero,Grid,Divider,SectionHeader,SelectMark}.tsx` | C (parallel, distinct files) | new primitives. Need 2.1/2.2. |
| 2.6 | `src/ui/index.ts` | one writer, LAST | export the five new primitives. The barrel is a single-writer chokepoint — serialize it after 2.5. |
| 2.7 | `features/navigation/tabs.ts` | **MOVED to wave 3 (Closet)** | 5-tab registry. Removing `laundry`/`profile` from `TabKey` orphans the two screens unless their new homes (Laundry under Closet; Paywall contextual) land in the SAME change — and those are per-screen wave-3 work needing sim verification. Landing a 5-tab list alone would either orphan two imported screens or force building the Closet→Laundry overlay early. So the nav 7→5 lands WITH the wave-3 Closet screen. |
| 2.8 | `src/App.tsx` | **MOVED to wave 3 (Closet)** | screens map goes 7→5 + Laundry/Paywall as non-tab routes, together with 2.7. |
| 2.9 | run `pnpm verify` (then `pnpm verify:full`) | — | confirms palette bytes unchanged, contrast.test green, tsc clean. Gate before wave 3. |

`src/ui/Card.tsx` and `AvailabilityChip.tsx` need no code change in wave 2 (doctrine only).

### The 5-tab nav change (Apple 5.1.1(v) preserved)

Current `TABS` has **7** entries: wardrobe/add/suggestions/outfits/laundry/profile/account.
New order per brief — **Today · Closet · Add · Outfits · You**:

```
{ key: 'suggestions', label: 'Today',   icon: 'sparkles-outline' }
{ key: 'wardrobe',    label: 'Closet',  icon: 'shirt-outline' }
{ key: 'add',         label: 'Add',     icon: 'add-circle-outline' }
{ key: 'outfits',     label: 'Outfits', icon: 'layers-outline' }
{ key: 'account',     label: 'You',     icon: 'person-outline' }   // relabel account → "You"
```
- **`laundry`** leaves the tab bar (it was one of the seven slop tabs). LaundryScreen stays; it
  is reached from within Closet (a "‹ Closet" back affordance + the "In the wash" availability
  filter opens it). Presented as an overlay/route owned by the wardrobe feature.
- **`profile`** (PaywallScreen, "Plan") folds into Today per the brief. PaywallScreen stays; it
  is presented contextually when a gated action hits the entitlement wall — not a tab.
- **`account` → "You"** stays a TOP-LEVEL tab. **This is the Apple Guideline 5.1.1(v) anchor:**
  "You" *is* the AccountScreen (identity, data export, type-to-confirm delete), so account
  deletion remains reachable in-app without guidance. Do not bury it.
- `TabKey` shrinks to the 5 keys; `TabScreens` (App.tsx) is keyed by `TabKey`, so `laundry` and
  `profile` are removed from the tab `screens` map and rendered as feature-local routes instead
  (local state now; real stack routes when a nav library lands — NavShell/tabs.ts contract is
  unchanged). NavShell.tsx itself needs NO change.

### Wave 3 — per-screen (PARALLEL; one writer per feature folder; shared ui/tokens are FROZEN)

Each screen composes wave-2 primitives; none may touch `tokens.ts`, `src/ui/*`, or `ui/index.ts`.

| Screen | Feature folder | Primitives / notes |
|--------|----------------|--------------------|
| Today | `features/suggestions/` | `Hero` (452px) + `note` harmony line + `Button link` "Wore this today". "Last worn · Nd" only if wear-recency is wired — else drop. No reshuffle action. |
| Closet | `features/wardrobe/` | `SectionHeader` + feature-local `FilterRail` (underline category + overline availability) + `Grid` (tile = cutout on `radius.xs` well, name, overline key with state dot) + branded hanger glyph for awaiting-cutout (never a category word) + Laundry entry point. |
| Add | `features/onboarding/` | `Grid` + `SelectMark` + `Button link` primary "Add to my closet" + `note` privacy promise (approval-tap claim only). Ring, never tint, on chosen tiles. |
| Outfits | `features/outfits/` | featured `Hero` (needs most-worn datum from wear-log repo) + hairline `Divider` rows (not cards) + `Button link` Rename/Remove/Build + `accent="red"` link for armed delete + `note` untitled names. |
| Laundry | `features/laundry/` | hairline rows + `SelectMark` + `overline` header/meta + the ONE filled `Button accent` batch bar (in a `Card`) + fold the per-row "Mark clean" into select→batch. |
| You | `features/auth/` (+ `features/palette/SwatchQuizCard`) | portrait `Hero` + `SectionHeader` overlines + `Button link` for Sign out/Export/Save colours + the ONE red filled `Button accent="red"` delete + swatch fills from `familySwatchHex()`. |

Each wave-3 screen is verified on a real simulator screenshot (agent-arch Rule 3 / project sim
skill), not from agent description.

---

## 5. Contrast / gate risks

- **No palette value changed — confirm by diff.** The `color: { ... }` block of `lightTokens`
  is byte-identical before/after. `git diff packages/mobile/src/tokens/tokens.ts` must show
  changes ONLY under `typography`, `radius`, and the interface/`import` lines — never under
  `color`. If a color line moved, the change is wrong.
- **`contrast.test.ts` is safe by construction.** It iterates only `Object.entries(color.text)`,
  `color.accent`, `color.state`, and `color.bg`. The new tokens live under `typography` and
  `radius`, which it never reads — so a new NON-color token is invisible to the test and cannot
  break it. (Corollary: this is also why we add NO color token — a new color WOULD be auto-graded
  and would have to clear AA.) The decorative-family hue/lightness assertions are untouched.
- **`serifFamily` must be `Platform.select`.** A bare `'Georgia'` renders as the default SANS on
  Android — the same silent "absent typeface" failure the existing `family` comment documents.
  Android's generic `'serif'` is the correct, dependency-free counterpart.
- **`no-literal-colors` lint:** the redesign is token-pure — wine → `accent.pink`, over-image
  white → `text.onAccent`, no fabric/swatch hex literals in mobile (PNGs + `@closet/shared`).
  So the redesign does not introduce a literal-color violation regardless of whether that gate is
  active. (Per project memory the gate's enforcement is uncertain; do not rely on it, but nothing
  here would trip it.)
- **`display` weight on iOS Georgia:** `'600'` maps to Georgia's real bold face; at the 28pt
  size (§1d) it gives the headline presence without the oversized point size the mockups used.
  Verify on the sim in wave 3 and drop to `'400'` only if it reads too heavy. Not a gate risk, a
  taste call.

---

### Key decisions, in one breath

Serif = Georgia (Platform-selected, Android `serif`). Add `overline` (11/16, +2 tracking, caps,
tertiary) and `note` (serif italic 16/23) typography variants; `display` becomes serif 28/34
(dropped from the mockups' 34–40 so the serif headline reads at a normal iOS Title-1 size, §1d),
used at most once per screen.
Add `radius.xs: 6` for cutout corners. **Zero new color tokens** — wine and ink underlines both
collapse to `accent.pink`, over-image text reuses `onAccent`; the palette stays byte-identical so
`contrast.test.ts` stays green. Primitives: Text gains `overline`/`note`, Button gains a quiet
underlined `link` intent, StateView drops its Card, and five new primitives land (Hero, Grid,
Divider, SectionHeader, SelectMark). Cards become the exception, not the wrapper. Nav goes 7→5
(Today · Closet · Add · Outfits · You); Laundry moves under Closet, Plan folds into Today, and
"You" IS the account screen so deletion stays reachable for Apple 5.1.1(v). Wave 2 edits the
token SSOT + ui barrel single-writer and serial; wave 3 re-lays each screen in parallel, one
writer per feature folder, with tokens/ui frozen.
