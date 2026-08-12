# Design spec — Editorial / Quiet-Luxury

*A complete, concrete visual redesign for closet-app. Aesthetic: high-end fashion
editorial / boutique concierge — warm, refined, imagery-forward, restrained. Think
Aesop / The Row / a glossy magazine, not a bright consumer utility. Every value here
is expressed against the EXISTING token shapes in `packages/mobile/src/tokens/tokens.ts`
so it drops in without structural change. The one shape change proposed (a `serif`
family + `overline` type entry) is flagged explicitly in §2; everything else reuses the
current keys.*

Every contrast ratio below was computed with the WCAG 2.x relative-luminance formula —
the same one `packages/mobile/src/tokens/contrast.test.ts` asserts — against all three
backgrounds. The palette clears the gate the repo already enforces: 4.5:1 for text
tokens, 4.5:1 for white-on-accent fills, 3.0:1 for `state.*` non-text dots.

---

## 0. What's wrong today, in one paragraph

Flat white cards with a 1px hairline border and a barely-there `#1A1A1A @ 6%` shadow read
as a wireframe, not a boutique. The accent is a hot magazine-checkout pink (`#CF215E`
text / `#E8709A` decorative) that fights the "quiet luxury" brief. The canvas `#FBFAF9`
is so close to pure white it reads as "unstyled default" rather than "warm paper." The
7-tab text-only bar is cramped ("Add", "Plan" are truncation-driven compromises). Type
is a single System sans at a conservative 32/22/16/13 scale — competent, not editorial.
Nothing on the screen says *paid product*.

The fix is not more color or more chrome. It is: **warmer paper, deeper ink, one muted
wine accent used as punctuation, a serif display face for editorial voice, larger radius
+ a real two-feeling soft shadow, and a 5-tab icon bar.**

---

## 1. Palette

Direction: **abandon the hot pink.** The signature accent becomes a muted
**dusty-wine rose** — same 339–342° hue family (so the brand still reads as "warm pink,"
and the existing hue-preservation note in `tokens.ts` stays honest), but dropped in
lightness and chroma so it whispers instead of shouts. The canvas warms from
near-white to a **warm bone/paper**. Ink deepens to a near-black espresso-brown so text
feels printed, not rendered.

All keys are the current `ColorTokens` keys. No structural change.

### bg
| key | current | **new** | why |
|-----|---------|---------|-----|
| `bg.canvas` | `#FBFAF9` | **`#F5F1EA`** | warm bone paper — clearly *chosen*, not "unstyled white" |
| `bg.surface` | `#FFFFFF` | **`#FFFFFF`** | cards stay pure white so they lift off the bone canvas (the contrast IS the elevation) |
| `bg.sunken` | `#F3F1EF` | **`#EBE5DB`** | deeper warm taupe well; garment cutouts pop harder against it |

Keeping `surface` pure white while warming the canvas is deliberate: a white card on a
bone ground reads as a *pressed page on a table* — that separation is most of the premium
feel and costs no shadow.

### text (foreground — ratios are worst-case = darkest bg, `sunken`)
| key | current | **new** | worst ratio | on canvas / surface / sunken |
|-----|---------|---------|-------------|------------------------------|
| `text.primary` | `#1A1A1A` | **`#22201D`** | **12.97:1** | 14.43 / 16.25 / 12.97 |
| `text.secondary` | `#5C5A57` | **`#63594E`** | **5.46:1** | 6.08 / 6.84 / 5.46 |
| `text.tertiary` | `#706C68` | **`#6E6355`** | **4.68:1** | 5.21 / 5.87 / 4.68 |
| `text.onAccent` | `#FFFFFF` | **`#FFFFFF`** | — | ≥5.65:1 on every `accent.*` fill (see below) |

`text.primary` is a warm espresso-brown near-black, not pure black — pure black on warm
paper looks like a printer error; a brown-black looks like ink. Still 12.97:1, deep into AAA.

