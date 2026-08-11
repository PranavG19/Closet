// The "why we suggested this" explanation for today's look (D-003 Step 4 + 5).
//
// The directive: the app must be CLEAR about why it suggests things and honest about the
// limits of that reasoning. suggestionNote() already gives the one-line color note; this
// gives the fuller, opt-in explanation a curious user can read — WHY these garments, and
// the honest caveats about what the color reasoning does and does not know.
//
// THREE HARD HONESTY CONSTRAINTS (docs/decisions/D-003 Step 5, from the risks list):
//   1. The palette is SELF-IDENTIFIED (the swatch quiz), never camera-detected. Copy must
//      never imply the app looked at her skin. Skin tone is advisory, never prescriptive.
//   2. Color families are APPROXIMATE — hue buckets only; value (light/dark) and chroma
//      (vividness) are NOT modeled. Copy must not imply scientific certainty.
//   3. It is ADVISORY. The heuristic never blocks or scolds a choice; a clash is silent
//      (docs/03 voice rule). So the rationale never says "don't" and never reports a clash.
//
// Pure: no I/O, no clock, no randomness. Returns an ordered list of plain sentences the
// screen renders as an explanation block; the caller decides presentation.
import type { HarmonyVerdict } from './harmony.js';

export interface RationaleInput {
  // How many clean garments the heuristic selected for the look.
  readonly selectedCount: number;
  // The color-harmony verdict of the selected set, or null when there was nothing to
  // compare (fewer than two garments with recognised colors). Same value suggestionNote
  // is derived from, passed in so the two explanations cannot disagree.
  readonly verdict: HarmonyVerdict | null;
  // Whether the user has completed the self-identified swatch quiz (B1). When true, the
  // palette tie-break was available to the ranking; when false, we say so plainly rather
  // than implying a palette we do not have.
  readonly hasPalette: boolean;
  // Whether the palette tie-break actually changed anything (an in-palette garment was
  // preferred over an equally-warm off-palette one). Advisory transparency: if it made no
  // difference, we do not claim it did.
  readonly paletteInfluencedOrder: boolean;
}

// The warmth/weather reason. The temperature is a fixed mild assumption today (there is no
// WeatherPort — docs/06 §9), so the copy is deliberately honest about that rather than
// implying we read the forecast.
const WEATHER_CAVEAT =
  'We pick warmer layers as it gets colder. Today assumes mild weather — we don’t read the forecast yet.';

// Why THESE colors sit together, per verdict. Mirrors suggestionNote's vocabulary but framed
// as a reason ("we suggested this because…") rather than a standalone note. A clash and a
// null verdict both yield no color reason — the outfit is still suggested, we just have
// nothing honest to say about its colors.
const COLOR_REASON: Readonly<Record<Exclude<HarmonyVerdict, 'clash'>, string>> = {
  monochromatic: 'These share one color family, so the look reads as one clean tone.',
  analogous: 'These colors sit next to each other on the wheel, which blends easily.',
  complementary: 'These are near-opposite hues, so the pairing has a little contrast.',
  triadic: 'These colors are spaced evenly around the wheel — a lively, balanced mix.',
  'split-complementary': 'These are near-opposite hues, softened — contrast that still plays well.',
  neutral: 'A neutral anchors the look, so it sits with everything else you own.',
};

// The self-identification + approximation honesty line, shown whenever color reasoning was
// used at all. Never implies detection, prescription, or scientific certainty.
const PALETTE_HONESTY =
  'Color guidance uses the palette you chose in the swatch quiz — it’s self-chosen, never taken from a photo, and it only nudges between otherwise-equal options.';
const FAMILY_APPROXIMATION =
  'We group colors into broad families by hue; we don’t judge exact shade or brightness, so treat this as a gentle hint, not a rule.';

// Build the ordered explanation sentences. Order: what drove the selection (weather/warmth),
// then the color reason if any, then the honesty caveats. Empty color/palette reasons are
// omitted rather than padded.
export function suggestionRationale(input: RationaleInput): readonly string[] {
  const lines: string[] = [];

  // 1. Why these garments were chosen at all: warmth-first selection under an assumed temp.
  lines.push(WEATHER_CAVEAT);

  // 2. Why the palette tie-break did (or did not) touch the order — only when she has one.
  if (input.hasPalette) {
    lines.push(
      input.paletteInfluencedOrder
        ? 'Between equally-suitable pieces, we leaned toward your palette colors.'
        : 'Your palette didn’t change today’s pick — the weather choice already decided it.',
    );
  }

  // 3. The color-harmony reason, when there is an honest one (≥2 known colors, not a clash).
  if (input.verdict !== null && input.verdict !== 'clash') {
    lines.push(COLOR_REASON[input.verdict]);
  }

  // 4. Honesty caveats — shown whenever ANY color reasoning was surfaced (a palette exists
  //    or a color verdict was stated), so the limits travel with the claim.
  const usedColorReasoning =
    input.hasPalette || (input.verdict !== null && input.verdict !== 'clash');
  if (usedColorReasoning) {
    lines.push(PALETTE_HONESTY);
    lines.push(FAMILY_APPROXIMATION);
  }

  return lines;
}
