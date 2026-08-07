// parse-photo — the make-or-break endpoint (docs/06 §4). Four ordered moves over
// the repo seam (this handler writes ZERO SQL — repos-only), guarded by the two
// money-adjacent server guarantees: the entitlement gate on kind='full' and the
// hard per-user teaser cap. Idempotent + resumable with no queue/worker: a photo
// re-submitted after a crash makes NO duplicate garments (commit's delete-partial
// + the per-photo idempotency key), and two concurrent invocations produce ONE
// winner (the atomic claim), never a double-charge to the paid providers.
//
// Identity is ALWAYS ctx.userId (the verified JWT sub) — the request body carries
// no user_id (.strict() rejects it). The handler opens no connection, sets no
// role, holds no service_role: RLS confines every write to the caller (docs/06 §4).
import { makeParseJobsRepo, makeSubscriptionsRepo, type CommitItemInput } from '@closet/db';
import {
  CreateParseJobRequest,
  ParseJobRow,
  WardrobeItemRow,
  parseBoundary,
  type AIVisionPort,
  type AIVisionResult,
  type CutoutPort,
  type CutoutResult,
} from '@closet/shared';
import { z } from 'zod';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';
import { logger } from '../auth/logger.js';
import { makeProviderPorts } from '../adapters/index.js';
import { TEASER_JOB_CAP } from './teaser-cap.js';

// Success body — composed from the shared row schemas (no new row schema authored;
// this task cannot touch @closet/shared). parseBoundary validates it on the way
// out, so the response is parse-don't-cast like every other boundary. A shared
// ParseResultResponse would be preferable if a second consumer appears — see the
// task's follow-up note; kept local because it has exactly one caller today.
export const ParseResultResponse = z.object({
  job: ParseJobRow,
  items: z.array(WardrobeItemRow),
});
export type ParseResultResponse = z.infer<typeof ParseResultResponse>;

// Fixed, non-PII failure reason persisted on the job + logged. NEVER the raw
// provider message or image bytes (PII rule) — a provider fault is a fixed code.
const PROVIDER_FAILURE_REASON = 'provider_failed';

// The two paid providers, injected so the integration oracle can substitute
// deterministic fakes with an observable call counter (the double-charge guard).
export interface ParsePorts {
  readonly vision: AIVisionPort;
  readonly cutout: CutoutPort;
}

// The cutout port must upload bytes AS THE CALLER (Storage RLS binds auth.uid()), so
// the provider is handed the caller's verified token to build that port with. A test
// fake ignores the argument — `() => fakePorts` stays assignable.
export interface PortsRequestContext {
  readonly accessToken: string;
}
export type ProvidePorts = (ctx: PortsRequestContext) => ParsePorts;

// Map the Zod-validated provider results into a single garment row. phash is
// on-device-only and stays null on the server path (the repo omits it).
function toItem(vision: AIVisionResult, cutout: CutoutResult): CommitItemInput {
  return {
    category: vision.category,
    color: vision.primaryColor,
    pattern: vision.pattern,
    attributes: {
      secondaryColors: vision.secondaryColors,
      material: vision.material,
      formality: vision.formality,
      season: vision.season,
    },
    cutout_path: cutout.imageUrl,
  };
}

