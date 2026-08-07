// AIVisionPort — garment ATTRIBUTE extraction (docs/06 §5). A vision vendor sits
// behind this port; it is A/B-swappable without touching callers. No vendor
// request/response type appears here — only Zod-validated attributes cross.
import { z } from 'zod';

// Colors feed the palette pipeline, so they are represented as documented tokens
// (lowercase 6-digit hex, `#rrggbb`) — never a numeric cast that could leak.
const HexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'expected lowercase #rrggbb hex color');

export const GarmentCategory = z.enum([
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
]);
export type GarmentCategory = z.infer<typeof GarmentCategory>;

export const GarmentPattern = z.enum([
  'solid',
  'striped',
  'checked',
  'floral',
  'graphic',
  'other',
]);
export type GarmentPattern = z.infer<typeof GarmentPattern>;

export const GarmentFormality = z.enum(['casual', 'smart-casual', 'formal']);
export type GarmentFormality = z.infer<typeof GarmentFormality>;

export const GarmentSeason = z.enum(['spring', 'summer', 'autumn', 'winter', 'all-season']);
export type GarmentSeason = z.infer<typeof GarmentSeason>;

export const AIVisionResultSchema = z.object({
  category: GarmentCategory,
  primaryColor: HexColor,
  // present-and-empty when there is no secondary color (never undefined-collapsed).
  secondaryColors: z.array(HexColor),
  material: z.string(),
  pattern: GarmentPattern,
  formality: GarmentFormality,
  season: GarmentSeason,
});
export type AIVisionResult = z.infer<typeof AIVisionResultSchema>;

// Port-owned input — no vendor type. An approved image already in Storage.
export interface AIVisionInput {
  readonly imageUrl: string;
}

export interface AIVisionPort {
  extractAttributes(input: AIVisionInput): Promise<AIVisionResult>;
}
