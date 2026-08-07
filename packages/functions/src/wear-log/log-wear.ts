// Wear-log append (F8) — the moat's write side. One-tap "I wore this", idempotent
// under retry via the partial UNIQUE(user_id, client_id): the repo's single
// writable-CTE statement inserts ON CONFLICT DO NOTHING and returns the canonical
// row (new, or the pre-existing one on a retry), optionally flipping the worn item
// to 'dirty' atomically with the append. identity from ctx.userId, never the body.
//
// Flip channel (decision, task-12 §3): LogWearRequest is frozen + .strict(), so
// the flip toggle rides the URL query string (?flip=dirty), not the JSON body.
// Default OFF — logging a past wear must not surprise-dirty an item.
import { makeWearLogRepo } from '@closet/db';
import { LogWearRequest, WearLogRow, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';

function isForeignKeyViolation(thrown: unknown): boolean {
  return typeof thrown === 'object' && thrown !== null && (thrown as { code?: string }).code === '23503';
}

function wantsFlip(url: URL): boolean {
  return url.searchParams.get('flip') === 'dirty';
}

export const logWear: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body: unknown = await req.json();
    const request = parseBoundary(LogWearRequest, body, 'wear-log.append');
    const flipToDirty = wantsFlip(new URL(req.url));
    const row = await makeWearLogRepo(exec).appendWear({
      userId,
      itemId: request.item_id,
      outfitId: request.outfit_id ?? null,
      clientId: request.client_id,
      flipToDirty,
    });
    return jsonResponse(200, parseBoundary(WearLogRow, row, 'wear-log.append.result'));
  } catch (thrown) {
    if (isForeignKeyViolation(thrown)) {
      return errorResponse(400, 'invalid_reference', 'Item does not belong to the caller.');
    }
    return errorFromThrown(thrown);
  }
};
