// F9 — garment-to-garment color harmony. Pure, total, deterministic: every
// ordered pair of color families maps to exactly one verdict, no I/O, no clock,
// no randomness. Symmetry is structural (the table is keyed by the SORTED pair,
// so harmony(a,b) and harmony(b,a) read the same cell — it cannot drift).

// The 12 chromatic hue buckets (wheel order, index = position) plus the wardrobe
// neutrals. Neutrals have no hue and pair safely with anything (neutral-safe, F9).
const CHROMATIC = [
  'red',
  'orange',
  'yellow',
  'chartreuse',
  'green',
  'teal',
  'cyan',
  'azure',
  'blue',
  'violet',
  'magenta',
  'pink',
] as const;

const NEUTRAL = ['black', 'white', 'gray', 'beige', 'navy'] as const;

export const COLOR_FAMILIES = [...CHROMATIC, ...NEUTRAL] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

const COLOR_FAMILY_SET: ReadonlySet<string> = new Set(COLOR_FAMILIES);

export function isColorFamily(x: unknown): x is ColorFamily {
  return typeof x === 'string' && COLOR_FAMILY_SET.has(x);
}

export const HARMONY_VERDICTS = [
  'monochromatic',
  'analogous',
  'complementary',
  // Two established schemes the first cut folded into 'clash': on the 12-family wheel
  // one index step = 30°, so distance 4 = 120° (triadic — three hues evenly spaced) and
  // distance 5 = 150° (split-complementary — the two hues flanking a complement). Both
  // are standard, harmonious relationships (Itten / mainstream color theory), just with
  // more tension than analogous. Naming them stops the note from going silent on a pairing
  // that actually holds together. Distances 2 (60°) and 3 (90°) stay 'clash' — genuinely
  // weaker. NOTE: this is the HSL/additive wheel (red↔cyan complement), NOT the RYB
  // painter's wheel (red↔green); the 12 families are the evenly-spaced HSL hue names, so
  // do not "fix" the complement to red-green or every verdict shifts.
  'triadic',
  'split-complementary',
  'neutral',
  'clash',
] as const;
export type HarmonyVerdict = (typeof HARMONY_VERDICTS)[number];

const NEUTRAL_SET: ReadonlySet<string> = new Set(NEUTRAL);
const HUE_INDEX: ReadonlyMap<string, number> = new Map(CHROMATIC.map((f, i) => [f, i]));

// The relation-level rule, evaluated once per unordered pair to build the frozen
// table below. Circular hue distance drives the chromatic verdicts; a neutral on
// either side is always neutral-safe.
function verdictFor(a: ColorFamily, b: ColorFamily): HarmonyVerdict {
  if (NEUTRAL_SET.has(a) || NEUTRAL_SET.has(b)) return 'neutral';
  const ia = HUE_INDEX.get(a)!;
  const ib = HUE_INDEX.get(b)!;
  const raw = Math.abs(ia - ib);
  const distance = Math.min(raw, CHROMATIC.length - raw); // 0..6 on the 12-hue wheel
  if (distance === 0) return 'monochromatic';
  if (distance === 1) return 'analogous';
  if (distance === CHROMATIC.length / 2) return 'complementary'; // 6 steps = 180°
  if (distance === 4) return 'triadic'; // 120°
  if (distance === 5) return 'split-complementary'; // 150°
  return 'clash'; // distances 2 (60°) and 3 (90°) — the genuinely weaker pairings
}

function pairKey(a: ColorFamily, b: ColorFamily): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

// Frozen rule table keyed by the SORTED pair — one cell per unordered pair, built
// over the full cross-product so every (a,b) resolves (totality is structural).
const HARMONY_TABLE: ReadonlyMap<string, HarmonyVerdict> = (() => {
  const table = new Map<string, HarmonyVerdict>();
  for (const a of COLOR_FAMILIES) {
    for (const b of COLOR_FAMILIES) {
      const key = pairKey(a, b);
      if (!table.has(key)) table.set(key, verdictFor(a, b));
    }
  }
  return table;
})();

// Pure, total lookup. Canonicalize the pair, read the frozen table. Never
// undefined for a well-typed (ColorFamily, ColorFamily) input.
export function harmony(a: ColorFamily, b: ColorFamily): HarmonyVerdict {
  return HARMONY_TABLE.get(pairKey(a, b))!;
}

