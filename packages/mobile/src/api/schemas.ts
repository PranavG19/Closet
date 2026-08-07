// Response schemas for endpoints whose result shape is defined in @closet/functions
// (which mobile MUST NOT import — mobile imports @closet/shared only). Rather than
// import across that boundary or `as`-cast, these mirror the endpoint's response on
// top of shared primitives — the same pattern packages/functions uses for its own
// local boundary schemas. If an endpoint's response shape changes, update it here.
// Every field is a shared schema, so the row contracts stay in one place.
import { z } from 'zod';
import {
  WardrobeItemRow,
  ParseJobRow,
  OutfitRow,
  OutfitItemRow,
  WearLogRow,
  PaletteProfileRow,
  SubscriptionRow,
  Uuid,
  Timestamptz,
} from '@closet/shared';

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

// `account-delete` request. Mirrors DeleteAccountRequest in
// packages/functions/src/account/delete-account.ts (mobile cannot import it). The
// z.literal('DELETE') IS the misfire guard, mirrored on the CLIENT side too: a
// wrong/blank confirmation cannot even be serialized onto the wire, so a stray tap
// never reaches the irreversible endpoint. .strict() so a smuggled `user_id` is
// rejected here as well as server-side.
export const DeleteAccountRequest = z.object({ confirm: z.literal('DELETE') }).strict();
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

const NonNegativeInt = z.number().int().nonnegative();

// `account-delete` response: the per-table purge counts. Parsed (not cast) so the
// receipt shown after an IRREVERSIBLE action is a real server count, never a
// hopeful assumption that it worked.
export const DeleteAccountResult = z.object({
  deleted: z.object({
    wear_log: NonNegativeInt,
    outfit_items: NonNegativeInt,
    outfits: NonNegativeInt,
    wardrobe_items: NonNegativeInt,
    parse_jobs: NonNegativeInt,
    palette_profile: NonNegativeInt,
    subscriptions: NonNegativeInt,
    total: NonNegativeInt,
  }),
});
export type DeleteAccountResult = z.infer<typeof DeleteAccountResult>;

// `account-export` response — the subject-access document. Mirrors ExportDocument
// in packages/functions/src/account/export-data.ts, composed from the SAME frozen
// @closet/shared row schemas, so a projection drift on either side fails the parse
// rather than shipping a malformed export.
//
// Storage BYTES are not in here by design (see that handler's header): the document
// carries the PATHS (parse_jobs.source_photo_path, wardrobe_items.cutout_path) and
// walking them against Storage is a separate client step.
export const ExportDocument = z.object({
  exported_at: Timestamptz,
  user_id: Uuid,
  wardrobe_items: z.array(WardrobeItemRow),
  parse_jobs: z.array(ParseJobRow),
  outfits: z.array(OutfitRow),
  outfit_items: z.array(OutfitItemRow),
  wear_log: z.array(WearLogRow),
  palette_profile: PaletteProfileRow.nullable(),
  subscription: SubscriptionRow.nullable(),
});
export type ExportDocument = z.infer<typeof ExportDocument>;
