# The science of colour theory for wardrobe suggestion

> A grounded synthesis for closet-app's colour engine. Read `docs/decisions/D-003-color-theory-suggestions.md`
> first — this doc is the *science reference* behind that build plan, written against the code as it
> stands today. Every recommendation respects the app invariants: skin tone is **self-identified**
> (swatch quiz, never camera-detected), colour guidance is **advisory** (never prescriptive, never
> scolds a clash), repos are the only DB path, mobile colours come from `useTokens()`, env via
> `envValue()`.
>
> **Honesty convention used throughout:** I mark each claim as `[GROUNDED]` (established
> perception science / CIE standards / textbook colorimetry), `[CONVENTION]` (a defensible design
> convention, not a law), or `[SOFT]` (popular-styling folklore with no peer-reviewed backing). The
> app's copy must not present a `[SOFT]` claim as a `[GROUNDED]` one — that is the whole point of the
> honesty invariant.

---

## 1. What the app actually does today (grounded read, not inferred)

Read before describing. The current engine is four pure modules in `packages/shared/src`, wired into
one screen:

- **`colorFamily.ts`** — `toColorFamily(input)`: a stored colour (a `#rrggbb` hex from the vision
  adapter, or an already-canonical family token) → one of **12 chromatic families** (`red`, `orange`,
  `yellow`, `chartreuse`, `green`, `teal`, `cyan`, `azure`, `blue`, `violet`, `magenta`, `pink`,
  evenly spaced at 30° on the **HSL** hue circle) **+ 5 neutrals** (`black`, `white`, `gray`, `beige`,
  `navy`), or `null` ("no signal — never guess, never throw"). Hue comes from a standard RGB→HSL
  transform; a colour below `NEUTRAL_SATURATION_CEILING = 0.15` (or near-black/near-white by
  lightness) is treated as achromatic. `beige`/`navy` are reachable only as explicit tokens, never
  derived from geometry.
- **`harmony.ts`** — `harmony(a, b)`: an ordered pair of families → one verdict, from a frozen table
  keyed on the **sorted** pair (symmetry is structural). Chromatic verdicts come from circular index
  distance `d ∈ 0..6` (one step = 30°): `d=0` monochromatic, `d=1` analogous, `d=6` complementary,
  `d=4` triadic (120°), `d=5` split-complementary (150°); `d=2` (60°) and `d=3` (90°) fall through to
  `clash`. Any neutral on either side ⇒ `neutral` (neutral-safe).
- **`palette.ts`** — `scorePalette(...)`: each item gets `{score, withinPalette}`, computed by
  normalising **both** the item colour and the self-identified quiz hues through `toColorFamily` and
  testing **family-set membership**. Advisory by construction: one annotation per item, every id
  preserved, nothing dropped/blocked/reordered-away. Score is binary `{0,1}`.
- **`suggestion.ts`** — `suggestItems(...)`: the real recommender. Ranks strictly by
  `status==='clean'` → **thermal warmth** (descending, weather-monotone) → in-palette tie-break
  (equal-warmth only) → id. Colour is a *tie-breaker within a warmth tier*, never a filter, never
  across tiers. Warmth is an **ordinal from category** (`wardrobeSuggestion.ts`: outerwear 4, top/
  dress/bottom 2, shoes/accessory 1) — there is no `warmth` column.
- **Copy:** `suggestionNote.ts` maps the *worst* (least-harmonious) pair's verdict to one plain
  sentence; `clash` and "fewer than two known colours" both return `null` (silence). `suggestionRationale.ts`
  builds the opt-in "why this" block with explicit honesty caveats. `SuggestionsScreen.tsx` renders
  the note as a gentle left-border highlight strip (token colour, never a red error) and only when
  non-null.

Two important facts about the *current* state:

