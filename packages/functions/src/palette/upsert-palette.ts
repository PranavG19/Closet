// Palette upsert (B1). Persists the swatch-quiz hue result 1:1 by PK user_id — a
// second upsert updates the single row in place. hues is opaque jsonb, stored and
// echoed verbatim (scoring is the on-device pure fn, not here). identity from
// ctx.userId, never the body.
import { makePaletteRepo } from '@closet/db';
import { UpsertPaletteRequest, PaletteProfileRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

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

export const upsertPalette: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(UpsertPaletteRequest, body, 'palette.upsert');
    const row = await makePaletteRepo(exec).upsert(userId, request.hues);
    return jsonResponse(200, parseBoundary(PaletteProfileRow, row, 'palette.upsert.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
