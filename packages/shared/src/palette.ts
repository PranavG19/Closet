// B1 — self-identified palette scoring. ADVISORY ONLY: it ranks and annotates,
// it can never remove, hide, reorder-away, or block an item. The output has one
// annotation per input item, preserving every id. Pure: no I/O, no clock, no
// randomness, no mutation of arguments.
import { z } from 'zod';
import { parseBoundary } from './parse.js';
import { toColorFamily } from './colorFamily.js';
import { paletteAffinity, isColorFamily, type ColorFamily } from './harmony.js';

// Minimal item view palette scoring reads (an id and its color token, if any).
export const PaletteItemSchema = z.object({
  id: z.string(),
  color: z.string().nullable(),
});
export type PaletteItem = z.infer<typeof PaletteItemSchema>;

// The self-identified flattering-hue set (color tokens from the swatch quiz).
export const PaletteProfileSchema = z.object({
  hues: z.array(z.string()),
});
export type PaletteProfile = z.infer<typeof PaletteProfileSchema>;

export const ScorePaletteInputSchema = z.object({
  items: z.array(PaletteItemSchema),
  paletteProfile: PaletteProfileSchema,
});
export type ScorePaletteInput = z.infer<typeof ScorePaletteInputSchema>;

export interface PaletteAnnotation {
  readonly id: string;
  // A3: a GRADED affinity in [0,1] (hue-distance decay to the nearest chosen family), no
  // longer a binary 0/1. A garment one step off a chosen swatch scores high; its complement
  // scores ~0. Neutrals get a soft broad floor. This is what lets colour inform ranking as a
  // SOFT preference (suggestion.ts A4) rather than an all-or-nothing match.
  readonly score: number;
  // Kept a BOOLEAN and never a gate: true when the graded score clears WITHIN_PALETTE_THRESHOLD
  // (an exact or analogous match), so existing consumers reading withinPalette see the same
  // "is this a good colour match" signal. The threshold turns the continuous score into the
  // discrete label; it is advisory, nothing is dropped or blocked either way.
  readonly withinPalette: boolean;
}

// Score at/above which a garment is labelled withinPalette — 0.75 = exact (1.0) or one-step
// analogous (0.75). A [SOFT] cutpoint (tuning, not a colourimetric law): it admits the
// perceptually-close hues the binary version rejected while excluding distant ones. Adjust
// with taste; it only moves the boolean label, never eligibility.
const WITHIN_PALETTE_THRESHOLD = 0.75;

// One annotation per input item, in input order, every id preserved. Advisory:
// score/withinPalette are hints; nothing is dropped or blocked.
//
// Matching is by COLOR FAMILY, not raw string (D-003 Step 2). The first cut did
// `hueSet.has(item.color)` — a raw-string equality that was SILENTLY ALWAYS FALSE
// whenever items store a #rrggbb hex (from the vision adapter) while the swatch quiz
// stores family tokens: the two vocabularies never intersect, so `withinPalette` was a
// vacuous signal. Normalising BOTH sides through toColorFamily (hex or token → family)
// makes a hex item match a family the quiz selected. A colour that maps to null (an
// unmodelled name, malformed hex) is simply not within palette — no signal, never a
// throw, never a guess — which preserves the advisory-never-blocks contract unchanged.
export function scorePalette(input: unknown): PaletteAnnotation[] {
  const parsed = parseBoundary(ScorePaletteInputSchema, input, 'scorePalette');
  // Normalise the self-identified quiz hues to families once; a hue token that doesn't
  // map (should be rare — the quiz emits family tokens) contributes no match.
  const paletteFamilies: ColorFamily[] = parsed.paletteProfile.hues
    .map((hue) => toColorFamily(hue))
    .filter((f): f is ColorFamily => f !== null && isColorFamily(f));
  return parsed.items.map((item) => {
    const family = toColorFamily(item.color);
    // A3: graded hue-distance affinity to the nearest chosen family (0 when the item has no
    // family signal, or the palette is empty). withinPalette is the thresholded label.
    const score = family === null ? 0 : paletteAffinity(family, paletteFamilies);
    return { id: item.id, score, withinPalette: score >= WITHIN_PALETTE_THRESHOLD };
  });
}
