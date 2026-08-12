// List the caller's outfits (F6). RLS scopes every row to ctx.userId.
import { makeOutfitsRepo } from '@closet/db';
import { OutfitListResponse, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

export const listOutfits: AuthedHandler = async (_req, { userId, exec }) => {
  try {
    const outfits = await makeOutfitsRepo(exec).listWithCounts(userId);
    return jsonResponse(200, parseBoundary(OutfitListResponse, { outfits }, 'outfits.list.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
