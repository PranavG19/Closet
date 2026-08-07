// A COMMITTED real RevenueCat v1 server-to-server webhook payload — the oracle's
// fixture. This is the actual `{ api_version, event }` envelope RevenueCat POSTs
// (shape + field set taken from RevenueCat's documented INITIAL_PURCHASE sample),
// NOT a hand-minted `{ active: true }`. The only deviation from the doc sample is
// `app_user_id`: this app sets the RC app user id at login to the Supabase auth
// `sub` (a uuid), so the fixture uses a real uuid there — the identity assumption
// the handler relies on (app_user_id === subscriptions.user_id).
//
// `makeEvent` overrides id / type / timestamp / expiration / app_user_id on top of
// this real base so each oracle drives a genuine RC-shaped body, differing only in
// the fields the scenario needs.

export interface RevenueCatEventOverrides {
  readonly id: string;
  readonly type: string;
  readonly appUserId: string;
  readonly eventTimestampMs: number;
  readonly expirationAtMs: number | null;
}

const BASE_EVENT = {
  aliases: [] as string[],
  app_id: 'app1a2b3c4d',
  country_code: 'US',
  currency: 'USD',
  entitlement_id: 'premium',
  entitlement_ids: ['premium'],
  environment: 'PRODUCTION',
  event_timestamp_ms: 1_700_000_000_000,
  expiration_at_ms: 1_800_000_000_000,
  id: 'RC-EVENT-BASE',
  is_family_share: false,
  offer_code: null as string | null,
  original_app_user_id: '00000000-0000-4000-8000-000000000001',
  original_transaction_id: '1000000000000001',
  period_type: 'NORMAL',
  presented_offering_id: 'default',
  price: 9.99,
  price_in_purchased_currency: 9.99,
  product_id: 'com.closet.premium.monthly',
  purchased_at_ms: 1_700_000_000_000,
  store: 'APP_STORE',
  subscriber_attributes: {},
  takehome_percentage: 0.7,
  transaction_id: '1000000000000001',
  type: 'INITIAL_PURCHASE',
  app_user_id: '00000000-0000-4000-8000-000000000001',
} as const;

export function makeEvent(overrides: RevenueCatEventOverrides): { api_version: string; event: Record<string, unknown> } {
  return {
    api_version: '1.0',
    event: {
      ...BASE_EVENT,
      id: overrides.id,
      type: overrides.type,
      app_user_id: overrides.appUserId,
      event_timestamp_ms: overrides.eventTimestampMs,
      expiration_at_ms: overrides.expirationAtMs,
    },
  };
}
