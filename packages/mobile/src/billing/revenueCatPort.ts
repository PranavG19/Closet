// The RevenueCat implementation of BillingPort — pure ADAPTER logic, no native import.
//
// Same shape as src/session/nativeCredentials.ts and for the same reason: the native SDK
// is taken as a narrow structural surface, so every decision here (which period an
// ISO-8601 duration maps to, cancellation-vs-failure, "already owned") is unit-testable in
// node with fakes. The real `react-native-purchases` binds in ONE place —
// revenueCatNative.ts — which only src/App.tsx imports.
//
// WHY MAP RC's SHAPES AT ALL: RevenueCat returns a rich `PurchasesPackage` with nested
// `product` fields and signals cancellation via a boolean on a THROWN error object. Both
// are vendor details; letting them reach the screen would make the paywall depend on the
// SDK's error contract, which is exactly what BillingPort exists to prevent.
import {
  SubscriptionOffer,
  type BillingPeriod,
  type BillingPort,
  type PurchaseOutcome,
} from '@closet/shared';

// The slice of react-native-purchases this adapter needs.
//
// `priceString` (not `price`) is the field we take: it is the store's already-localised
// display string. RC also exposes a numeric `price` + `currencyCode`, and composing a
// display string from those is the bug BillingPort's header warns about.
export interface RevenueCatPackage {
  readonly identifier: string;
  readonly product: {
    readonly identifier: string;
    readonly priceString: string;
    // RC normalises the store's period to ISO-8601 ("P1M", "P1Y", "P1W").
    readonly subscriptionPeriod?: string | null;
    readonly introPrice?: { readonly periodNumberOfUnits: number; readonly periodUnit: string } | null;
  };
}

export interface RevenueCatSurface {
  // Null/absent when no offering is configured for this build or storefront.
  readonly getCurrentOffering: () => Promise<{ readonly availablePackages: readonly RevenueCatPackage[] } | null>;
  readonly purchasePackage: (pkg: RevenueCatPackage) => Promise<{ readonly hasEntitlement: boolean }>;
  readonly restore: () => Promise<{ readonly hasEntitlement: boolean }>;
  // RC marks a user-dismissed sheet with `userCancelled` on the thrown error. Reading it
  // through a function keeps the vendor's error shape out of this module's types.
  readonly wasCancelled: (thrown: unknown) => boolean;
  // RC's PRODUCT_ALREADY_PURCHASED: she is already subscribed, typically after a reinstall
  // or a family-shared purchase. Separated from a generic failure because the honest
  // response is "restoring", not "we couldn't complete that purchase" — telling an
  // existing subscriber her purchase failed is how you generate a refund request.
  readonly wasAlreadyOwned: (thrown: unknown) => boolean;
}

// ISO-8601 subscription periods, restricted to what a subscription is actually sold on.
// A closed map, so an unrecognised period yields `undefined` and the offer is REJECTED
// rather than silently displayed with the wrong billing period next to a real price —
// "$49.99 per month" for an annual plan is a worse failure than showing nothing.
const PERIOD_BY_ISO: Readonly<Record<string, BillingPeriod>> = {
  P1W: 'weekly',
  P7D: 'weekly',
  P1M: 'monthly',
  P1Y: 'annual',
};

// RC reports the intro period as a unit + count ("DAY" × 7). Rendered as the store would
// say it, pluralised, because it lands mid-sentence in the trial disclosure.
function introDuration(intro: { periodNumberOfUnits: number; periodUnit: string }): string | null {
  const unit = intro.periodUnit.toLowerCase().replace(/s$/, '');
  if (!['day', 'week', 'month', 'year'].includes(unit)) return null;
  if (intro.periodNumberOfUnits <= 0) return null;
  const plural = intro.periodNumberOfUnits === 1 ? unit : `${unit}s`;
  return `${intro.periodNumberOfUnits}-${plural}`.replace('-', ' ');
}

export function makeRevenueCatBillingPort(native: RevenueCatSurface): BillingPort {
  return {
    async getOffer(): Promise<SubscriptionOffer | null> {
      const offering = await native.getCurrentOffering();
      const pkg = offering?.availablePackages[0];
      if (pkg === undefined) return null;

      const iso = pkg.product.subscriptionPeriod ?? '';
      const period = PERIOD_BY_ISO[iso];
      // No recognisable period => do not show a price at all. See PERIOD_BY_ISO.
      if (period === undefined) return null;

      const intro = pkg.product.introPrice ?? null;
      const localizedDuration = intro === null ? null : introDuration(intro);

      // Parsed through the schema rather than cast: `localizedPrice` has a `.min(1)` that
      // makes a blank price a parse failure instead of a blank paywall. safeParse (not
      // parse) because a malformed offer must degrade to "unavailable", never crash the
      // screen — this is the store's data, not ours.
      const parsed = SubscriptionOffer.safeParse({
        productId: pkg.product.identifier,
        localizedPrice: pkg.product.priceString,
        period,
        ...(localizedDuration !== null ? { introductoryOffer: { localizedDuration } } : {}),
      });
      return parsed.success ? parsed.data : null;
    },

    async purchase(productId: string): Promise<PurchaseOutcome> {
      const offering = await native.getCurrentOffering();
      const pkg = offering?.availablePackages.find((p) => p.product.identifier === productId);
      // The offer moved out from under us (storefront change, offering reconfigured).
      // Not a charge and not a cancellation.
      if (pkg === undefined) return { kind: 'failed' };

      try {
        const result = await native.purchasePackage(pkg);
        // RC reports an already-active entitlement on a re-purchase attempt. Distinguished
        // from a fresh purchase so the screen does not thank her for a charge that did not
        // happen.
        return result.hasEntitlement ? { kind: 'purchased' } : { kind: 'failed' };
      } catch (thrown: unknown) {
        // Cancellation FIRST: it is the most common outcome and must never surface as an
        // error. Then already-owned, which RC also reports by throwing. Everything else is
        // a genuine failure and must not be disguised as a cancel — that would hide a
        // declined payment behind silence.
        if (native.wasCancelled(thrown)) return { kind: 'cancelled' };
        if (native.wasAlreadyOwned(thrown)) return { kind: 'alreadyOwned' };
        return { kind: 'failed' };
      }
    },

    async restore(): Promise<{ readonly restored: boolean }> {
      const result = await native.restore();
      return { restored: result.hasEntitlement };
    },
  };
}
