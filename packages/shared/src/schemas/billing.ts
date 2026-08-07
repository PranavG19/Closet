// Row schemas for subscriptions (money table) + webhook_events (docs/06 §3).
// These are written only by the human-gated revenuecat-webhook (service_role);
// app_user has SELECT-only on subscriptions and no access to webhook_events.
// No app-layer request schema mints entitlement — that path is unrepresentable.
import { z } from 'zod';
import { Uuid, Timestamptz } from './common.js';

export const SubscriptionRow = z.object({
  user_id: Uuid,
  rc_app_user_id: z.string().nullable(),
  entitlement_active: z.boolean(),
  event_ts: Timestamptz.nullable(),
  expires_at: Timestamptz.nullable(),
  updated_at: Timestamptz,
});
export type SubscriptionRow = z.infer<typeof SubscriptionRow>;

// webhook_events has NO user_id (not tenant data) and NO updated_at.
export const WebhookEventRow = z.object({
  event_id: z.string(),
  received_at: Timestamptz,
});
export type WebhookEventRow = z.infer<typeof WebhookEventRow>;

// Entitlement read for UI gating (docs/06 §4 palette endpoint serves this).
export const EntitlementResponse = z.object({
  entitlement_active: z.boolean(),
  expires_at: Timestamptz.nullable(),
});
export type EntitlementResponse = z.infer<typeof EntitlementResponse>;

// The INBOUND RevenueCat v1 server-to-server webhook event (parse-don't-cast at
// the boundary). RevenueCat POSTs `{ api_version, event: { ... } }`; this is the
// inner `event` object. Only the fields the webhook CONSUMES are strict-typed —
// RevenueCat adds many more (product_id, store, price, subscriber_attributes, …)
// and evolves the set over time, so unknown keys `.passthrough()` rather than
// tripping a 400 (which would make RevenueCat retry a well-formed event forever).
//
// `app_user_id` is the RevenueCat app user id, which this app sets at RC login to
// the Supabase auth `sub` — so it IS the `subscriptions.user_id` (a uuid). It is
// validated as Uuid here: a non-tenant app_user_id is not a valid money-write
// subject and is rejected at the boundary, never cast into the uuid column.
export const RevenueCatEvent = z
  .object({
    id: z.string(),
    type: z.string(),
    app_user_id: Uuid,
    event_timestamp_ms: z.number(),
    expiration_at_ms: z.number().nullable(),
  })
  .passthrough();
export type RevenueCatEvent = z.infer<typeof RevenueCatEvent>;

// The full webhook envelope RevenueCat actually POSTs. The event is the payload;
// `api_version` and any siblings pass through. The handler parses THIS and reads
// `.event` so the committed oracle fixture is a real RevenueCat webhook body, not
// a hand-minted inner object.
export const RevenueCatWebhookBody = z
  .object({
    event: RevenueCatEvent,
  })
  .passthrough();
export type RevenueCatWebhookBody = z.infer<typeof RevenueCatWebhookBody>;

// The type → entitlementActive map the handler OWNS (docs/06 §4). Grant on a
// purchase/renewal/plan-change/uncancellation; revoke on cancellation/expiration/
// billing-issue-past-grace. A `type` NOT in this map (e.g. TEST, TRANSFER,
// SUBSCRIPTION_PAUSED, NON_RENEWING_PURCHASE) is neither granted nor revoked — the
// handler treats an unmapped type as an acknowledged 200 no-op, never moving
// entitlement on an event whose semantics it does not model. Keep this small and
// named; it is a Tier-0 mutation target (flipping any entry must turn an oracle red).
export const ENTITLEMENT_BY_EVENT_TYPE: Readonly<Record<string, boolean>> = {
  INITIAL_PURCHASE: true,
  RENEWAL: true,
  PRODUCT_CHANGE: true,
  UNCANCELLATION: true,
  CANCELLATION: false,
  EXPIRATION: false,
  BILLING_ISSUE: false,
};
