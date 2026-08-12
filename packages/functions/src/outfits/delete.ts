// Delete a saved outfit (F6). Identity is ctx.userId (verified sub), never the body — the
// request carries only the outfit id, so deleting another user's outfit is not representable,
// and RLS + the repo's `WHERE user_id` scope the delete regardless. Members cascade
// (outfit_items FK ON DELETE CASCADE, migration 0005).
//
// A non-existent or other-tenant id is `{ deleted: false }`, a 200 — NOT a 404. RLS makes
// "yours but already gone" and "not yours" indistinguishable, and neither should leak whether
// the row exists; a benign no-op is the honest answer for both. Delete is idempotent: a retry
// after a successful delete is deleted:false, never a 500.
import { makeOutfitsRepo } from '@closet/db';
import { DeleteOutfitRequest, DeleteOutfitResult, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

// A missing/non-JSON body must be a 400, never a 500 (same rule + shape as create.ts):
// req.json() throws SyntaxError, not BoundaryParseError, so returning null lets parseBoundary
// raise the same clean 400 as any other bad shape.
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const deleteOutfit: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(DeleteOutfitRequest, body, 'outfits.delete');
    const deleted = await makeOutfitsRepo(exec).remove(userId, request.id);
    return jsonResponse(200, parseBoundary(DeleteOutfitResult, { deleted }, 'outfits.delete.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
