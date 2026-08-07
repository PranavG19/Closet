// Response schemas for endpoints whose result shape is defined in @closet/functions
// (which mobile MUST NOT import — mobile imports @closet/shared only). Rather than
// import across that boundary or `as`-cast, these mirror the endpoint's response on
// top of shared primitives — the same pattern packages/functions uses for its own
// local boundary schemas. If an endpoint's response shape changes, update it here.
// Every field is a shared schema, so the row contracts stay in one place.
import { z } from 'zod';
import { WardrobeItemRow, ParseJobRow } from '@closet/shared';

// `wardrobe` list: items + an opaque keyset cursor (non-null iff more pages).
// (@closet/shared's WardrobeListResponse omits next_cursor; the endpoint returns
// it, so the client parses this fuller shape to keep pagination.)
export const WardrobeListResult = z.object({
  items: z.array(WardrobeItemRow),
  next_cursor: z.string().nullable(),
});
export type WardrobeListResult = z.infer<typeof WardrobeListResult>;

// `wardrobe/dedupe` keep-one merge result. merged=false is an idempotent no-op.
export const DedupeResolveResult = z.object({ merged: z.boolean() });
export type DedupeResolveResult = z.infer<typeof DedupeResolveResult>;

// `parse-photo` result: the advanced job + the items it produced.
export const ParseResultResponse = z.object({
  job: ParseJobRow,
  items: z.array(WardrobeItemRow),
});
export type ParseResultResponse = z.infer<typeof ParseResultResponse>;
