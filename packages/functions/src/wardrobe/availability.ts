// Availability toggle (F7). Single-column UPDATE confined to the caller's row by
// RLS WITH CHECK + the user_id predicate. 0 rows (not owned / not found) → 404.
import { makeWardrobeRepo } from '@closet/db';
import { UpdateAvailabilityRequest, WardrobeItemRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

// A missing/non-JSON body must be a 400, never a 500 (same rule + shape as
// account/delete-account.ts): req.json() throws SyntaxError, NOT BoundaryParseError,
// so errorFromThrown would map it to 500 — and a 5xx tells the client the SERVER is
// at fault and the request is worth retrying, when this body will never parse.
// Returning null lets parseBoundary raise the same 400 as any other bad shape.
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const toggleAvailability: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(UpdateAvailabilityRequest, body, 'wardrobe.availability');
    const repo = makeWardrobeRepo(exec);
    const row = await repo.setAvailability(userId, request.item_id, request.availability);
    if (!row) return errorResponse(404, 'not_found', 'Item not found.');
    return jsonResponse(200, parseBoundary(WardrobeItemRow, row, 'wardrobe.availability.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
