// List / filter wardrobe items (F4). Keyset-paginated on (user_id, created_at, id),
// server-clamped — the clamp is a server guarantee, not a client courtesy. identity
// from ctx.userId (the verified sub), never the body/query.
import { clampLimit, makeWardrobeRepo } from '@closet/db';
import { parseBoundary, parseBoundarySafe } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';
import {
  ListWardrobeRequest,
  WardrobeCursor,
  WardrobeListResult,
  encodeCursor,
  decodeCursor,
} from './schemas.js';

function queryToObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) out[key] = value;
  return out;
}

export const listWardrobe: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const url = new URL(req.url);
    const request = parseBoundary(ListWardrobeRequest, queryToObject(url), 'wardrobe.list.query');

    // Server clamp (load-bearing): never trust the client's limit. This is the SAME
    // clampLimit the repo applies, so the `limit` used for the next_cursor decision below
    // cannot drift from the LIMIT the query actually ran — clamping twice against two
    // independently-declared caps is how the handler silently truncates a raised cap.
    const limit = clampLimit(request.limit);

    let cursor: { createdAt: string; id: string } | undefined;
    if (request.cursor !== undefined) {
      const decoded = parseBoundarySafe(WardrobeCursor, decodeCursor(request.cursor), 'wardrobe.cursor');
      if (!decoded.ok) return errorResponse(400, 'invalid_cursor', 'Malformed pagination cursor.');
      cursor = { createdAt: decoded.value.created_at, id: decoded.value.id };
    }

    const repo = makeWardrobeRepo(exec);
    const items = await repo.listByUser(userId, {
      ...(request.category !== undefined ? { category: request.category } : {}),
      ...(request.color !== undefined ? { color: request.color } : {}),
      ...(request.availability !== undefined ? { availability: request.availability } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit,
    });

    const last = items[items.length - 1];
    const next_cursor =
      items.length === limit && last
        ? encodeCursor({ created_at: last.created_at, id: last.id })
        : null;

    return jsonResponse(200, parseBoundary(WardrobeListResult, { items, next_cursor }, 'wardrobe.list.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
