// Create an outfit + its member items (F6). Idempotent via a client-minted id
// (D-001): a retry with the same id returns the same outfit and re-inserts no
// items. identity from ctx.userId, never the body. Composite FKs make a member
// item owned by another tenant a 23503 at write time (surfaced as a 400), never a
// silent cross-tenant link.
//
// Response is a BARE OutfitRow — the shape packages/mobile/src/api/client.ts parses
// (`parseBoundary(OutfitRow, res, 'createOutfit')`). It used to be a local
// `{ outfit, items }` envelope declared inline here, which no caller could be typed
// against, so the compiler could not see that the client disagreed: every successful
// create wrote the row, answered 200, and then threw client-side, reporting failure
// on a write that had actually landed. Returning the row the client already expects
// also removes the second repo call — that was a SECOND transaction, so the `items`
// it read came from a different snapshot than the one that wrote them and a
// concurrent dedupe merge could make the response disagree with the insert.
import { makeOutfitsRepo } from '@closet/db';
import { CreateOutfitRequest, OutfitRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

function isForeignKeyViolation(thrown: unknown): boolean {
  return typeof thrown === 'object' && thrown !== null && (thrown as { code?: string }).code === '23503';
}

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

export const createOutfit: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(CreateOutfitRequest, body, 'outfits.create');
    const outfitsRepo = makeOutfitsRepo(exec);
    const outfit = await outfitsRepo.createWithItems(userId, {
      ...(request.id !== undefined ? { id: request.id } : {}),
      name: request.name ?? null,
      items: request.items,
    });
    return jsonResponse(200, parseBoundary(OutfitRow, outfit, 'outfits.create.result'));
  } catch (thrown) {
    if (isForeignKeyViolation(thrown)) {
      return errorResponse(400, 'invalid_reference', 'An item does not belong to the caller.');
    }
    return errorFromThrown(thrown);
  }
};
