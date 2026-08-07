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
  if (distance === CHROMATIC.length / 2) return 'complementary';
  return 'clash';
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
