// revenuecat-webhook — the SOLE writer of subscriptions.entitlement_active (the
// money table; parse-photo only READS it). This is a server-to-server webhook:
// there is NO end-user in the request, so it does NOT use withAuth/serveAuthed
// (those verify a user JWT via JWKS). It authenticates a shared secret, maps the
// event type to an entitlement state, then dedups-and-writes in ONE transaction under
// a service_role executor (RLS-exempt system job). The three hard invariants
// (docs/06 §4):
//   1. Replay-safe — RevenueCat retries the same event id; a replay is a 200 no-op
//      that writes nothing new (outcome 'duplicate' → short-circuit).
//   2. Monotonic — a late-arriving OLDER event must NOT revoke a NEWER entitlement.
//      The `DO UPDATE ... WHERE excluded.event_ts >= existing.event_ts` guard
//      enforces this, so the handler passes the REAL event timestamp (never now())
//      — otherwise the guard cannot bite.
//   3. Retryable — dedup and the entitlement write share ONE transaction (migration
//      0016's apply_webhook_event), so a FAILED apply consumes nothing and
//      RevenueCat's retry still heals the account. Recording the id in a separate
//      earlier transaction (as this handler once did) made a mid-apply failure
//      permanent AND invisible — see the note on step 4.
//
// NEVER logs the raw event body, the secret, or PII — only event id + type +
// correlationId (a fixed, non-sensitive vocabulary).
import { makeWebhookEventsRepo, type QueryExecutor } from '@closet/db';
import {
  RevenueCatWebhookBody,
  ENTITLEMENT_BY_EVENT_TYPE,
  parseBoundary,
  type RevenueCatEvent,
} from '@closet/shared';
import type { ApplyEventInput } from '@closet/db';
import { jsonResponse, errorResponse, errorFromThrown } from '../auth/respond.js';
import { logger } from '../auth/logger.js';
import { requireEnv } from '../auth/env.js';
import { makeServiceExecutor, type Sql } from '../auth/executor.js';

// Injected so the oracle drives the REAL handler with a REAL service executor over
// the test pool + a known secret (mirrors withAuth's DI). `makeExec` is a factory
// (not a bound executor) so each request gets its own — matching the per-request
// executor lifetime of the user-JWT handlers.
export interface WebhookDeps {
  readonly makeExec: () => QueryExecutor;
  readonly secret: string;
  readonly newCorrelationId: () => string;
}

// Constant-time string comparison. A raw `===` on a secret leaks a timing oracle
// (it returns on the first mismatched byte); this always inspects every byte of
// the FIXED-length configured secret and folds the length check into the same
// accumulator, so neither the byte position of a mismatch nor a length difference
// is observable through timing. No new dependency (no crypto import needed).
function constantTimeEqual(candidate: string, secret: string): boolean {
  let mismatch = candidate.length ^ secret.length;
  for (let index = 0; index < secret.length; index += 1) {
    // On a length mismatch the candidate index may be NaN → charCodeAt yields NaN;
    // (x ^ NaN) is x, so a wrong length can never accidentally reduce `mismatch`
    // to 0. The length XOR above already forced it non-zero in that case.
    mismatch |= candidate.charCodeAt(index) ^ secret.charCodeAt(index);
  }
  return mismatch === 0;
}

function authHeader(req: Request): string | null {
  return req.headers.get('authorization') ?? req.headers.get('Authorization');
}

// The widest epoch-ms a JS Date can represent; beyond it toISOString() throws
// RangeError. RevenueCatEvent types the two ms fields as bare z.number(), which
// rejects NaN/Infinity but ADMITS any finite double, so a vendor serialization bug
// or a µs/ms unit mix-up slips past the schema and throws inside toApplyEventInput.
// That landed in the catch-all as a 500 — and a 5xx tells RevenueCat to RETRY an
// event that can never succeed, burning the entire retry window on a poison pill
// whose log deliberately carries no eventId. A 400 lets RevenueCat mark it
// undeliverable, which is what every other malformed field already does.
const MAX_EPOCH_MS = 8.64e15;

// NaN/Infinity would also fail this comparison, so the check stays correct even if
// the schema ever loosens.
function isRepresentableEpochMs(ms: number): boolean {
  return Math.abs(ms) <= MAX_EPOCH_MS;
}

// Build the ApplyEventInput from the validated event. The type→active map OWNS the
// entitlement decision; the REAL event timestamp becomes eventTs so the repo's
// monotonic guard engages; expiresAt is the RC expiration or null.
function toApplyEventInput(event: RevenueCatEvent, entitlementActive: boolean): ApplyEventInput {
  return {
    userId: event.app_user_id,
    rcAppUserId: event.app_user_id,
    entitlementActive,
    eventTs: new Date(event.event_timestamp_ms).toISOString(),
    expiresAt: event.expiration_at_ms === null ? null : new Date(event.expiration_at_ms).toISOString(),
  };
}