### accent (legal as TEXT and as a FILL under a white label — the discipline in `tokens.ts`)
| key | current | **new** | as-text worst | white-on-fill | hue |
|-----|---------|---------|---------------|---------------|-----|
| `accent.pink` | `#CF215E` | **`#9F4560`** | **4.80:1** | **6.01:1** | 342° (was 339°) |
| `accent.red` | `#CB3329` | **`#B0442F`** | **4.51:1** | **5.65:1** | 10° (was 4°) |
| `accent.blue` | `#396FA9` | **`#3C6478`** | **5.10:1** | **6.39:1** | 200° (was 211°) |

The new `pink` is a **dusty wine-rose** — this is the single biggest aesthetic move.
`red` becomes a **terracotta/brick** (warmer, editorial, less "alert"). `blue` becomes a
**muted slate-teal** (denim/ink, not corporate blue). All three are desaturated toward the
same warm, dusty register so they read as one family from a boutique paint deck, not three
UI signal colors.

### accentDecorative (decoration ONLY — a dot, rule, or strip edge; no text touches these)
| key | current | **new** | worst ratio | note |
|-----|---------|---------|-------------|------|
| `accentDecorative.pink` | `#E8709A` | **`#C98BA0`** | 2.18:1 | soft rose — the suggestion-card strip edge, hairline accents |
| `accentDecorative.red` | `#D8483F` | **`#CC7A63`** | 2.57:1 | warm clay |
| `accentDecorative.blue` | `#5A8FC7` | **`#7BA0B0`** | 2.24:1 | dusty sky |

