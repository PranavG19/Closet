// Palette upsert (B1). Persists the swatch-quiz hue result 1:1 by PK user_id — a
// second upsert updates the single row in place. hues is opaque jsonb, stored and
// echoed verbatim (scoring is the on-device pure fn, not here). identity from
// ctx.userId, never the body.
import { makePaletteRepo } from '@closet/db';
import { UpsertPaletteRequest, PaletteProfileRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

export const upsertPalette: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body: unknown = await req.json();
    const request = parseBoundary(UpsertPaletteRequest, body, 'palette.upsert');
    const row = await makePaletteRepo(exec).upsert(userId, request.hues);
    return jsonResponse(200, parseBoundary(PaletteProfileRow, row, 'palette.upsert.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
