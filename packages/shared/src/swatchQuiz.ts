// B1 — the self-identified swatch quiz (docs/01 §B1). She picks the color families she
// feels flattering; the result is the `hues` array stored by upsertPalette and later read
// by scorePalette/suggestItems as the advisory palette tie-break.
//
// THE DEFINING CONSTRAINT (app invariant, docs/01 §B1 + docs/06): skin tone is
// SELF-IDENTIFIED, NEVER camera-detected, and the result is ADVISORY, never prescriptive.
// This module therefore does exactly one thing — turn a set of tapped swatches into a
// clean, validated family-token list — and deliberately does NOT infer a "season", judge
// her undertone, or derive anything she did not choose. There is no photo input here and
// there can never be one: the only input is what she tapped.
//
// Pure: no I/O, no clock, no randomness, no mutation of arguments.
import { COLOR_FAMILIES, isColorFamily, type ColorFamily } from './harmony.js';

// The swatches offered by the quiz, in a deliberate display order (chromatic families
// first as she'll reach for those, neutrals last). This is the SAME family vocabulary the
// palette scorer consumes, so a chosen swatch is guaranteed to match an item's normalised
// family — no vocabulary gap between what she picks and what gets matched.
export const SWATCH_FAMILIES: readonly ColorFamily[] = COLOR_FAMILIES;

// A completed quiz result: the flattering families she chose, ready to persist as `hues`.
export interface SwatchQuizResult {
  readonly hues: readonly ColorFamily[];
}

// Build the persisted palette from her tapped swatches.
//
// Order-independent and idempotent: the output is deduped and sorted into the canonical
// SWATCH_FAMILIES order, so the same choices always yield byte-identical `hues` regardless
// of tap order (a second identical quiz is a no-op upsert, not a reshuffle). Any token that
// is not a recognised family is dropped rather than trusted — the quiz UI only ever emits
// real families, but validating here means a malformed caller cannot poison the palette.
export function paletteFromSwatches(selected: readonly string[]): SwatchQuizResult {
  const chosen = new Set<ColorFamily>();
  for (const token of selected) {
    if (isColorFamily(token)) chosen.add(token);
  }
  // Canonical order = the SWATCH_FAMILIES order, so the stored array is deterministic.
  const hues = SWATCH_FAMILIES.filter((family) => chosen.has(family));
  return { hues };
}

// Whether a quiz result is substantive enough to save. An empty selection is not a palette
// — saving it would tell scorePalette "nothing is flattering", which is worse than having
// no palette at all (the heuristic falls back to no-color-signal cleanly when hues is
// absent). The screen uses this to gate the Save control.
export function isCompletePalette(result: SwatchQuizResult): boolean {
  return result.hues.length > 0;
}
