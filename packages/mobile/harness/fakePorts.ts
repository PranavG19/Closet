// The fake BillingPort and fake PhotoIntakePort for the screenshot harness. Both are
// injected exactly where App.tsx injects the real ones (BillingProvider /
// PhotoIntakeProvider take a `port`), so the production adapters are untouched.
import type { BillingPort, PurchaseOutcome, SubscriptionOffer, PhotoIntakePort, PickedPhoto } from '@closet/shared';
import { makePhotoIntakePort } from '../src/photo/index.js';

// A real offer so the paywall renders a price (SubscriptionOffer.localizedPrice is
// `.min(1)` — a blank price is a parse error by design). The price is the store's own
// localised display string, which here is a canned literal.
const HARNESS_OFFER: SubscriptionOffer = {
  productId: 'com.closet.premium.annual',
  localizedPrice: '$39.99',
  period: 'annual',
  introductoryOffer: { localizedDuration: '7 days' },
};

export function makeFakeBillingPort(): BillingPort {
  return {
    async getOffer(): Promise<SubscriptionOffer | null> {
      return HARNESS_OFFER;
    },
    async purchase(): Promise<PurchaseOutcome> {
      // The harness never charges; report the store took the money so the screen shows
      // its "confirming your membership" path.
      return { kind: 'purchased' };
    },
    async restore(): Promise<{ readonly restored: boolean }> {
      return { restored: true };
    },
  };
}

// A tiny in-memory buffer standing in for photo bytes. The screener never reads them;
// they exist so a PickedPhoto is well-formed (bytes is a required ArrayBuffer).
function fakeBytes(seed: number): ArrayBuffer {
  return new Uint8Array([seed, seed + 1, seed + 2, seed + 3]).buffer;
}

// A 1x1 transparent PNG data URI — renders in <Image> with no network.
const PIXEL_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PICKED: readonly PickedPhoto[] = [
  { id: 'harness-photo-1', source: 'hand_picked', uri: PIXEL_URI, bytes: fakeBytes(1), contentType: 'image/png' },
  { id: 'harness-photo-2', source: 'hand_picked', uri: PIXEL_URI, bytes: fakeBytes(9), contentType: 'image/png' },
];

// The fake photo port DELEGATES screen() and sha256Hex to the REAL adapter and overrides
// only `available` and `pickPhotos`. That is deliberate, not lazy: screenPhoto() is the
// sole (unforgeable) ScreenedPhoto constructor, and chokepoint.test.ts enforces that it is
// called ONLY by the port adapter (src/photo/photoIntakeNative.ts) — so the harness must
// not call it. The real adapter records `undetermined` for every photo (no ML runtime is
// bound), and intake.mayOffer ADMITS a hand_picked + undetermined photo, so the canned
// photos still populate the add-garment candidate grid.
export function makeFakePhotoIntakePort(): PhotoIntakePort {
  const real = makePhotoIntakePort();
  return {
    ...real,
    // available:true so AddGarmentScreen renders the pick + candidate flow rather than the
    // "photo import isn't ready" unavailable state.
    available: true,
    async pickPhotos(): Promise<readonly PickedPhoto[]> {
      return PICKED;
    },
  };
}