// The handler, built over injected deps. A test injects a real service executor +
// a known secret; production binds `defaultWebhookDeps`.
export function makeRevenueCatWebhook(deps: WebhookDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const correlationId = deps.newCorrelationId();
    try {
      // 1. Authenticate the shared secret in constant time. Absent/wrong → 401,
      //    write NOTHING (no executor is even created).
      const presented = authHeader(req);
      if (presented === null || !constantTimeEqual(presented, deps.secret)) {
        logger.warn({ correlationId, event: 'revenuecat.unauthorized' });
        return errorResponse(401, 'unauthorized', 'Authentication required.');
      }

      // 2. Parse the inbound webhook body (parse-don't-cast at the boundary). A
      //    missing consumed field / non-uuid app_user_id → BoundaryParseError → 400.
      const rawBody: unknown = await req.json();
      const { event } = parseBoundary(RevenueCatWebhookBody, rawBody, 'revenuecat.webhook.body');

      //    A timestamp the schema admits but Date cannot represent is a malformed
      //    FIELD, so it belongs with the other 400s — not in the catch-all as a 500
      //    that makes RevenueCat retry an unprocessable event forever. Checked here,
      //    before the event id is consumed, so nothing is written either.
      if (
        !isRepresentableEpochMs(event.event_timestamp_ms) ||
        (event.expiration_at_ms !== null && !isRepresentableEpochMs(event.expiration_at_ms))
      ) {
        logger.warn({ correlationId, event: 'revenuecat.invalid_timestamp', eventId: event.id, eventType: event.type });
        return errorResponse(400, 'invalid_request', 'Request failed validation.');
      }

      // 3. Map the event type to an entitlement state BEFORE consuming the event id.
      //    An unmapped type is an acknowledged 200 no-op, and it must NOT be recorded
      //    as consumed: recording it would be a write whose only effect is to burn a
      //    dedup slot for a decision we never made. Nothing is written on this path, so
      //    a later redelivery of a type we have since learned to model still applies.
      const entitlementActive = ENTITLEMENT_BY_EVENT_TYPE[event.type];
      if (entitlementActive === undefined) {
        logger.info({ correlationId, event: 'revenuecat.unmapped_type', eventId: event.id, eventType: event.type });
        return jsonResponse(200, { ignored: true });
      }

      const exec = deps.makeExec();

      // 4. Dedup AND write, atomically (migration 0016's plpgsql fn, one query() = one
      //    tx). This is ONE call on purpose: recording the id in its own transaction
      //    first — as this handler used to — durably marks the event "seen" BEFORE the
      //    entitlement write it was meant to guard. If that write then failed, every
      //    RevenueCat retry was classified a replay and discarded, so the entitlement
      //    never flipped and a paying customer was locked out silently, with a 200 on
      //    the wire both times. Bound in one tx, a failed apply rolls the ledger row
      //    back too, leaving the event unconsumed so the retry heals it.
      const outcome = await makeWebhookEventsRepo(exec).applyEvent(
        event.id,
        toApplyEventInput(event, entitlementActive),
      );

      // A replay: a COMMITTED prior delivery already applied this id. 200 no-op.
      if (outcome === 'duplicate') {
        logger.info({ correlationId, event: 'revenuecat.replay', eventId: event.id, eventType: event.type });
        return jsonResponse(200, { deduped: true });
      }

      // The monotonic guard rejected an older event_ts — a SUCCESS no-op, still 200
      // (the newer entitlement stands).
      if (outcome === 'stale') {
        logger.info({ correlationId, event: 'revenuecat.stale_ignored', eventId: event.id, eventType: event.type });
        return jsonResponse(200, { stale: true });
      }

      logger.info({
        correlationId,
        event: 'revenuecat.applied',
        eventId: event.id,
        eventType: event.type,
        entitlementActive,
      });
      return jsonResponse(200, { applied: true });
    } catch (thrown) {
      // Never leak the raw provider message / body onto the wire or into logs.
      logger.error({ correlationId, event: 'revenuecat.error' });
      return errorFromThrown(thrown);
    }
  };
}

// Production defaults, resolved lazily so a test injecting deps never touches env
// or opens a pool. `sql` is the thin pg-Pool binding (executor.ts). The executor
// is the service_role seam — this is a system job with no end-user.
export function defaultWebhookDeps(sql: Sql): WebhookDeps {
  return {
    makeExec: () => makeServiceExecutor(sql),
    secret: requireEnv('REVENUECAT_WEBHOOK_SECRET'),
    newCorrelationId: () => (globalThis as { crypto: { randomUUID(): string } }).crypto.randomUUID(),
  };
}

// Production-bound entry. The Deno shim (supabase/functions/revenuecat-webhook/
// index.ts) wires the concrete pg pool and serves this — OUT of scope here
// (deploy-wiring), flagged in the task follow-up.
export function revenueCatWebhook(sql: Sql): (req: Request) => Promise<Response> {
  return makeRevenueCatWebhook(defaultWebhookDeps(sql));
}