// The handler is built over a port provider so the test injects fakes. The
// exported `parsePhoto` binds the production provider; a test builds its own via
// makeParsePhoto(fakeProvider) — the SAME code path, only the ports differ.
export function makeParsePhoto(providePorts: ProvidePorts): AuthedHandler {
  return async (req, { userId, exec, correlationId, accessToken }) => {
    try {
      const body: unknown = await req.json();
      const request = parseBoundary(CreateParseJobRequest, body, 'parse.request');

      const parseJobs = makeParseJobsRepo(exec);
      const subscriptions = makeSubscriptionsRepo(exec);

      // 1. Entitlement gate FIRST for kind='full' — before any job row, claim, or
      //    provider call. A missing/false entitlement is 402 and nothing else.
      //    (getEntitlement returns the not-entitled default for a missing row, so
      //    entitlement_active !== true is the single money-gate comparison.)
      if (request.kind === 'full') {
        const { entitlement_active } = await subscriptions.getEntitlement(userId);
        if (entitlement_active !== true) {
          return errorResponse(402, 'entitlement_required', 'An active subscription is required for a full parse.');
        }
      }

      // 2. Idempotent job resolve + atomic teaser cap (teaser only, inside the
      //    repo's per-user advisory-locked fn). A new teaser photo past the cap is
      //    refused; an already-submitted hash lands on its existing row (no charge).
      const resolved = await parseJobs.resolveJob(
        userId,
        {
          source_photo_hash: request.source_photo_hash,
          source_photo_path: request.source_photo_path,
          kind: request.kind,
        },
        TEASER_JOB_CAP,
      );
      if (resolved.outcome === 'cap_reached') {
        return errorResponse(402, 'teaser_cap_reached', 'The teaser parse limit has been reached.');
      }
      const job = resolved.job;

      // 3. Already-done short-circuit — idempotent replay. No re-claim, no provider
      //    call, no double-charge; return the existing items for this job.
      if (job.status === 'done') {
        const items = await parseJobs.listItemsByJob(userId, job.id);
        return jsonResponse(200, parseBoundary(ParseResultResponse, { job, items }, 'parse.result.replay'));
      }

      // 4. Atomic claim — proceed ONLY on the single-winner UPDATE (null = lost race
      //    / a live lease held). The loser never reprocesses.
      const claimed = await parseJobs.claim(userId, job.id);
      if (claimed === null) {
        return errorResponse(409, 'parse_already_in_progress', 'This photo is already being parsed.');
      }

      // 5. Provider calls — ONLY after a successful claim (so a lost race can never
      //    double-charge). A throw/timeout marks the job failed with a FIXED non-PII
      //    reason and 502s; because claim allows status IN (pending,failed) and
      //    commit deletes partials first, a later resubmit cleanly reprocesses.
      let items: readonly CommitItemInput[];
      try {
        const ports = providePorts({ accessToken });
        const vision = await ports.vision.extractAttributes({ imageUrl: claimed.source_photo_path });
        // userId is the verified JWT sub and claimed.id is the row THIS request won
        // the claim on — the cutout's Storage path is composed from these (never from
        // the request body), so it lands under the caller's own RLS-permitted prefix.
        const cutout = await ports.cutout.removeBackground({
          imageUrl: claimed.source_photo_path,
          userId,
          parseJobId: claimed.id,
        });
        items = [toItem(vision, cutout)];
      } catch {
        await parseJobs.markFailed(userId, claimed.id, PROVIDER_FAILURE_REASON);
        logger.error({ correlationId, event: 'parse.provider_failed', jobId: claimed.id });
        return errorResponse(502, 'parse_provider_failed', 'The parse provider is temporarily unavailable.');
      }

      // 6. Atomic commit — single delete-partial-then-insert CTE, then status='done'.
      await parseJobs.commit(userId, claimed.id, items);
      const persisted = await parseJobs.listItemsByJob(userId, claimed.id);
      const doneJob: ParseJobRow = { ...claimed, status: 'done' };
      return jsonResponse(200, parseBoundary(ParseResultResponse, { job: doneJob, items: persisted }, 'parse.result'));
    } catch (thrown) {
      return errorFromThrown(thrown);
    }
  };
}

// Production port provider. makeProviderPorts builds the REAL GPT-4o / Photoroom
// adapters (secret handling via requireEnv, per-call timeout + bounded retry,
// parse-don't-cast at the vendor boundary) with the cutout wired to the REAL Supabase
// Storage writer, uploading as the caller so Storage RLS confines the write. A
// missing key or a garbage vendor payload throws on the provider call, surfacing as
// the req-9 failure path (502 parse_provider_failed) rather than untyped data into
// the domain (docs/06 §5).
export const parsePhoto: AuthedHandler = makeParsePhoto(makeProviderPorts);
