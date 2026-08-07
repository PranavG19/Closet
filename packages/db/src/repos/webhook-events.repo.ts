// webhook_events repo — the atomic replay-dedup ledger. Not tenant data; reachable
// only under service_role (no app_user policy or grant). record() returns null
// when the event_id was already seen (a replay): the webhook returns 200 and stops
// before any entitlement write. The dedup decision is the presence/absence of the
// RETURNING row, never a driver rowcount.
import type { WebhookEventRow } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `event_id, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at`;

export interface WebhookEventsRepo {
  record(eventId: string): Promise<WebhookEventRow | null>;
}

export function makeWebhookEventsRepo(exec: QueryExecutor): WebhookEventsRepo {
  return {
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
