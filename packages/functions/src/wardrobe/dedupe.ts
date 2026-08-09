// Dedupe keep-one MERGE (F4, docs/06 §7). Re-points wear_log + outfit_items refs
// from the discarded item to the kept item, then deletes the now-unreferenced
// discard — as ONE atomic statement in the repo (the wear_log ON DELETE RESTRICT
// FK is checked at statement end, after re-pointing, so the wear-history moat is
// preserved, never cascaded away). merged=false (discard not owned / already gone)
// is an idempotent no-op returning 200, not an error — a retried resolution must
// not 500.
//
// why keep-both is not here: keep-both is a client-side dismissal — zero server
// state change — so it is deliberately unrepresentable on the server (no branch).
import { makeWardrobeRepo } from '@closet/db';
import { parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';
import { DedupeResolveRequest, DedupeResolveResult } from './schemas.js';

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

export const resolveDedupe: AuthedHandler = async (req, { userId, exec }) => {
  try {
    const body = await readJsonBody(req);
    const request = parseBoundary(DedupeResolveRequest, body, 'wardrobe.dedupe');
    const repo = makeWardrobeRepo(exec);
    const { merged } = await repo.mergeKeepOne(userId, {
      keepId: request.keep_id,
      discardId: request.discard_id,
    });
    return jsonResponse(200, parseBoundary(DedupeResolveResult, { merged }, 'wardrobe.dedupe.result'));
  } catch (thrown) {
    // The merge fn RAISEs 42501 when keep/discard is owned by another tenant (a
    // cross-tenant probe fails LOUD, never a silent no-op). Map that to 403 — the
    // caller referenced a garment that is not theirs. An absent-own discard is NOT
    // a raise (the fn returns false), so this only fires on a real cross-tenant ref.
    if (typeof thrown === 'object' && thrown !== null && (thrown as { code?: string }).code === '42501') {
      return errorResponse(403, 'forbidden', 'An item does not belong to the caller.');
    }
    return errorFromThrown(thrown);
  }
};
