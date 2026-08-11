// B1 — self-identified palette scoring. ADVISORY ONLY: it ranks and annotates,
// it can never remove, hide, reorder-away, or block an item. The output has one
// annotation per input item, preserving every id. Pure: no I/O, no clock, no
// randomness, no mutation of arguments.
import { z } from 'zod';
import { parseBoundary } from './parse.js';
import { toColorFamily } from './colorFamily.js';

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
  readonly score: number;
  readonly withinPalette: boolean;
}

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
  const paletteFamilies = new Set(
    parsed.paletteProfile.hues.map((hue) => toColorFamily(hue)).filter((f): f is NonNullable<typeof f> => f !== null),
  );
  return parsed.items.map((item) => {
    const family = toColorFamily(item.color);
    const withinPalette = family !== null && paletteFamilies.has(family);
    return { id: item.id, score: withinPalette ? 1 : 0, withinPalette };
  });
}
