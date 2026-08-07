// Account deletion (Apple App Store Review Guideline 5.1.1(v): an app that offers
// account creation MUST offer in-app account deletion — a hard submission blocker).
// PERMANENT purge of every row belonging to the caller, in FK-safe order, via the
// SECURITY DEFINER public.delete_my_account() fn (migration 0014).
//
// Identity is ctx.userId / auth.uid() and NOTHING else: the repo call takes no user
// id and the SQL function's signature takes zero arguments, so a body-smuggled
// `user_id` has no path to reach the purge — it cannot target another tenant even in
// principle. (It is also rejected outright: the request schema is .strict().)
//
// The explicit `confirm: 'DELETE'` literal is the misfire guard. This endpoint is
// irreversible, so a stray/retried POST with an empty or malformed body must be a
// 400 that deletes nothing rather than an accidental account wipe.
//
// Logging: counts only, keyed on correlationId. Never the user id, never a photo
// path, never a raw error — this is the most PII-adjacent endpoint in the app and it
// runs at the exact moment she asked us to forget her.
//
// NOT done here (deploy-wired, service_role — see 0014's header): the Storage bytes
// in the originals/cutouts buckets and the Supabase auth.users identity record. A
// user-JWT function has no authority over either; this handler purges the rows.
import { makeAccountRepo } from '@closet/db';
import { parseBoundary } from '@closet/shared';
import { z } from 'zod';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';
import { logger } from '../auth/logger.js';

// .strict() so an unexpected key (notably a smuggled `user_id`) is a 400, not a
// silently-ignored field. The literal makes an empty `{}` unrepresentable as intent.
export const DeleteAccountRequest = z
  .object({
    confirm: z.literal('DELETE'),
  })
  .strict();
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

const NonNegativeInt = z.number().int().nonnegative();

export const DeleteAccountResult = z.object({
  deleted: z.object({
    wear_log: NonNegativeInt,
    outfit_items: NonNegativeInt,
    outfits: NonNegativeInt,
    wardrobe_items: NonNegativeInt,
    parse_jobs: NonNegativeInt,
    palette_profile: NonNegativeInt,
    subscriptions: NonNegativeInt,
    total: NonNegativeInt,
  }),
});
export type DeleteAccountResult = z.infer<typeof DeleteAccountResult>;

// A missing/non-JSON body must be a 400 (the confirm guard), never a 500. Returning
// null lets parseBoundary produce the same BoundaryParseError as any bad shape.
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const deleteAccount: AuthedHandler = async (req, { exec, correlationId }) => {
  try {
    const body = await readJsonBody(req);
    // Throws BoundaryParseError -> 400 unless confirm is exactly 'DELETE'. The
    // literal IS the guard; there is no post-parse re-check to drift out of sync.
    parseBoundary(DeleteAccountRequest, body, 'account.delete');
    const deleted = await makeAccountRepo(exec).deleteMyAccount();
    const result = parseBoundary(DeleteAccountResult, { deleted }, 'account.delete.result');
    logger.info({
      correlationId,
      event: 'account.deleted',
      wearLog: result.deleted.wear_log,
      outfitItems: result.deleted.outfit_items,
      outfits: result.deleted.outfits,
      wardrobeItems: result.deleted.wardrobe_items,
      parseJobs: result.deleted.parse_jobs,
      paletteProfile: result.deleted.palette_profile,
      subscriptions: result.deleted.subscriptions,
      total: result.deleted.total,
    });
    return jsonResponse(200, result);
  } catch (thrown) {
    // Matches the revenuecat-webhook catch-all: record THAT it failed, keyed on the
    // correlationId, with no error text (PII rule). An irreversible endpoint that
    // 500s with zero trace is an operability hole.
    logger.error({ correlationId, event: 'account.delete_failed' });
    return errorFromThrown(thrown);
  }
};
