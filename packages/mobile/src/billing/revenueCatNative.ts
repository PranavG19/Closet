// THE ONLY file that imports the RevenueCat SDK. Everything else depends on BillingPort,
// which is why revenueCatPort.ts is unit-testable without a device.
//
// NOT YET BOUND TO THE REAL SDK. `react-native-purchases` is not installed and cannot be
// configured without the owner's RevenueCat API keys and App Store / Play product IDs. So
// this module exports a port that reports NO OFFER, which the paywall renders as
// "Membership isn't available right now" with NO subscribe button and NO price.
//
// THAT IS THE CORRECT FAILURE MODE AND IT IS DELIBERATE: an unconfigured build shows an
// honest unavailable state rather than a subscribe button that does nothing (the
// pre-existing `onPress={() => {}}`) or a paywall with a blank price (an App Store
// Guideline 3.1.2 rejection). It never fabricates an entitlement — entitlement only ever
// comes from the server, written by the RevenueCat webhook.
//
// TO FINISH WIRING THIS (owner-blocked, needs keys):
//   1. Add `react-native-purchases` to packages/mobile/package.json by hand, then
//      `pnpm install --lockfile-only`. (`pnpm add` aborts the package.json write in this
//      repo — the prepare script's lefthook install fails on a global core.hooksPath.)
//   2. Purchases.configure({ apiKey: envValue('EXPO_PUBLIC_REVENUECAT_IOS_KEY') }) at
//      startup, once, before any offering read.
//   3. Replace the body below with makeRevenueCatBillingPort({ ... }) over the real SDK:
//        getCurrentOffering: async () => (await Purchases.getOfferings()).current,
//        purchasePackage:    async (pkg) => {
//          const { customerInfo } = await Purchases.purchasePackage(pkg);
//          return { hasEntitlement: customerInfo.entitlements.active['premium'] !== undefined };
//        },
//        restore:            async () => {
//          const info = await Purchases.restorePurchases();
//          return { hasEntitlement: info.entitlements.active['premium'] !== undefined };
//        },
//        wasCancelled:     (t) => (t as { userCancelled?: boolean }).userCancelled === true,
//        wasAlreadyOwned:  (t) => (t as { code?: string }).code === 'PRODUCT_ALREADY_PURCHASED',
//      The adapter's 20 unit tests already pin every one of those mappings, so the
//      remaining risk is the SDK call shapes, not the decision logic.
//   4. The oracle for "done" is a REAL RevenueCat webhook event reaching the deployed
//      endpoint and flipping entitlement_active — never a mocked success.
import type { BillingPort, PurchaseOutcome, SubscriptionOffer } from '@closet/shared';

export function makeBillingPort(): BillingPort {
  return {
    // No SDK => no offering. The paywall shows the unavailable state.
    async getOffer(): Promise<SubscriptionOffer | null> {
      return null;
    },
    // Unreachable from the UI (no offer means no subscribe button), but must not lie if it
    // is ever called: nothing was charged.
    async purchase(): Promise<PurchaseOutcome> {
      return { kind: 'failed' };
    },
    async restore(): Promise<{ readonly restored: boolean }> {
      return { restored: false };
    },
  };
}
