// Rename a saved outfit (F6). Identity is ctx.userId (verified sub), never the body — the
// request carries only { id, name }, so renaming another user's outfit is not representable,
// and RLS + the repo's `WHERE user_id` scope the update regardless.
//
// A non-existent or other-tenant id → 404 not_found. Unlike delete (which is idempotent and
// returns a benign {deleted:false}), rename must return the UPDATED ROW so the client can
// reflect the new name + updated_at; there is no honest "renamed nothing" row to return, so a
// miss is a 404. The client only ever renames an outfit it just listed, so a 404 here means a
// genuine race (deleted elsewhere), not a routine case.
import { makeOutfitsRepo } from '@closet/db';
import { RenameOutfitRequest, OutfitRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const renameOutfit: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(RenameOutfitRequest, body, 'outfits.rename');
    const updated = await makeOutfitsRepo(exec).rename(userId, request.id, request.name);
    if (updated === null) {
      return errorResponse(404, 'not_found', 'No such outfit.');
    }
    return jsonResponse(200, parseBoundary(OutfitRow, updated, 'outfits.rename.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
