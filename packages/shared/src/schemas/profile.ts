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