These are intentionally below 3.0 — they are decoration, never information (the same
role the current decorative family plays; `contrast.test.ts` does not assert them, and
must not, or they'd stop being decorative).

### border
| key | current | **new** | on canvas |
|-----|---------|---------|-----------|
| `border.hairline` | `#E7E4E1` | **`#E3DCD0`** | 1.21:1 | warm sand hairline — visible enough to define an edge, quiet enough to disappear |

### state (availability dots — non-text UI, floor 3.0:1, always paired with a label)
| key | current | **new** | worst ratio | tone |
|-----|---------|---------|-------------|------|
| `state.clean` | `#589474` | **`#59866A`** | **3.32:1** | sage green — calm positive |
| `state.dirty` | `#A6823C` | **`#9C7838`** | **3.25:1** | ochre/honey — "in the wash," non-alarming |
| `state.unavailable` | `#8C8781` | **`#8A8175`** | **3.06:1** | warm stone — dimmed |

Shifted warmer to sit in the new palette; every one still clears the 3.0 non-text floor
on the worst (sunken) background.

---

## 2. Type scale

**SHAPE CHANGE — flagged.** Editorial voice needs a serif for the display/hero moments
against a humanist sans for body. That is the single defining move of a "magazine" feel.
Two ways to get it; I recommend option A and give B as the zero-risk fallback.

- **Option A (recommended): add a `serif` family key.** New optional field on
  `TypographyTokens`: `readonly serifFamily: string`. Set to **`'Georgia'`** — bundled on
  both iOS and Android, a genuine high-contrast serif, no font file, no licensing, correct
  Dynamic Type. `display` and a new `overline` entry render in `serifFamily`; everything
  else stays on `family`. This is a ~2-line shape addition (one family key, `Text.tsx`
  picks it for `variant='display'`). If a custom face is ever licensed (e.g. *Canela*,
  *GT Sectra*, *Freight Display*), it's a one-line swap here — call it out to the owner as
  a taste upgrade, not a requirement.
- **Option B (fallback, no shape change): stay one family (`'System'`).** Get the editorial
  feel purely from *scale + weight + tracking* — a very large, tight display with negative
  letter-spacing reads confident even in SF Pro. Loses the serif signature but ships with
  zero new keys and zero risk. If the CI/type gate can't take a new key this cycle, ship B
  now and A next.

**Also recommended shape addition: an `overline` scale entry** — small, uppercase, wide-
tracked labels ("TODAY", "YOUR CLOSET" kickers, section eyebrows) are the connective tissue
of editorial layout. `TextVariant` would gain `'overline'`. If you can't add it, reuse
`caption` with `textTransform:'uppercase'` + `letterSpacing` at the call site.

### Recommended scale (values fit `TypographyScaleEntry`: fontSize / lineHeight / fontWeight)
| variant | family | current | **new** | tracking | role |
|---------|--------|---------|---------|----------|------|
| `display` | **serif** (Georgia) | 32 / 40 / 600 | **40 / 46 / 600** | -0.5 | the hero headline — big, confident, editorial |
| `title` | sans (System) | 22 / 28 / 600 | **24 / 30 / 600** | -0.2 | card titles, garment names |
| `body` | sans | 16 / 24 / 400 | **16 / 26 / 400** | 0 | copy — looser leading (26) for the airy feel |
| `caption` | sans | 13 / 18 / 400 | **13 / 18 / 500** | 0 | metadata, chip labels (bumped to medium for legibility at 13) |
| `overline` *(new)* | sans | — | **11 / 16 / 600** | +1.5, uppercase | eyebrows/kickers above titles |

Hierarchy rationale: the display jumps to **40** and moves to a **serif**, opening a wide
gap from the 24pt sans title — that ratio (1.67×) plus the family contrast is what makes a
screen feel *composed* rather than *listed*. Body leading grows to 26 so paragraphs breathe.
`letterSpacing` isn't a token field today; apply the tracking values at the primitive level
inside `Text.tsx` keyed by variant (a lookup, not per-call literals) — or skip tracking
entirely under Option B and the scale still reads well.

> Note on Dynamic Type: the scale is still fixed px (the repo flags this as an open a11y
> gap). This redesign does not fix it and does not make it worse; if/when the scale becomes
> a function of `PixelRatio.getFontScale()`, these base values are the inputs.

---

## 3. Spacing / radius / shadow

### Spacing — unchanged shape, unchanged values
The 4px scale (4/8/12/16/24/32/48) stays. It's already generous and correct. The premium
feel comes from *using the larger steps* — screens should default to `xl`(24) gutters and
`xxl`(32) between sections, not from new numbers. **Recommendation to implementers, not a
token change:** `Screen` default padding moves from `lg`(16) → `xl`(24); cards use `lg`(16)
internal padding minimum. (Screen's `padding` prop already accepts `xl`.)

### Radius — softer, more modern
| key | current | **new** | use |
|-----|---------|---------|-----|
| `radius.sm` | 8 | **10** | chips, small controls |
| `radius.md` | 12 | **16** | cards, wells, buttons — the workhorse |
| `radius.lg` | 20 | **24** | hero suggestion card, sheets |
| `radius.pill` | 999 | **999** | unchanged (chips, dots, floating tab bar) |

Larger corners are the cheapest "2025 app" signal. `md` 12→16 touches every card and well.

### Shadow — one deeper, softer, warm-tinted elevation
The current shadow (`#1A1A1A @ 6%`, r12, y4, elev2) is nearly invisible. `ShadowToken` is a
single triple, so I can't literally stack two layers — but I tune the one to *read* as a
soft ambient bloom rather than a hard drop. Warm-tint the shadow color so it reads as
"paper in warm light," not a grey UI drop.

| field | current | **new** |
|-------|---------|---------|
| `shadowColor` | `#1A1A1A` | **`#3D3226`** (warm espresso — a warm shadow reads as light, not dirt) |
| `shadowOpacity` | 0.06 | **`0.10`** |
| `shadowRadius` | 12 | **`24`** (soft, wide bloom) |
| `shadowOffset` | {0, 4} | **`{ width: 0, height: 8 }`** |
| `elevation` | 2 | **`6`** (Android companion) |

A wide (r24), low-opacity (10%), warm, downward (y8) shadow is the "expensive" shadow —
diffuse and grounded, never a crisp cutout. On the pure-white card over bone canvas this
gives real, quiet lift.

---

## 4. Per-primitive treatment

**`Card.tsx`** — the biggest single upgrade.
- `borderRadius`: `radius.md` → now **16**.
- **Drop the hairline border on `variant='surface'`.** A bordered *and* shadowed card looks
  like a wireframe hedging its bets. Let the deeper shadow + the surface/canvas value gap do
  the separation. Keep the hairline only on `variant='sunken'` (the well needs a defined edge
  since it has no shadow). This is a one-line conditional on `borderWidth`.
- The new warm shadow (via the token) now actually shows. Default internal padding `md`→`lg`.

**`Button.tsx`** — preserve the accent-punctuation rule; refine the shapes.
- `accent` (filled): background `accent.pink` = new wine `#9F4560`, `text.onAccent` white at
  6.01:1. `borderRadius` follows `radius.md`=16 (softer). Keep it as the *one* primary action
  per screen — the punctuation rule in the file's header comment is correct and stays.
- `secondary` (outline): keep the hairline outline but on the warm `#E3DCD0` border; this is
  the *default* button in an editorial UI (quiet). Consider a subtle `bg.canvas` fill so it
  reads as a pressed surface, not a void.
- `ghost`: unchanged (text-only) — used for "Why this?".
- Add tracking `+0.3` on the label for a more deliberate, luxe button feel (in the shared
  base style, not per-call).

**`Text.tsx`** — implement the family split (Option A): when `variant='display'` (and the
new `'overline'`), style from `typography.serifFamily`; otherwise `typography.family`. Apply
per-variant `letterSpacing` here (lookup keyed by variant). No literal colors/sizes leak —
still all from tokens.

**`AvailabilityChip.tsx`** — quieter, more refined.
- Keep dot + label (the a11y invariant — meaning never by hue alone — is non-negotiable).
- `borderRadius` stays `pill`. Background `bg.sunken` → now the warmer `#EBE5DB`.
- Shrink the dot to `xs`(4)×… actually keep `sm`(8) but consider a hairline ring in
  `border.hairline` around it for a "set stone" look. Label stays `caption`, now medium weight.

**`StateView.tsx`** (Loading/Empty/Error) — this is where "every state is designed" earns
the premium feel.
- `LoadingState`: the `ActivityIndicator` color moves to `accentDecorative.pink` (already is)
  — the new soft rose `#C98BA0`. Consider replacing the raw spinner with a slow-pulsing
  garment silhouette later (roadmap; not this pass).
- `EmptyState`/`ErrorState`: title uses `display` (serif) not `title`, centered, with an
  `overline` eyebrow above it (e.g. "YOUR CLOSET"). Generous `xxl`(32) gap. The single action
  is a `secondary` button, wide. This turns the empty closet from "a message + a button" into
  a composed editorial page.

**`Screen.tsx`** — default `padding` `lg`(16) → **`xl`(24)**. The top-inset architecture is
correct and untouched. Canvas background follows the warmed `bg.canvas`.

---

## 5. Tab bar

Today: 7 text-only tabs, ~1/7 width each, already forced into truncation-driven labels
("Add", "Plan"). This is the least premium surface in the app. Two changes:

### 5a. Cut to 5 primary tabs; move 2 into a header/overflow.
Seven top-level destinations is more than an editorial app should show. Recommended primary
set: **Closet · Today · Add · Outfits · Laundry**. Move **Plan** (paywall/membership) and
**Account** off the bar — surface them from a small avatar/menu affordance in the top-right
of the Closet/Today headers. *Caveat:* `Account` must stay reachable in-app for Apple
Guideline 5.1.1(v) — a header avatar → Account satisfies this (it's reachable without
guidance), but confirm placement in the simulator. This is a `tabs.ts` registry change
(structural) and needs owner sign-off since it re-architects navigation — **flag, don't
silently do.** If the owner wants all 7 to stay, keep them but apply 5b+5c.

### 5b. Add icons — recommend `@expo/vector-icons`.
A modern bottom bar is icon+label, not text-only. **Recommendation: add `@expo/vector-icons`**
(Expo-bundled, no separate native dep, loads without a config plugin — but confirm it's
resolvable in the dev-client; if the dev-client needs a rebuild to include it, that's the one
native-ish cost). Use the **Feather** set (thin, minimal, editorial): `grid` (Closet), `sun`
(Today), `plus-circle` (Add), `layers` (Outfits), `droplet` (Laundry). Icon 22pt above a
`caption`/`overline` label; active = `text.primary` + `accent.pink` tint, inactive =
`text.tertiary`.
- **Fallback with NO new dep:** a single geometric dot/underline indicator under the active
  text label (a 4px `accent.pink` pill), labels bumped to `overline` (uppercase, tracked).
  Keeps text-only but adds a clear active affordance and editorial type. Ships today.

### 5c. Active-pill + floating feel.
Give the bar a `bg.surface` fill with the new soft shadow along its top edge (or a hairline
`border.hairline` top, which it already has). The active tab gets a subtle `bg.sunken`
rounded-pill behind its icon+label (radius `pill`) — the standard 2025 "selected pill." This
is pure token styling in `NavShell.tsx`, no new dep.

**My pick:** 5-tab bar (5a) + Feather icons via `@expo/vector-icons` (5b) + active pill (5c),
gated on a simulator screenshot and owner sign-off for the tab-count change. If either the
dep or the re-architecture is blocked this cycle: ship the no-dep fallback (dot indicator +
overline labels + active pill) on the existing 7 tabs — still a real upgrade.

---

## 6. The two cinematic hero moments

### 6a. Today — the suggestion card (`SuggestionsScreen.tsx`)
This is the concierge moment: *"here is what to wear today."* Make it feel like the opening
spread of a lookbook.
- **Header:** an `overline` eyebrow "TODAY" + the date, then let the *garment* be the hero —
  not a big word. Currently "Today" is a 32pt display over a card; instead make the card
  itself the page.
- **Hero well:** grow it — `radius.lg`(24), full-width, `aspectRatio` ~4:5 (portrait, editorial),
  cutout centered on the warm `bg.sunken`. The garment floating on warm taupe with the new soft
  shadow *is* the cinematic frame. Add generous `xl` padding around it.
- **Garment name** in `title` (24, sans), the "with …" companions in `body secondary`.
- **The highlight strip** (the harmony note): keep the `accentDecorative.pink` left rule —
  now the soft rose `#C98BA0`, `borderLeftWidth` 3 → consider 2 for delicacy. This is the ONE
  spot of color on the page; it punctuates, exactly per the accent discipline.
- **"I wore this"** is the single filled `accent` (wine) button — the one primary action.
  "Why this?" stays `ghost`. One loud thing, everything else quiet.
- Net feel: a bone page, a single garment lifted on warm shadow, one serif-adjacent title,
  one rose rule of guidance, one wine button. Editorial, calm, expensive.

### 6b. The wardrobe grid (`WardrobeScreen.tsx`)
This is the "my beautiful closet" moment — the payoff of the whole privacy-gated pipeline.
- **Header:** `overline` "YOUR CLOSET" eyebrow + the `display` (serif, 40) title. That pairing
  is the editorial masthead.
- **The grid `wellSurface`:** it currently wraps the FlatList in a single bordered sunken
  panel. Reconsider — **each tile's well should be the frame, not one big panel.** Drop the
  outer panel border; let each garment's own `bg.sunken` well (radius `md`=16) float on the
  bone canvas with the soft shadow. A grid of individually-lifted cutouts reads far more
  premium than a bordered box of squares. (One-line-ish: remove `wellSurface` border/bg from
  the FlatList `style`, add the soft shadow to each tile's `well`.)
- **Tile spacing:** the 48%-width + space-between gutter is fine; bump `marginBottom` to
  `xl`(24) so rows breathe.
- **Garment name** `body primary`; chip below, quieter (§4).
- `contain` resize mode stays (a coat's sleeves must not crop — that's the product).
- Net feel: an even, breathing grid of clean garments each floating on its own warm well,
  under a serif masthead. The clothes are unmistakably the content; the chrome vanished.

---

## Headline summary (15 lines — the direction at a glance)

1. **Aesthetic:** editorial / quiet-luxury — warm paper, muted wine, serif display, imagery-forward. Abandon the hot pink.
2. **Canvas:** `bg.canvas` `#FBFAF9` → **`#F5F1EA`** (warm bone); `bg.sunken` → **`#EBE5DB`**; `bg.surface` stays `#FFFFFF` (white cards lift off bone).
3. **Ink:** `text.primary` → **`#22201D`** warm espresso-black (12.97:1); secondary **`#63594E`** (5.46); tertiary **`#6E6355`** (4.68).
4. **Accent pink → dusty wine-rose `#9F4560`** (as-text 4.80:1, white-on-it 6.01:1, hue 342°). The single defining color move.
5. **Accent red → terracotta `#B0442F`** (4.51 / 5.65); **blue → slate-teal `#3C6478`** (5.10 / 6.39). One warm dusty family.
6. **Decorative:** rose `#C98BA0`, clay `#CC7A63`, sky `#7BA0B0`; **hairline** `#E3DCD0` warm sand.
7. **State dots** (≥3.0 non-text): clean sage `#59866A` (3.32), dirty ochre `#9C7838` (3.25), unavailable stone `#8A8175` (3.06).
8. **Type — SHAPE CHANGE:** add `serifFamily: 'Georgia'` + an `overline` variant. Display goes **serif 40/46**; title 24/30 sans; body 16/26; caption 13/18/500; overline 11/16/600 uppercase tracked.
9. **Fallback if no shape change:** stay `'System'`, get editorial feel from scale+weight+tracking; reuse `caption` uppercase for overlines.
10. **Radius:** sm 8→**10**, md 12→**16**, lg 20→**24**, pill unchanged. Softer corners everywhere.
11. **Shadow:** warm `#3D3226`, opacity 0.06→**0.10**, radius 12→**24**, offset y4→**y8**, elevation 2→**6** — one deep, soft, warm bloom.
12. **Card:** radius 16, **drop the border on `surface`** (shadow does the lift), keep it on `sunken`; padding `md`→`lg`.
13. **Tab bar:** cut 7→**5 primary** (Closet·Today·Add·Outfits·Laundry), move Plan+Account to a header avatar (Account still in-app for Apple 5.1.1(v)); **add Feather icons via `@expo/vector-icons`** + active `bg.sunken` pill. No-dep fallback: dot indicator + overline labels on 7 tabs.
14. **Today hero:** overline "TODAY" eyebrow, portrait 4:5 hero well radius 24, garment floating on warm shadow, one rose harmony rule, one wine "I wore this" button.
15. **Closet hero:** serif masthead, **per-tile floating wells** (drop the outer panel border) each lifted on soft shadow, `xl` row spacing — a breathing grid of cutouts.

*All ratios computed with the WCAG 2.x formula against canvas/surface/sunken; text tokens clear 4.5:1, white-on-accent fills clear 4.5:1, state dots clear 3.0:1 — the exact gate `contrast.test.ts` enforces.*

*Two changes need owner sign-off before implementation (flagged in-spec, not silently done): the `TypographyTokens` shape addition (§2) and the 7→5 tab re-architecture (§5a). Everything else drops into the existing token shapes.*
