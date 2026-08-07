// Data export — GDPR Art. 15 / CCPA right of access. Returns ONE JSON document
// containing every row the caller owns across the six user-facing tenant tables
// plus their money row.
//
// Identity is ctx.userId (the verified JWT sub) and nothing else: there is no
// user_id parameter on this endpoint, so "export someone else's data" is not a
// representable request. Underneath, the repo runs as plain app_user under RLS
// FORCE — the tenant scope is enforced by the database, not by this handler.
//
// The OUTBOUND payload is parsed through ExportDocument before it goes on the wire
// (parse-don't-cast in the egress direction): a projection drift that produced a raw
// timestamptz ("2026-08-07 12:00:00+00", space instead of "T") or a phash silently
// widened to a lossy JS number fails the parse and 500s rather than shipping a
// malformed subject-access response. It also means a mis-shaped row can never be
// laundered into the document by an `as` cast.
//
// DOCUMENTED LIMITATION — Storage BYTES are NOT included. The original photos and
// garment cutouts live as client-direct Supabase Storage objects, not in Postgres.
// This document carries their PATHS (parse_jobs.source_photo_path,
// wardrobe_items.cutout_path); fetching the actual image bytes is a client/deploy
// step that walks those paths against Storage with the caller's own token. A
// complete Art. 15 response therefore = this JSON document + the objects at those
// paths. Streaming multi-megabyte binaries through an Edge function response would
// blow the response-size and memory envelope, and the client already holds Storage
// credentials scoped to its own prefix, so the fetch belongs there.
import { makeExportRepo } from '@closet/db';
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
  parseBoundary,
} from '@closet/shared';
import { z } from 'zod';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

// Composed from the FROZEN @closet/shared row schemas — no row schema is authored
// here. This is the envelope only. Not .strict(): the row schemas own their own
// shape, and the envelope keys are minted by this handler.
export const ExportDocument = z.object({
  exported_at: Timestamptz,
  user_id: Uuid,
  wardrobe_items: z.array(WardrobeItemRow),
  parse_jobs: z.array(ParseJobRow),
  outfits: z.array(OutfitRow),
  outfit_items: z.array(OutfitItemRow),
  wear_log: z.array(WearLogRow),
  // 1:1 tables: null is a legitimate value for a user who never took the quiz /
  // never subscribed. Absent-as-null, never a 404 and never an omitted key.
  palette_profile: PaletteProfileRow.nullable(),
  subscription: SubscriptionRow.nullable(),
});
export type ExportDocument = z.infer<typeof ExportDocument>;

export const exportData: AuthedHandler = async (_req, { userId, exec }) => {
  try {
    const owned = await makeExportRepo(exec).exportMyData(userId);
    const document = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      ...owned,
    };
    return jsonResponse(200, parseBoundary(ExportDocument, document, 'account.export.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
