// Availability toggle (F7). Single-column UPDATE confined to the caller's row by
// RLS WITH CHECK + the user_id predicate. 0 rows (not owned / not found) → 404.
import { makeWardrobeRepo } from '@closet/db';
import { UpdateAvailabilityRequest, WardrobeItemRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

export const toggleAvailability: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body: unknown = await req.json();
    const request = parseBoundary(UpdateAvailabilityRequest, body, 'wardrobe.availability');
    const repo = makeWardrobeRepo(exec);
    const row = await repo.setAvailability(userId, request.item_id, request.availability);
    if (!row) return errorResponse(404, 'not_found', 'Item not found.');
    return jsonResponse(200, parseBoundary(WardrobeItemRow, row, 'wardrobe.availability.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
