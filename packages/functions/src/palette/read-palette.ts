// Palette read (B1) — the daily suggestion's advisory colour tie-break input. Read-only on
// palette_profile (app_user has SELECT; the only write path is upsert-palette). An ABSENT
// palette row means "she hasn't taken the swatch quiz": return { hues: [] } with 200, never
// a 404 — the UI treats empty-as-no-palette, exactly like read-entitlement treats an absent
// money row as not-entitled. identity from ctx.userId, never the body.
//
// The stored `hues` is opaque jsonb; this normalises it to the string[] of family tokens
// that suggestItems/scorePalette consume, dropping any non-string entry defensively (the
// quiz only ever writes string tokens — this guards a hand-written or legacy row).
import { makePaletteRepo } from '@closet/db';
import { PaletteReadResponse, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

export const readPalette: AuthedHandler = async (_req, { userId, exec }) => {
  try {
    const row = await makePaletteRepo(exec).getByUser(userId);
    const rawHues = row?.hues;
    // Normalise opaque jsonb → string[]. Absent row or non-array → [] (no palette signal).
    const hues = Array.isArray(rawHues) ? rawHues.filter((h): h is string => typeof h === 'string') : [];
    return jsonResponse(200, parseBoundary(PaletteReadResponse, { hues }, 'palette.read.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
