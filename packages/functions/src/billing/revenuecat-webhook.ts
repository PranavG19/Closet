// revenuecat-webhook — the SOLE writer of subscriptions.entitlement_active (the
// money table; parse-photo only READS it). This is a server-to-server webhook:
// there is NO end-user in the request, so it does NOT use withAuth/serveAuthed
// (those verify a user JWT via JWKS). It authenticates a shared secret, dedups on
// the RevenueCat event id for replay-idempotency, maps the event type to an
// entitlement state, and writes under a service_role executor (RLS-exempt system
// job). The two hard invariants (docs/06 §4):
//   1. Replay-safe — RevenueCat retries the same event id; a replay is a 200 no-op
//      that writes nothing new (record() returns null → short-circuit).
//   2. Monotonic — a late-arriving OLDER event must NOT revoke a NEWER entitlement.
//      The repo's `DO UPDATE ... WHERE excluded.event_ts >= existing.event_ts`
//      guard enforces this, so the handler passes the REAL event timestamp (never
//      now()) — otherwise the guard cannot bite.
//
// NEVER logs the raw event body, the secret, or PII — only event id + type +
// correlationId (a fixed, non-sensitive vocabulary).
import { makeSubscriptionsRepo, makeWebhookEventsRepo, type QueryExecutor } from '@closet/db';
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

      const exec = deps.makeExec();

      // 3. Replay dedup on the RevenueCat event id. record() returns null when the
      //    id was already seen — a 200 no-op that does NOT touch entitlement again.
      const recorded = await makeWebhookEventsRepo(exec).record(event.id);
      if (recorded === null) {
        logger.info({ correlationId, event: 'revenuecat.replay', eventId: event.id, eventType: event.type });
        return jsonResponse(200, { deduped: true });
      }

      // 4. Map the event type to an entitlement state. An unmapped type is an
      //    acknowledged 200 no-op — never move entitlement on an event we do not
      //    model (record() above still deduped it, so it is not re-seen).
      const entitlementActive = ENTITLEMENT_BY_EVENT_TYPE[event.type];
      if (entitlementActive === undefined) {
        logger.info({ correlationId, event: 'revenuecat.unmapped_type', eventId: event.id, eventType: event.type });
        return jsonResponse(200, { ignored: true });
      }

      // 5. Write under the service_role executor. applyEvent returns null when the
      //    monotonic guard rejected a stale (older event_ts) event — a SUCCESS
      //    no-op, still 200 (the newer entitlement stands).
      const applied = await makeSubscriptionsRepo(exec).applyEvent(
        toApplyEventInput(event, entitlementActive),
      );
      if (applied === null) {
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
