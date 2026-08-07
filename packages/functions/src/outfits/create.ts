// Create an outfit + its member items (F6). Idempotent via a client-minted id
// (D-001): a retry with the same id returns the same outfit and re-inserts no
// items. identity from ctx.userId, never the body. Composite FKs make a member
// item owned by another tenant a 23503 at write time (surfaced as a 400), never a
// silent cross-tenant link.
import { makeOutfitsRepo, makeOutfitItemsRepo } from '@closet/db';
import { CreateOutfitRequest, OutfitRow, OutfitItemRow, parseBoundary } from '@closet/shared';
import { z } from 'zod';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

// Response: the created outfit plus its members, both read back from the DB.
const CreateOutfitResult = z.object({
  outfit: OutfitRow,
  items: z.array(OutfitItemRow),
});

function isForeignKeyViolation(thrown: unknown): boolean {
  return typeof thrown === 'object' && thrown !== null && (thrown as { code?: string }).code === '23503';
}

export const createOutfit: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body: unknown = await req.json();
    const request = parseBoundary(CreateOutfitRequest, body, 'outfits.create');
    const outfitsRepo = makeOutfitsRepo(exec);
    const outfit = await outfitsRepo.createWithItems(userId, {
      ...(request.id !== undefined ? { id: request.id } : {}),
      name: request.name ?? null,
      items: request.items,
    });
    const items = await makeOutfitItemsRepo(exec).listByOutfit(userId, outfit.id);
    return jsonResponse(200, parseBoundary(CreateOutfitResult, { outfit, items }, 'outfits.create.result'));
  } catch (thrown) {
    if (isForeignKeyViolation(thrown)) {
      return errorResponse(400, 'invalid_reference', 'An item does not belong to the caller.');
    }
    return errorFromThrown(thrown);
  }
};
