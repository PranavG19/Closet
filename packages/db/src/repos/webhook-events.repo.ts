// webhook_events repo — the atomic replay-dedup ledger. Not tenant data; reachable
// only under service_role (no app_user policy or grant). Every "did this happen"
// decision rides on the presence/absence of a RETURNING row, never a driver rowcount.
//
// applyEvent() is the money path's entry point and the ONLY one the webhook should
// use: it binds the dedup claim and the entitlement write into ONE transaction (the
// plpgsql fn from migration 0016), so a failed apply leaves the event unconsumed and
// RevenueCat's retry can still heal the account. record() is the bare ledger claim,
// which does NOT have that property — see the warning on it.
import type { WebhookEventRow } from '@closet/shared';
import type { QueryExecutor } from './index.js';
import type { ApplyEventInput } from './subscriptions.repo.js';

const PROJECTION = `event_id, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at`;

// What migration 0016's fn decided. 'applied' = ledger row + entitlement written
// together; 'duplicate' = a committed prior delivery consumed this id (replay no-op,
// money untouched); 'stale' = consumed, but the monotonic guard kept the NEWER
// entitlement (a success whose decision was "change nothing").
export type ApplyWebhookEventOutcome = 'applied' | 'duplicate' | 'stale';

export interface WebhookEventsRepo {
  // Dedup + entitlement write, atomically. Either BOTH land or NEITHER does, so a
  // transient failure mid-apply is retryable rather than a silently-swallowed lockout.
  applyEvent(eventId: string, input: ApplyEventInput): Promise<ApplyWebhookEventOutcome>;
  // The bare ledger claim: null = the id was already seen. NOT for the money path —
  // it commits in its own transaction (one tx per query()), so pairing it with a
  // separate entitlement write re-creates the poison pill 0016 exists to close: the
  // id is durably "seen" before the write it was supposed to guard even runs. Kept
  // because it is the ledger's own unit oracle (and the only thing that can prove
  // app_user has no grant on the table at all).
  record(eventId: string): Promise<WebhookEventRow | null>;
}

export function makeWebhookEventsRepo(exec: QueryExecutor): WebhookEventsRepo {
  return {
    async applyEvent(eventId, input) {
      const { rows } = await exec.query<{ outcome: ApplyWebhookEventOutcome }>(
        `SELECT public.apply_webhook_event($1,$2,$3,$4,$5,$6) AS outcome`,
        [
          eventId,
          input.userId,
          input.rcAppUserId,
          input.entitlementActive,
          input.eventTs,
          input.expiresAt,
        ],
      );
      const outcome = rows[0]?.outcome;
      // A missing outcome means the fn did not run as expected. Fail LOUD: returning
      // a default here would let the handler answer 200 to an event it never applied.
      if (outcome === undefined) throw new Error('apply_webhook_event returned no row');
      return outcome;
    },

    async record(eventId) {
      const { rows } = await exec.query<WebhookEventRow>(
        `INSERT INTO public.webhook_events (event_id) VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING ${PROJECTION}`,
        [eventId],
      );
      return rows[0] ?? null;
    },
  };
}
