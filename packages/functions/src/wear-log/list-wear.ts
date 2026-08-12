// Wear-log read (F8/F5) — the moat's read side. Returns the caller's recent wear entries,
// newest first, server-clamped. identity from ctx.userId (the verified sub), never the query.
// RLS scopes wear_log to the caller, and the repo's WHERE user_id is belt-and-suspenders.
//
// This feeds the F5 suggestion's freshness tie-break (recentlyWornIds): the mobile screen reads
// recent entries, extracts their item_ids, and passes them so today's look isn't yesterday's
// exact pieces. A bare "recent wears" read, so it takes no filters — only an optional limit,
// clamped by the same clampLimit the wardrobe list uses.
import { clampLimit, makeWearLogRepo } from '@closet/db';
import { WearLogListResponse, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

export const listWear: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const url = new URL(req.url);
    const rawLimit = url.searchParams.get('limit');
    // Server clamp (load-bearing): an absent OR non-numeric limit becomes the repo default.
    // clampLimit maps a non-finite input to 1 (its floor), so a garbage `?limit=abc` must be
    // normalised to `undefined` FIRST — otherwise Number('abc')=NaN would clamp to 1, silently
    // returning a single row. This mirrors wardrobe/list.ts, which coerces via Zod to the same
    // effect. Never trust the client's number.
    const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
    const limit = clampLimit(Number.isFinite(parsedLimit) ? parsedLimit : undefined);
    const entries = await makeWearLogRepo(exec).listByUser(userId, { limit });
    return jsonResponse(200, parseBoundary(WearLogListResponse, { entries }, 'wear-log.list.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
