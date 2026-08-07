// Row + request/response schemas for outfits, outfit_items, wear_log (docs/06 §3).
import { z } from 'zod';
import { Uuid, Timestamptz } from './common.js';

export const OutfitRow = z.object({
  id: Uuid,
  user_id: Uuid,
  name: z.string().nullable(),
  created_at: Timestamptz,
  updated_at: Timestamptz,
});
export type OutfitRow = z.infer<typeof OutfitRow>;

export const OutfitItemRow = z.object({
  id: Uuid,
  outfit_id: Uuid,
  user_id: Uuid,
  item_id: Uuid,
  slot: z.string().nullable(),
  // int column; small, safe integer — no ::float cast needed.
  position: z.number().int().nullable(),
});
export type OutfitItemRow = z.infer<typeof OutfitItemRow>;

// wear_log is append-only (no updated_at column, docs/06 §3).
export const WearLogRow = z.object({
  id: Uuid,
  user_id: Uuid,
  item_id: Uuid,
  outfit_id: Uuid.nullable(),
  worn_at: Timestamptz,
  client_id: z.string(),
});
export type WearLogRow = z.infer<typeof WearLogRow>;

// An outfit_item as supplied on create — no id/user_id (user_id is ctx.userId).
export const OutfitItemInput = z
  .object({
    item_id: Uuid,
    slot: z.string().nullable().optional(),
    position: z.number().int().nullable().optional(),
  })
  .strict();
export type OutfitItemInput = z.infer<typeof OutfitItemInput>;

export const CreateOutfitRequest = z
  .object({
    // Client-minted outfit id for idempotent create (D-001): a retry with the same
    // id resolves onto the same row via UNIQUE(user_id, id) — no client_id column.
    id: Uuid.optional(),
    name: z.string().nullable().optional(),
    items: z.array(OutfitItemInput),
  })
  .strict();
export type CreateOutfitRequest = z.infer<typeof CreateOutfitRequest>;

// F8 daily wear log. client_id minted by the caller at tap time (idempotency).
export const LogWearRequest = z
  .object({
    item_id: Uuid,
    outfit_id: Uuid.nullable().optional(),
    client_id: z.string(),
  })
  .strict();
export type LogWearRequest = z.infer<typeof LogWearRequest>;

export const OutfitListResponse = z.object({
  outfits: z.array(OutfitRow),
});
export type OutfitListResponse = z.infer<typeof OutfitListResponse>;
