// BillingPort — the store's own view of what a subscription costs, and the purchase +
// restore controls. RevenueCat sits behind this port; no vendor type crosses it.
//
// WHY A PORT AND NOT A DIRECT SDK CALL: `react-native-purchases` is a native module. A
// direct import in the screen makes the paywall — the one screen Apple review looks at
// hardest — impossible to render or test outside a device build. Behind a port, the
// disclosure logic is a pure function of a `SubscriptionOffer` and is unit-tested.
//
// THE PRICE IS ALWAYS A STRING FROM THE STORE, NEVER A NUMBER WE FORMAT. StoreKit and
// Play Billing return an already-localised, already-currency-symboled, already-rounded
// display string ("$4.99", "4,99 €", "￥700"). Reconstructing that from a number and a
// currency code gets decimal separators, symbol placement, and tax-inclusive pricing
// wrong per storefront — and the price shown MUST be the price charged
// (docs/legal/subscription-terms.md §2: "the localised price returned by the store, not a
// hardcoded figure"). App Store Guideline 3.1.2 requires price, period, and renewal terms
// in the binary, adjacent to the purchase control.
import { z } from 'zod';

// The billing period, as the store expresses it. Kept to the periods a subscription can
// actually be sold on, so a screen's period copy is exhaustive over a closed set rather
// than interpolating an arbitrary string.
export const BillingPeriod = z.enum(['weekly', 'monthly', 'annual']);
export type BillingPeriod = z.infer<typeof BillingPeriod>;

export const SubscriptionOffer = z.object({
  // The store's product identifier. Opaque to the UI; needed to start a purchase.
  productId: z.string().min(1),
  // The store's localised display price. `.min(1)` is load-bearing: an empty string here
  // would render a paywall with no price, which is the exact rejection this port exists
  // to prevent. A blank price must fail as a parse error, not paint as blank.
  localizedPrice: z.string().min(1),
  period: BillingPeriod,
  // Present ONLY when the storefront actually has an introductory offer. Apple requires
  // the trial length AND the post-trial price adjacent to the purchase when one exists —
  // and requires no trial language at all when one does not. `undefined` therefore means
  // "say nothing about a trial", which is why this is optional rather than a nullable
  // string with an empty default.
  introductoryOffer: z
    .object({
      // e.g. "7 days" — again the store's own localised phrasing, not composed by us.
      localizedDuration: z.string().min(1),
    })
    .optional(),
});
export type SubscriptionOffer = z.infer<typeof SubscriptionOffer>;

// The outcome of a purchase attempt, as a CLOSED SET rather than a thrown error.
// Cancellation is the single most common outcome of tapping subscribe and it is NOT an
// error — surfacing it as one produces the "something went wrong" alert on a paywall that
// is the most-cited dark-pattern complaint in review. Each case gets its own copy.
export type PurchaseOutcome =
  // The store confirmed the charge. The entitlement itself still arrives server-side via
  // the RevenueCat webhook — this only means "the store took the money", never "the user
  // is entitled". The screen must re-read the entitlement rather than assume it.
  | { readonly kind: 'purchased' }
  // She dismissed the sheet. Show nothing.
  | { readonly kind: 'cancelled' }
  // Already subscribed (e.g. a reinstall). Treated separately from `purchased` so the
  // screen can say "restored" instead of thanking her for a charge that did not happen.
  | { readonly kind: 'alreadyOwned' }
  // Everything else: no network, store outage, payment declined, parental restriction.
  | { readonly kind: 'failed' };

export interface BillingPort {
  // The current offer, or null when the store has none configured for this build/
  // storefront. NULL IS A REAL STATE THE UI MUST HANDLE VISIBLY: a build whose products
  // are not yet approved, or a region where they are unavailable, must show "unavailable"
  // rather than a subscribe button with a missing price.
  getOffer(): Promise<SubscriptionOffer | null>;
  purchase(productId: string): Promise<PurchaseOutcome>;
  // Apple requires a restore control for auto-renewable subscriptions
  // (docs/legal/subscription-terms.md §7). Returns whether anything was restored, so the
  // screen can distinguish "welcome back" from "nothing to restore" — a silent no-op here
  // reads as a broken button.
  restore(): Promise<{ readonly restored: boolean }>;
}
