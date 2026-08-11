// Local boundary schemas for the wardrobe endpoint (task-10 §2 decision). The
// list-query request, the keyset cursor, the paginated list response, and the
// dedupe-resolve request/response are NOT in @closet/shared (W2 is frozen and
// one-writer-owned), so they are defined here, built on the reused shared
// primitives. Do NOT add these to packages/shared.
import { z } from 'zod';
import { Uuid, Timestamptz, WardrobeItemRow, WardrobeCategory, Availability } from '@closet/shared';

// The list-query request. `limit` is advisory — the handler clamps it regardless.
export const ListWardrobeRequest = z
  .object({
    category: WardrobeCategory.optional(),
    color: z.string().optional(),
    availability: Availability.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type ListWardrobeRequest = z.infer<typeof ListWardrobeRequest>;

// The decoded keyset position. Encoded as opaque base64 on the wire; decoded via
// parseBoundarySafe — a cursor that fails to parse is a 400, never a silent scan.
export const WardrobeCursor = z
  .object({
    created_at: Timestamptz,
    id: Uuid,
  })
  .strict();
export type WardrobeCursor = z.infer<typeof WardrobeCursor>;

export const WardrobeListResult = z.object({
  items: z.array(WardrobeItemRow),
  // non-null iff a full clamped page was returned (there may be more).
  next_cursor: z.string().nullable(),
});
export type WardrobeListResult = z.infer<typeof WardrobeListResult>;

// keep-one is the only server operation; keep-both is a client-side no-op that
// never reaches this endpoint. Reject keep_id === discard_id (a self-merge would
// delete a referenced item).
export const DedupeResolveRequest = z
  .object({
    keep_id: Uuid,
    discard_id: Uuid,
  })
  .strict()
  .refine((v) => v.keep_id !== v.discard_id, {
    message: 'keep_id and discard_id must differ',
  });
export type DedupeResolveRequest = z.infer<typeof DedupeResolveRequest>;

export const DedupeResolveResult = z.object({ merged: z.boolean() });
export type DedupeResolveResult = z.infer<typeof DedupeResolveResult>;

// Opaque cursor codec — base64 of the JSON keyset position. Deno + Node both
// expose the WHATWG btoa/atob globals.
export function encodeCursor(position: WardrobeCursor): string {
  return (globalThis as { btoa(s: string): string }).btoa(JSON.stringify(position));
}

export function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse((globalThis as { atob(s: string): string }).atob(cursor));
  } catch {
    return null;
  }
}
