// THE ONLY file that imports the RevenueCat SDK. Everything else depends on BillingPort,
// which is why revenueCatPort.ts is unit-testable without a device.
//
// The SDK is now bound. All decision logic (period mapping, cancel-vs-fail, already-owned,
// price parsing) lives in makeRevenueCatBillingPort — this file only maps the real
// `react-native-purchases` objects onto the narrow RevenueCatSurface that adapter consumes,
// and configures the SDK once from the owner's key.
//
// STILL FAILS CLOSED WHEN UNCONFIGURED. `Purchases.configure` needs an API key that only
// exists in the owner's account. When EXPO_PUBLIC_REVENUECAT_IOS_KEY is unset we return the
// SAME no-offer port as before — the paywall shows "Membership isn't available right now"
// with no price and no subscribe button, never a priceless button (App Store 3.1.2) and
// never a fabricated entitlement (entitlement only ever comes from the server, written by
// the RevenueCat webhook). So this is safe to ship before the key is provisioned.
//
// REMAINING OWNER STEPS (the code is ready; these are inputs only):
//   - Set EXPO_PUBLIC_REVENUECAT_IOS_KEY (+ _ANDROID_KEY for parity) in .env / EAS env.
//   - Create the App Store / Play products and the "premium" entitlement + an offering in
//     the RevenueCat dashboard.
//   - The oracle for "done" is a REAL RevenueCat webhook event reaching the deployed
//     endpoint and flipping entitlement_active — never a mocked success.
import PurchasesDefault, {
  type PurchasesOffering,
  type PurchasesPackage,
  type PurchasesError,
} from 'react-native-purchases';
import type { BillingPort } from '@closet/shared';
import { makeRevenueCatBillingPort, type RevenueCatPackage, type RevenueCatSurface } from './revenueCatPort.js';

// The narrow static surface of `react-native-purchases` this adapter calls. Declared locally
// for the SAME reason revenueCatPort.ts declares RevenueCatSurface: the SDK is a native module,
// and — because the package ships an extension-less re-export barrel that NodeNext cannot
// follow to the default class — the default import's static members do not survive type
// resolution here. Modelling only the four entry points used keeps this file typed against a
// checked shape rather than `any`, and keeps the vendor's full type surface out of it. The
// runtime value is the real SDK (imported above); this is only its type.
interface PurchasesStatic {
  configure(config: { apiKey: string }): void;
  getOfferings(): Promise<{ current: PurchasesOffering | null }>;
  purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: { entitlements: { active: Record<string, unknown> } } }>;
  restorePurchases(): Promise<{ entitlements: { active: Record<string, unknown> } }>;
  readonly PURCHASES_ERROR_CODE: { readonly PRODUCT_ALREADY_PURCHASED_ERROR: string };
}
const Purchases = PurchasesDefault as unknown as PurchasesStatic;

// The entitlement identifier configured in the RevenueCat dashboard, matched by the webhook
// fixtures (packages/functions/test/fixtures/revenuecat-events.ts) and the server's
// entitlement writer. An active entry under this key means "she is entitled".
const PREMIUM_ENTITLEMENT = 'premium';

// The iOS key. Public-by-design like the Supabase anon key (RevenueCat's SDK key is meant to
// ship in the client; the secret is the webhook signing secret, which lives server-side).
// Read through the same Metro-inlined EXPO_PUBLIC_* mechanism as api/config.ts. Absent =>
// unconfigured build => the no-offer port below.
function revenueCatKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  return key !== undefined && key.length > 0 ? key : undefined;
}

// Map the SDK's rich PurchasesPackage onto the narrow shape the pure adapter reads. Only the
// fields RevenueCatPackage declares are forwarded; everything else is a vendor detail the
// paywall must not see.
function toSurfacePackage(pkg: PurchasesPackage): RevenueCatPackage {
  return {
    identifier: pkg.identifier,
    product: {
      identifier: pkg.product.identifier,
      priceString: pkg.product.priceString,
      subscriptionPeriod: pkg.product.subscriptionPeriod ?? null,
      introPrice:
        pkg.product.introPrice != null
          ? {
              periodNumberOfUnits: pkg.product.introPrice.periodNumberOfUnits,
              periodUnit: pkg.product.introPrice.periodUnit,
            }
          : null,
    },
  };
}

// The no-offer port: identical behaviour to the pre-SDK stub. Returned whenever the key is
// absent, so an unconfigured build degrades honestly instead of crashing inside the SDK.
function makeUnavailableBillingPort(): BillingPort {
  return {
    async getOffer() {
      return null;
    },
    async purchase() {
      return { kind: 'failed' as const };
    },
    async restore() {
      return { restored: false };
    },
  };
}

// Configure exactly once. The SDK throws if getOfferings/purchase run before configure, so
// this guards a module-level flag rather than reconfiguring per call.
let configured = false;
function configureOnce(apiKey: string): void {
  if (configured) return;
  Purchases.configure({ apiKey });
  configured = true;
}

export function makeBillingPort(): BillingPort {
  const apiKey = revenueCatKey();
  if (apiKey === undefined) return makeUnavailableBillingPort();
  configureOnce(apiKey);

  const surface: RevenueCatSurface = {
    getCurrentOffering: async () => {
      const offering: PurchasesOffering | null = (await Purchases.getOfferings()).current;
      if (offering === null) return null;
      return { availablePackages: offering.availablePackages.map(toSurfacePackage) };
    },
    purchasePackage: async (pkg) => {
      // find the real SDK package by identifier — the adapter passes back the mapped shape,
      // but purchasePackage needs the original object with its native handle.
      const offering = (await Purchases.getOfferings()).current;
      const native = offering?.availablePackages.find((p) => p.identifier === pkg.identifier);
      if (native === undefined) throw new Error('package not found in current offering');
      const { customerInfo } = await Purchases.purchasePackage(native);
      return { hasEntitlement: customerInfo.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined };
    },
    restore: async () => {
      const info = await Purchases.restorePurchases();
      return { hasEntitlement: info.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined };
    },
    // RC marks a user-dismissed sheet with userCancelled on the thrown PurchasesError.
    wasCancelled: (thrown: unknown) => (thrown as PurchasesError | undefined)?.userCancelled === true,
    // PURCHASE_CANCELLED_ERROR = "1"; PRODUCT_ALREADY_PURCHASED is the already-owned code.
    wasAlreadyOwned: (thrown: unknown) =>
      (thrown as { code?: string } | undefined)?.code === Purchases.PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
  };

  return makeRevenueCatBillingPort(surface);
}