// A2 tuning constant — NOT a colorimetric law. Above the converter's
// NEUTRAL_SATURATION_CEILING (0.15, where a colour is already folded to an achromatic
// neutral), but a garment can still land in a chromatic bucket while being visibly muted
// (dusty rose, sage, taupe: real hue, low chroma). D-003 research §4 [GROUNDED]: as chroma
// → 0 the hue coordinate becomes meaningless, so a low-chroma colour cannot participate in
// hue discord — which is *why* neutrals pair broadly ("neutral is a chroma threshold wearing
// a five-token costume"). The 0.35 cutpoint itself is [SOFT] — a tuning value chosen to sit
// between the achromatic floor (0.15) and clearly-saturated colour; adjust with taste, it is
// not derived from a standard.
const MUTED_CHROMA_CEILING = 0.35;

// Chroma-aware verdict (A2). Given the family pair AND each garment's HSL chroma (null when
// the colour was a bare token, so chroma is unknown), a pair the hue table calls `clash`
// becomes neutral-safe when EITHER garment is muted enough to have no meaningful hue.
//
// SAFETY, STRUCTURAL not tested-for: chroma may ONLY pull a pair OUT of `clash`, never into
// it. Every non-clash verdict is returned untouched, and the only rewrite is clash→neutral.
// Since the app already silences `clash`, this can never turn silence into a scold — it can
// only turn silence into a (positive) neutral note. With both chromas null (bare tokens)
// this is exactly `harmony(a, b)` — the conservative regression path when chroma is unknown.
export function harmonyWithChroma(
  a: ColorFamily,
  b: ColorFamily,
  chromaA: number | null,
  chromaB: number | null,
): HarmonyVerdict {
  const base = harmony(a, b);
  if (base !== 'clash') return base;
  const aMuted = chromaA !== null && chromaA < MUTED_CHROMA_CEILING;
  const bMuted = chromaB !== null && chromaB < MUTED_CHROMA_CEILING;
  return aMuted || bMuted ? 'neutral' : 'clash';
}

// Circular hue distance between two chromatic families, 0..6 on the 12-hue wheel (one step
// = 30°). Exported so the palette scorer grades affinity by the SAME wheel geometry harmony
// verdicts use — a family can't be "near" the palette here yet "clash" there.
export function hueDistance(a: ColorFamily, b: ColorFamily): number {
  const ia = HUE_INDEX.get(a);
  const ib = HUE_INDEX.get(b);
  if (ia === undefined || ib === undefined) return NaN; // a neutral has no hue position
  const raw = Math.abs(ia - ib);
  return Math.min(raw, CHROMATIC.length - raw);
}

// A3 — GRADED palette affinity of one family against the self-identified flattering set,
// in [0,1]. Replaces the binary "exact family membership" score with a hue-distance decay so
// a garment ONE step (30°, analogous) off a chosen swatch scores high, not identically to its
// complement (D-003 §5 A3, grounded in the analogous principle §3). Contract:
//   - empty palette → 0 (no signal), never a guess.
//   - a NEUTRAL item (family in NEUTRAL_SET) → NEUTRAL_AFFINITY: neutrals pair broadly, so they
//     are softly compatible with any palette rather than scored by a hue distance they don't
//     have (D-003 §4: a neutral is a chroma threshold, its hue coordinate is meaningless).
//   - otherwise → the MAX over chosen families of the per-family decay (nearest wins). A chosen
//     family that is itself neutral contributes NEUTRAL_AFFINITY (a chromatic item near no
//     chosen chromatic hue still gets a soft floor if she chose neutrals).
// This is ADVISORY: it is a soft preference weight, never a gate. Monotonic in nearness and
// bounded in [0,1], so it can only ever REORDER equal-warmth items, never admit/exclude.
const AFFINITY_BY_HUE_STEP: readonly number[] = [
  1.0, // 0 steps — exact family
  0.75, // 1 step (30°, analogous)
  0.4, // 2 steps (60°)
  0.2, // 3 steps (90°)
  0.1, // 4 steps (120°, triadic)
  0.05, // 5 steps (150°)
  0.0, // 6 steps (180°, complementary — furthest)
];
// A neutral's soft, broad compatibility floor — below an exact/analogous chromatic match but
// above a distant one, reflecting "neutrals go with everything" without over-claiming.
const NEUTRAL_AFFINITY = 0.5;

export function paletteAffinity(family: ColorFamily, paletteFamilies: readonly ColorFamily[]): number {
  if (paletteFamilies.length === 0) return 0;
  const itemIsNeutral = NEUTRAL_SET.has(family);
  if (itemIsNeutral) return NEUTRAL_AFFINITY;
  let best = 0;
  for (const chosen of paletteFamilies) {
    const contribution = NEUTRAL_SET.has(chosen)
      ? NEUTRAL_AFFINITY // she chose a neutral: a soft floor for any chromatic item
      : (AFFINITY_BY_HUE_STEP[hueDistance(family, chosen)] ?? 0);
    if (contribution > best) best = contribution;
  }
  return best;
}
