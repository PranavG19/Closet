// B1 — self-identified palette scoring. ADVISORY ONLY: it ranks and annotates,
// it can never remove, hide, reorder-away, or block an item. The output has one
// annotation per input item, preserving every id. Pure: no I/O, no clock, no
// randomness, no mutation of arguments.
import { z } from 'zod';
import { parseBoundary } from './parse.js';

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
export function scorePalette(input: unknown): PaletteAnnotation[] {
  const parsed = parseBoundary(ScorePaletteInputSchema, input, 'scorePalette');
  const hueSet = new Set(parsed.paletteProfile.hues);
  return parsed.items.map((item) => {
    const withinPalette = item.color !== null && hueSet.has(item.color);
    return { id: item.id, score: withinPalette ? 1 : 0, withinPalette };
  });
}
