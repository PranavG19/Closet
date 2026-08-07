// subscriptions repo — the money table. app_user can ONLY reach getByUser (the
// SELECT policy + SELECT grant); applyEvent is refused under an app_user executor
// (no INSERT/UPDATE grant) and is driven ONLY by revenuecat-webhook under a
// service_role executor. The repo sets no role — that a client cannot mint
// entitlement is a structural DB guarantee, not a repo check.
import type { SubscriptionRow, EntitlementResponse } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `user_id, rc_app_user_id, entitlement_active,
  to_char(event_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_ts, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

export interface ApplyEventInput {
  readonly userId: string;
  readonly rcAppUserId: string | null;
  readonly entitlementActive: boolean;
  readonly eventTs: string;
  readonly expiresAt: string | null;
}

export interface SubscriptionsRepo {
  getByUser(userId: string): Promise<SubscriptionRow | null>;
  // Entitlement read for UI gating. Returns the default (not entitled) when the
  // user has no money row — an absent row means "not entitled".
  getEntitlement(userId: string): Promise<EntitlementResponse>;
  // The money-table write (service_role only). The WHERE on DO UPDATE is the
  // monotonic ordering guard: a late-arriving older event returns null and does
  // NOT revoke a newer entitlement.
  applyEvent(input: ApplyEventInput): Promise<SubscriptionRow | null>;
}

export function makeSubscriptionsRepo(exec: QueryExecutor): SubscriptionsRepo {
  return {
    async getByUser(userId) {
      const { rows } = await exec.query<SubscriptionRow>(
        `SELECT ${PROJECTION} FROM public.subscriptions WHERE user_id = $1`,
        [userId],
      );
      return rows[0] ?? null;
    },

    async getEntitlement(userId) {
      const { rows } = await exec.query<{
        entitlement_active: boolean;
        expires_at: string | null;
      }>(
        `SELECT entitlement_active, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at
         FROM public.subscriptions WHERE user_id = $1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return { entitlement_active: false, expires_at: null };
      return { entitlement_active: row.entitlement_active, expires_at: row.expires_at };
    },

    async applyEvent(input) {
      const { rows } = await exec.query<SubscriptionRow>(
        `INSERT INTO public.subscriptions
           (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (user_id) DO UPDATE SET
           rc_app_user_id = excluded.rc_app_user_id,
           entitlement_active = excluded.entitlement_active,
           event_ts = excluded.event_ts,
           expires_at = excluded.expires_at,
           updated_at = now()
         WHERE public.subscriptions.event_ts IS NULL
            OR excluded.event_ts >= public.subscriptions.event_ts
         RETURNING ${PROJECTION}`,
        [
          input.userId,
          input.rcAppUserId,
          input.entitlementActive,
          input.eventTs,
          input.expiresAt,
        ],
      );
      return rows[0] ?? null;
    },
  };
}
