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