1. **Colour barely touches ranking.** `suggestItems` uses palette only as an equal-warmth tie-break;
   `harmony` does **not** feed ranking at all — it only drives the descriptive note. So today's note
   is honestly *observational* ("these sit next to each other"), not *causal* ("we picked these
   because…"). This matters for copy honesty (§5).
2. **There is no feedback/rejection path.** `git grep` for reject/dismiss/feedback in `packages/`
   finds only DB/RLS plumbing. The "why we didn't take your feedback" copy (§5) is a spec for an
   unbuilt seam, grounded in behavioural-design principles, not a description of live code.

---

## 2. Perceptual colour models — and what the HSL wheel costs

**Colour is three-dimensional.** `[GROUNDED]` Every credible model separates a *lightness* axis, a
*hue* axis, and a *colourfulness* axis:

| Model | Lightness | Hue | Colourfulness | Notes |
|---|---|---|---|---|
| **RGB** | — (mixed into all three channels) | — | — | Device/additive primaries; no perceptual axis is explicit. |
| **HSL / HSV** | L or V | H (angle 0–360°) | S | A cheap algebraic re-projection of RGB. Axes are *named* perceptually but are **not perceptually uniform**. |
| **Munsell** | Value (0–10) | Hue (100 steps) | Chroma | The reference *appearance* system (ASTM D1535); built from human judgements. |
| **CIELAB (CIE 1976)** | L\* | h\_ab = atan2(b\*, a\*) | C\*\_ab = √(a\*²+b\*²) | Designed for *approximate* perceptual uniformity; ΔE is a near-Euclidean "how different do these look". |
| **CIE xyY** | Y (luminance) | (x, y chromaticity) | — | The measurement space CIELAB is derived from (under a white point, e.g. D65). |

**Why perceptual uniformity matters for "do these go together".** `[GROUNDED]` Judging whether two
colours relate is fundamentally a judgement about *perceived distance* — how far apart they look, on
each axis. A uniform space is one where equal numerical steps look like equal perceptual steps, so a
distance threshold means the same thing everywhere on the wheel. HSL is **not** uniform:

- **Equal hue-degree steps are not equal perceived-hue steps.** `[GROUNDED]` Munsell renotation and
  CIELAB both show the eye resolves far more distinct hues in the blue-green region than in the
  purples. So a fixed 30° bin is perceptually wide in some regions and narrow in others.
- **HSL "lightness" is not perceptual lightness.** `[GROUNDED]` `L = (max+min)/2` of gamma-encoded
  RGB has almost nothing to do with how bright a colour looks; a saturated yellow and a saturated
  blue at the same HSL-L look wildly different in brightness. Munsell Value maps monotonically to
  CIELAB L\*, not to HSL L.

**What the app's HSL wheel costs, concretely:**

1. **Two dropped dimensions.** `toColorFamily` keeps hue and collapses everything else to a single
   neutral/not-neutral cut. So `harmony` cannot see value or chroma at all. `[GROUNDED]` Consequences
   (both directions): a `monochromatic` pair with near-identical lightness looks *flat/washed*, not
   the "quietly layered" the note promises; a `complementary` pair with near-identical values lacks
   the contrast that makes complementary pairings read; and two families the table calls `clash` can
   sit together fine when *both* are muted (low chroma).
2. **Boundary quantisation.** `[GROUNDED]` 30° bins mean two hexes ~31° apart can land two buckets
   apart (`d=2` → `clash`) though they are perceptually near-analogous. Quantisation error is worst
   at bin edges. `toColorFamily` centres buckets (`(hue+15)/30`), which is correct, but the hard edge
   remains.
3. **Non-uniform hue distance.** `[GROUNDED]` "Distance 2 = clash" assumes equal index steps are
   equal perceptual steps; they are not. The *scheme angles* (§3) are defensible; treating a bin edge
   as a perceptual law is not.

**The honest verdict** (and the one D-003 lands on): the 12-family HSL table is the **right model for
the hue-relationship *layer*** — categorical, rotation-symmetric, cheap, robust to converter noise,
total. It is the **wrong model for a final "these look good together" verdict**, because it is blind
to two of three axes. `[GROUNDED for the axis claim; CONVENTION for "12 bins is enough for hue"]` If a
finer distance is ever needed, compute it in **CIELAB** (sRGB → linear → XYZ under D65 → Lab), not
HSL. `[SOFT-newer]` OKLab (Ottosson 2020) is plausibly better for perceptual uniformity but is recent
and less textbook-established than CIELAB; treat CIELAB as the confident choice.

---

## 3. Colour harmony — the perceptual basis, not just wheel folklore

**Opponent-process theory.** `[GROUNDED]` Hering's opponent-process theory, confirmed by
retinal/LGN neurophysiology, says colour is encoded on three opponent channels: light–dark,
**red–green**, and **blue–yellow**. This is the empirical reason CIELAB uses a\* (red–green) and b\*
(blue–yellow) axes, and it is *the* grounded fact under "warm/cool" and "these two oppose each other".
Note carefully: the perceptual opponent axes are **red–green** and **blue–yellow** — which is neither
the HSL complement nor the RYB complement exactly. There are, in effect, **three different notions of
"opposite"**, and they disagree:

| Wheel / axis | Complement of red | Basis |
|---|---|---|
| **RGB / HSL** (the app) | **cyan** (180°) | Additive-light hue-angle math. `[GROUNDED as math]` |
| **RYB** (Itten's artist wheel) | **green** | Subtractive-pigment tradition. `[CONVENTION]` |
| **Opponent-process** (perception) | **green** (r–g axis) | Neurophysiology. `[GROUNDED]` |

**The app uses the HSL complement: red ↔ cyan, green ↔ magenta, blue ↔ yellow.** This is stated
explicitly in `harmony.ts` and `colorFamily.ts` and it is internally consistent — the 12 families
*are* the evenly-spaced HSL hue names, so `red`(0) ↔ `cyan`(6) resolving to `d=6` complementary is
correct *for this wheel*. `[GROUNDED-internal]` The load-bearing honesty point: **"these two are
complementary" is a property of *this model's wheel*, not a colorimetric truth.** A stylist trained on
the RYB wheel would call red's complement green. The code comments already warn against "fixing" the
complement to red-green (it would shift every verdict); the *copy* must likewise not over-claim it.

**The four classical schemes and their real status:**

- **Monochromatic** (`d=0`) `[CONVENTION]` — one hue family, varied value/chroma. Genuinely coherent,
  but *needs value spread to read as "layered"* (§2). Same-hue + same-value = flat.
- **Analogous** (`d=1`, ~30°) `[CONVENTION]` — adjacent hues, low tension, "easy blend". The ~30°
  tolerance is a common convention, not a perceptual law.
- **Complementary** (`d=6`, 180°) `[CONVENTION, with a GROUNDED caveat]` — opposite hues, maximum hue
  contrast. Whether it is *pleasing* is aesthetic preference, not fact — **Albers explicitly argued
  against fixed universal harmony rules**. And `[GROUNDED]`: two *high-chroma* complementaries placed
  adjacent produce **simultaneous-contrast "vibration"** (Chevreul's law, 1839; Albers, *Interaction
  of Color*) — a documented after-image edge effect. So "complementary = flattering" over-claims;
  it's a defensible ranking hint, high-tension by nature.
- **Triadic** (`d=4`, 120°) and **split-complementary** (`d=5`, 150°) `[CONVENTION]` — standard Itten
  schemes, harmonious but higher-tension than analogous. The app correctly names these now (they were
  previously folded into `clash`); `d=2` (60°) and `d=3` (90°, a tetradic leg) remain `clash`.

**Two grounded meta-points that discipline the copy:**

- **Harmony is a property of a *relationship*, never of one colour.** `[GROUNDED]` Albers: colour is
  the most relative medium; its effect is set by its neighbours. Itten's contrasts are all defined
  *between* colours. `suggestionNote`/`outfitVerdict` already encode this correctly — they compute over
  pairs, take the worst pair, and return `null` for a single known colour. That is not just an edge
  case; it *is* the science.
- **Itten's contrast of *extension*.** `[GROUNDED]` The perceptual impact of a pairing depends on the
  relative *area* of each colour — which a family-pair lookup cannot see. A tiny cyan accent against a
  large red field is not the same as a 50/50 split. Another reason to hedge, not endorse.

---

## 4. Skin-tone interaction — and the honest status of "seasonal colour analysis"

**The grounded core.**

- **Skin colour physics.** `[GROUNDED]` Skin colour comes from two dominant chromophores — melanin
  (eumelanin brown/black, pheomelanin reddish-yellow) and haemoglobin (oxygenated red, deoxygenated
  bluish). In CIELAB, skin occupies a comparatively narrow locus in the yellow-red quadrant (hue
  angles roughly 40–60°). "Warm" skin trends toward higher b\* (golden/yellow); "cool" toward a
  pinker/rosier balance. **The *direction* of the warm/cool distinction is real; the magnitude of
  separation is small and the ranges overlap heavily.** So warm/cool is a soft bias, not a partition.
- **"Flattering" is *relational*, not intrinsic.** `[GROUNDED]` By simultaneous contrast
  (Chevreul/Albers), a colour near the face genuinely shifts the *apparent* hue/lightness/saturation
  of the adjacent skin (e.g. a cool field can reduce apparent sallowness). The effect lives in the
  *pairing*, not in a fixed "good/bad colour" — **this is the strongest scientific justification for
  framing everything as a hint about a relationship, never a verdict on the person.**
- **Value contrast dominates.** `[GROUNDED]` Differences in L\* are perceptually more salient than
  hue differences and govern figure–ground legibility. So "how light/dark is the garment vs the
  person" carries more of the signal than hue does — which today's hue-only engine cannot see at all.
- **Camera detection is a *correctness* problem, not only a privacy one.** `[GROUNDED]` Measured
  colour = illuminant × surface reflectance × sensor response. Phone cameras run auto white-balance
  and tone-mapping — they deliberately move recorded chromaticity — and metamerism compounds it.
  Because the warm/cool skin signal is *smaller than* white-balance/illuminant error, a
  camera-derived undertone is low-accuracy **by construction**. The swatch quiz sidesteps this
  entirely: the user judges swatches against their own skin under their own light — *their eyes do the
  colour-constancy the camera cannot* — and reports a category. This is affirmative technical backing
  for the self-identified invariant, independent of privacy.
- **Automated skin-tone classification is a dignity/representation risk.** `[GROUNDED-ethics]` Image
  datasets under-represent darker skin and vision systems have historically performed worse on it. A
  classifier that tells a person what their skin "is" makes a truth-claim about their body and can
  misclassify as a dignity harm. Self-ID inverts this: the person is the authority; no biometric is
  captured.

**Seasonal colour analysis — honest status.** `[MIXED — say this plainly in copy]`

- **What is grounded:** the *organising axes*. Every credible seasonal framework (Dorr's warm/cool
  Key-1/Key-2; Caygill; Jackson's *Color Me Beautiful*, 1980; the 12/16 sub-season refinements) is,
  underneath the branding, a partition of the **three Munsell axes**: warm/cool = a hue region,
  light/deep = a Value band, clear/muted = a Chroma band. Those axes and the simultaneous/value-
  contrast mechanisms are `[GROUNDED]`.
- **What is soft/unvalidated `[SOFT]`:** that a person objectively *belongs to exactly one season*;
  that off-palette colours are measurably "unflattering"; the specific per-season palette assignments;
  and the whole four-season (and 12/16 sub-season) taxonomy as a *flattery predictor*. There is **no
  peer-reviewed evidence** for the prescriptive payoff. Itten's contrasts are descriptive labels;
  Albers argued against fixed universal harmony rules.
- **Classifying `navy`/`beige` as neutrals** is likewise a `[CONVENTION]` (fashion styling), not
  colorimetry — both carry real hue and chroma, unlike true achromatic neutrals (black/white/gray,
  chroma ≈ 0). The neutral-safe rule is a reasonable product simplification. `[GROUNDED]` underneath:
  as chroma → 0 the hue coordinate becomes *meaningless*, so a low-chroma colour cannot participate in
  hue discord — which is *why* neutrals pair broadly. So "neutral" is really a **chroma threshold**
  wearing a five-token costume.

**Bottom line for copy:** the app may lean on the *axes* (hue/value/chroma, warm/cool as a soft bias)
and the *relational* framing. It must never present a season identity, a "your colour" prescription,
or an "unflattering" verdict as fact. Model the palette as **continuous per-axis preference weights**,
never a season label — then there is no bucket to be "wrong" about, which is both better science and
structurally non-prescriptive.

---

## 5. Concrete recommendations

Ordered by value ÷ effort. Every one preserves: advisory (never filters/blocks/scolds, every id
preserved), self-identified skin tone (never camera-detected), repos-only DB access, `useTokens()`
colours, structured logger, `envValue()`. Efforts are rough: **S** ≈ hours, **M** ≈ a day, **L** ≈
multi-day + a real oracle.

### (a) Better "alpha" suggestions

**A1 — Emit lightness + chroma from `toColorFamily`, gate the `monochromatic` note on value spread.**
`packages/shared/src/colorFamily.ts` (+ `harmony.ts`, `suggestionNote.ts`). **Effort: M.**
The single highest-value fix, because value contrast carries more signal than hue `[GROUNDED §4]` and
the current `monochromatic` copy ("quietly layered") *over-promises* for two near-identical-lightness
items. Have the converter also return `{ lightnessL, chromaC }` (HSL now, ideally CIELAB later);
add a `harmony(a, b, la, lb)` overload (or a thin post-adjust) that only calls a mono pair "tonal/
layered" when `|la − lb|` exceeds a small band, else a softer "one quiet colour" note. Never scold;
just pick the more honest of two positive sentences. **Threshold is tuning `[SOFT-cutpoint]`, the axis
is science.**

**A2 — Make "neutral" a chroma threshold, not a token list.** `packages/shared/src/colorFamily.ts` +
`harmony.ts`. **Effort: S–M.** With chroma available (A1), treat *any* garment below a chroma
threshold as neutral-safe regardless of nominal hue bucket. This rescues muted dusty-rose / sage /
taupe — which today get forced into `pink`/`green` and can trigger a spurious `clash` — into the
broadly-pairing `neutral` verdict. `[GROUNDED §4]` Keep the token list as the fallback when no chroma
is known. Safe direction: chroma only ever pulls borderline pairs *out* of `clash`, never into it
(and `clash` is already silent), so this can never create a scold.

**A3 — Grade `scorePalette` by hue distance instead of exact family membership.**
`packages/shared/src/palette.ts`. **Effort: M.** Today `score ∈ {0,1}` on family-set membership — a
garment one bucket (30°) off a chosen swatch scores identically to its complement. Replace with a
graded score that decays with circular hue distance to the *nearest* flattering family (0 steps →
1.0, 1 step → high, farther → lower) and treats low-chroma items as broadly compatible. `[GROUNDED
§3 analogous principle]` Keep every invariant literally intact: one annotation per id, `withinPalette`
stays a boolean *soft label above a threshold* — never a gate. This is the piece that lets colour
meaningfully inform ranking as a *soft* preference.

**A4 — Feed harmony + graded palette into `suggestItems` as a soft equal-warmth re-rank.**
`packages/shared/src/suggestion.ts`. **Effort: M, needs a property-test oracle (L if simulator proof
required).** Today `harmony` never touches ranking. Combine palette fit (A3) **and** inter-item
harmony into a single blended affinity, applied **only** among clean, equally-warm candidates — after
the wearability filter and warmth sort, never across warmth tiers, never as a filter. Oracle: property
test over generated closets proving output id-multiset == input id-multiset and that toggling the
colour signal changes at most *ordering*, never membership. This closes the central gap
(colour→ranking) **and** is what finally makes causal copy honest (C1). Keep warmth (thermal) and
colour temperature (hue) as **separate fields** — never sum a hue property into the thermal warmth
ordinal, or the weather-monotonicity proof breaks. `[GROUNDED §3]`

### (b) Accurate, humble copy

**C1 — Keep the note *observational* until A4 ships; then (and only then) allow causal phrasing.**
`packages/shared/src/suggestionNote.ts`, `suggestionRationale.ts`. **Effort: S.** Because `suggestItems`
reads zero colour today, a causal "we paired these for the match" would be a **justification dressed
as an explanation** (Tintarev & Masthoff) — a trust-destroyer once noticed. Current copy is correctly
descriptive ("these sit next to each other"); enforce that as a contract and flip to causal wording
only in the same change that wires A4. **This is a discipline/comment change now, a copy change later.**

**C2 — De-jargon the `complementary` note; drop the leaked wheel metaphor.**
`packages/shared/src/suggestionNote.ts` + `suggestionRationale.ts`. **Effort: S.** "Opposite hues —
this one has some contrast to it" still leaks the wheel. A friend names the *felt effect* (Grice's
maxim of manner): e.g. "These play off each other — a bit of contrast, on purpose." Keep the soft
register everywhere; never "perfect"/"clashes" (§3: complement is high-tension, model sees only hue).

**C3 — State the wheel-relativity + area caveat in the honesty block.**
`packages/shared/src/suggestionRationale.ts`. **Effort: S.** The existing `FAMILY_APPROXIMATION` and
`PALETTE_HONESTY` lines are good. Add (or fold in) that "complementary/contrast" is relative to *this
app's colour wheel* (HSL: red↔cyan, not the artist's red↔green) and that the app can't see how much of
each colour you're wearing. Keeps the `[CONVENTION]`/`[SOFT]` claims from reading as `[GROUNDED]`.

**C4 — Design the "why we didn't take your feedback" copy for the unbuilt feedback seam.**
new copy in `packages/shared/src` (no live path yet). **Effort: S for copy; the seam itself is L.**
Grounded in attribution theory + Self-Determination Theory + politeness theory: **acknowledge →
attribute to an external fact → offer agency**, never defend the algorithm, never imply she was wrong.
Per conflict class: (a) she rejects a suggestion → say nothing, silently re-suggest (a rejection is
data, not a debate); (b) conflicts with availability/weather → attribute to the fact ("That one's in
the wash right now — here's a close stand-in." / "It's cold for that today — want it anyway?"); (c)
conflicts with *her own* self-identified palette → defer to her ("This sits outside the palette you
picked — still want to feature it?"). `withinPalette=false` must always render as *absence of a
positive highlight*, never an "off-palette" label — mirroring the `clash`→silence rule.

---

## 6. Sources

Established / standard references relied on (perception-science textbook knowledge + CIE standards):

- **CIE 1976 (L\*a\*b\*)** and the sRGB→XYZ→Lab transform under D65 — CIE colorimetry standards.
- **Munsell colour system** — ASTM D1535 (Hue / Value / Chroma).
- **Hering opponent-process theory**; retinal/LGN opponent-channel neurophysiology.
- **Chevreul**, *De la loi du contraste simultané des couleurs* (1839) — simultaneous contrast.
- **Josef Albers**, *Interaction of Color* — colour is relational; against fixed harmony rules.
- **Johannes Itten**, *The Art of Color / Kunst der Farbe* — the seven contrasts (hue, light-dark,
  warm-cool, complementary, simultaneous, saturation, extension).
- **Tintarev & Masthoff** — recommender-explanation aims (transparency/scrutability/trust/
  effectiveness); explanation vs justification.
- **Deci & Ryan**, Self-Determination Theory; **Brehm**, psychological reactance; **Brown & Levinson**,
  politeness theory; **Grice**, conversational maxims — the behavioural basis for advisory voice.
- Skin optics (melanin/haemoglobin chromophores) — established dermatology/colour-science.
- **Seasonal colour analysis** (Dorr; Caygill; Jackson, *Color Me Beautiful*, 1980; 12/16 sub-season
  refinements) — cited as a **popular styling framework**, explicitly *not* peer-reviewed colorimetry;
  only its Munsell-axis skeleton is grounded.
- **OKLab** (Ottosson, 2020) — flagged as reasonable-but-newer, not textbook-settled.
