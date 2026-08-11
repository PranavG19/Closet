// hex/token → ColorFamily. The load-bearing seam D-003 Step 1 identifies: the F9
// harmony engine and B1 palette scorer both reason over the 12+5 ColorFamily TOKENS,
// but a stored garment colour is a free-form string that in practice is a #rrggbb hex
// from the vision adapter. Nothing bridged the two, so harmony/palette had no honest
// way to run on real data. This is that bridge — and ONLY that bridge: it is pure,
// changes no behaviour, and has zero callers yet (wiring it into ranking is a later,
// owner-reviewed step, D-003 Steps 2-3).
//
// CONTRACT, chosen to be honest about a lossy mapping (critique's grounding + honesty
// bars):
//   - An input that is ALREADY a canonical family token returns itself.
//   - A #rrggbb hex is quantised to the nearest family by HSL geometry (below).
//   - ANYTHING else — a colour name we don't model, malformed hex, null — returns
//     `null` meaning "no signal", NEVER a guess and NEVER a throw. A null lets the
//     caller simply skip the colour signal for that item rather than fabricate one.
//
// WHY this is approximate, stated so no one over-trusts it: 16.7M hexes collapse into
// 17 buckets, and this models HUE only — value (lightness) and chroma (saturation)
// beyond the neutral cutoff are discarded (D-003 research: a full model is 3-D). It is
// good enough to pick a family for a harmony/palette HINT, not a colourimetric verdict.
//
// It commits to the HSL/additive wheel (red 0°, green 120°, blue 240°), matching
// harmony.ts's family order and its red↔cyan complement — NOT the RYB painter's wheel.
import { isColorFamily, type ColorFamily } from './harmony.js';

// The 12 chromatic families in wheel order, each 30° apart starting at red = 0°. This
// MUST match harmony.ts's CHROMATIC order (index = hue/30), or a hex would map to a
// family whose harmony verdicts assume a different wheel position.
const CHROMATIC_BY_HUE_STEP: readonly ColorFamily[] = [
  'red', // 0°
  'orange', // 30°
  'yellow', // 60°
  'chartreuse', // 90°
  'green', // 120°
  'teal', // 150°
  'cyan', // 180°
  'azure', // 210°
  'blue', // 240°
  'violet', // 270°
  'magenta', // 300°
  'pink', // 330°
];

// Below this HSL saturation a colour has no meaningful hue — it reads as an achromatic
// neutral (Munsell/CIELAB: as chroma → 0 the hue coordinate becomes meaningless, which
// is exactly why neutrals pair with anything, D-003 research). Split by lightness into
// black / gray / white. `beige` and `navy` are NOT derived from hex — beige is a
// low-chroma warm off-white and navy a dark desaturated blue, and guessing them from
// geometry alone would be the kind of over-precise guess the contract forbids; they
// remain reachable only when passed as explicit tokens.
const NEUTRAL_SATURATION_CEILING = 0.15;
const DARK_LIGHTNESS_CEILING = 0.2;
const LIGHT_LIGHTNESS_FLOOR = 0.85;

interface Hsl {
  readonly hueDeg: number; // [0, 360)
  readonly saturation: number; // [0, 1]
  readonly lightness: number; // [0, 1]
}

// Standard RGB→HSL. r/g/b in [0,1].
function rgbToHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hueDeg: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hueDeg: hue, saturation, lightness };
}

// Parse a strict lowercase #rrggbb into [0,1] channels, or null if it is not one.
function parseHex(input: string): { r: number; g: number; b: number } | null {
  if (!/^#[0-9a-f]{6}$/.test(input)) return null;
  const r = Number.parseInt(input.slice(1, 3), 16) / 255;
  const g = Number.parseInt(input.slice(3, 5), 16) / 255;
  const b = Number.parseInt(input.slice(5, 7), 16) / 255;
  return { r, g, b };
}

// Bucket an HSL hue into one of the 12 chromatic families. Buckets are centred on each
// family's angle, so red owns [345°, 15°): +15 then /30, mod 12.
function chromaticFamily(hueDeg: number): ColorFamily {
  const step = Math.floor(((hueDeg + 15) % 360) / 30) % CHROMATIC_BY_HUE_STEP.length;
  return CHROMATIC_BY_HUE_STEP[step]!;
}

// A REPRESENTATIVE display hex per family — the swatch the B1 quiz shows for each family.
//
// This is domain data, not UI styling: the family's canonical appearance lives with the
// family definition (one source), so the swatch quiz can render the 12 chromatic families
// from their own wheel positions rather than a scattered set of hand-picked RN color
// literals that could drift from the hue geometry `toColorFamily` buckets by. Chromatics
// are the centre hue of each 30° bucket at a fixed mid saturation/lightness; the 5 neutrals
// are fixed representative values (they are not derived from a single hue by construction).
//
// It is a DISPLAY approximation — a swatch is a hint of the family, not a colourimetric
// definition — consistent with the whole module's stated approximation contract.
function hslToHex(hueDeg: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hueDeg / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Fixed representative hexes for the 5 neutrals (not hue-derived by construction).
const NEUTRAL_SWATCH_HEX: Readonly<Record<'black' | 'white' | 'gray' | 'beige' | 'navy', string>> = {
  black: '#1a1a1a',
  white: '#f5f5f5',
  gray: '#9a9a9a',
  beige: '#e8dcc4',
  navy: '#1f2d5a',
};

export function familySwatchHex(family: ColorFamily): string {
  const step = CHROMATIC_BY_HUE_STEP.indexOf(family);
  if (step >= 0) return hslToHex(step * 30, 0.65, 0.5); // centre hue of the family's bucket
  return NEUTRAL_SWATCH_HEX[family as keyof typeof NEUTRAL_SWATCH_HEX];
}

// The whole seam. Total: every input yields a ColorFamily or null; never throws.
export function toColorFamily(input: string | null | undefined): ColorFamily | null {
  if (input === null || input === undefined) return null;
  // Already a family token (any of the 12 chromatic + 5 neutrals) → itself.
  if (isColorFamily(input)) return input;

  const rgb = parseHex(input);
  if (rgb === null) return null; // unknown colour name / malformed → no signal.

  const { hueDeg, saturation, lightness } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Low chroma OR near-black / near-white → achromatic neutral, split by lightness.
  if (saturation < NEUTRAL_SATURATION_CEILING || lightness < DARK_LIGHTNESS_CEILING || lightness > LIGHT_LIGHTNESS_FLOOR) {
    if (lightness < DARK_LIGHTNESS_CEILING) return 'black';
    if (lightness > LIGHT_LIGHTNESS_FLOOR) return 'white';
    return 'gray';
  }
  return chromaticFamily(hueDeg);
}
