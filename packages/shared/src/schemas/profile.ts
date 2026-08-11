// Row + request/response schemas for palette_profile (docs/06 §3).
// palette_profile is keyed by user_id (1:1); no separate id/created_at/updated_at
// column set in docs/06 §3 beyond the hue-set result.
import { z } from 'zod';
import { Uuid, Json } from './common.js';

export const PaletteProfileRow = z.object({
  user_id: Uuid,
  // the flattering-hue result; jsonb, its internal shape decoupled from derivation.
  hues: Json,
});
export type PaletteProfileRow = z.infer<typeof PaletteProfileRow>;

// B1: upsert the swatch-quiz result. No user_id (comes from ctx.userId).
export const UpsertPaletteRequest = z
  .object({
    hues: Json,
  })
  .strict();
export type UpsertPaletteRequest = z.infer<typeof UpsertPaletteRequest>;

// B1: the palette READ, for the daily suggestion tie-break. Unlike the stored row's
// opaque `hues: Json`, the read response NORMALISES to a string[] of family tokens — the
// exact shape suggestItems' `paletteFamilies` and scorePalette consume — so the client
// never has to interpret arbitrary jsonb. An ABSENT palette (she has not taken the quiz)
// is `{ hues: [] }` with a 200, never a 404: the UI treats empty-as-no-palette, exactly
// like read-entitlement treats an absent money row as not-entitled. Any stored hue that is
// not a string is dropped here (the quiz only ever writes string tokens; this is defensive
// against a hand-written or legacy row), so the client always gets a clean string[].
export const PaletteReadResponse = z.object({
  hues: z.array(z.string()),
});
export type PaletteReadResponse = z.infer<typeof PaletteReadResponse>;
