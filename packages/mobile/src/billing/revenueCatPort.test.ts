// Unit tests for the RevenueCat → BillingPort adapter. No native module, no device: the
// adapter takes its native surface as an injected shape precisely so these decisions are
// checkable here.
//
// The oracle is the CONTRACT (BillingPort's documented semantics + App Store 3.1.2), not
// the adapter's own output. Each test states the rule it enforces.
import { describe, it, expect, vi } from 'vitest';
import {
  makeRevenueCatBillingPort,
  type RevenueCatPackage,
  type RevenueCatSurface,
} from './revenueCatPort.js';

const MONTHLY_PKG: RevenueCatPackage = {
  identifier: '$rc_monthly',
  product: {
    identifier: 'closet_premium_monthly',
    priceString: '$4.99',
    subscriptionPeriod: 'P1M',
    introPrice: null,
  },
};

function surface(overrides: Partial<RevenueCatSurface> = {}): RevenueCatSurface {
  return {
    getCurrentOffering: async () => ({ availablePackages: [MONTHLY_PKG] }),
    purchasePackage: async () => ({ hasEntitlement: true }),
    restore: async () => ({ hasEntitlement: false }),
    wasCancelled: () => false,
    wasAlreadyOwned: () => false,
    ...overrides,
  };
}

describe('getOffer — the price must be the store string, or there must be no offer', () => {
  it('passes the store priceString through verbatim, never reformatted', async () => {
    const offer = await makeRevenueCatBillingPort(surface()).getOffer();
    expect(offer?.localizedPrice).toBe('$4.99');
    expect(offer?.productId).toBe('closet_premium_monthly');
    expect(offer?.period).toBe('monthly');
  });

  it('preserves a non-USD price with a comma separator and trailing symbol', async () => {
    // Any attempt to parse this into a number and re-format it would corrupt it.
    const pkg = { ...MONTHLY_PKG, product: { ...MONTHLY_PKG.product, priceString: '4,99 €' } };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer?.localizedPrice).toBe('4,99 €');
  });

  it('maps each ISO-8601 period RC can return', async () => {
    for (const [iso, expected] of [
      ['P1W', 'weekly'],
      ['P7D', 'weekly'],
      ['P1M', 'monthly'],
      ['P1Y', 'annual'],
    ] as const) {
      const pkg = { ...MONTHLY_PKG, product: { ...MONTHLY_PKG.product, subscriptionPeriod: iso } };
      const offer = await makeRevenueCatBillingPort(
        surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
      ).getOffer();
      expect(offer?.period).toBe(expected);
    }
  });

  it('returns NULL for an unrecognised period rather than a price with the wrong period', async () => {
    // "$49.99 per month" on an annual plan is worse than showing nothing: it is a real
    // price attached to a false billing term.
    const pkg = { ...MONTHLY_PKG, product: { ...MONTHLY_PKG.product, subscriptionPeriod: 'P3M' } };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer).toBeNull();
  });

  it('returns NULL for a missing period', async () => {
    const pkg = { ...MONTHLY_PKG, product: { ...MONTHLY_PKG.product, subscriptionPeriod: null } };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer).toBeNull();
  });

  it('returns NULL for a BLANK price instead of rendering an empty paywall', async () => {
    // The 3.1.2 rejection, caught at the boundary by SubscriptionOffer's .min(1).
    const pkg = { ...MONTHLY_PKG, product: { ...MONTHLY_PKG.product, priceString: '' } };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer).toBeNull();
  });

  it('returns NULL when the store has no offering configured', async () => {
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => null }),
    ).getOffer();
    expect(offer).toBeNull();
  });

  it('returns NULL when the offering exists but has no packages', async () => {
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [] }) }),
    ).getOffer();
    expect(offer).toBeNull();
  });

  it('surfaces an introductory offer with a humanised duration', async () => {
    const pkg = {
      ...MONTHLY_PKG,
      product: {
        ...MONTHLY_PKG.product,
        introPrice: { periodNumberOfUnits: 7, periodUnit: 'DAY' },
      },
    };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer?.introductoryOffer?.localizedDuration).toBe('7 days');
  });

  it('singularises a one-unit trial', async () => {
    const pkg = {
      ...MONTHLY_PKG,
      product: {
        ...MONTHLY_PKG.product,
        introPrice: { periodNumberOfUnits: 1, periodUnit: 'MONTH' },
      },
    };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer?.introductoryOffer?.localizedDuration).toBe('1 month');
  });

  it('OMITS the trial entirely when the intro period is nonsense, rather than claiming one', async () => {
    // Trial language with no real trial is a store violation and a false statement, so a
    // malformed intro must vanish — not degrade to "0 days".
    const pkg = {
      ...MONTHLY_PKG,
      product: {
        ...MONTHLY_PKG.product,
        introPrice: { periodNumberOfUnits: 0, periodUnit: 'DAY' },
      },
    };
    const offer = await makeRevenueCatBillingPort(
      surface({ getCurrentOffering: async () => ({ availablePackages: [pkg] }) }),
    ).getOffer();
    expect(offer).not.toBeNull();
    expect(offer?.introductoryOffer).toBeUndefined();
  });
});

describe('purchase — cancellation is not an error, and a failure is never silent', () => {
  it('reports `purchased` when the store confirms an entitlement', async () => {
    const outcome = await makeRevenueCatBillingPort(surface()).purchase('closet_premium_monthly');
    expect(outcome.kind).toBe('purchased');
  });

  it('reports `cancelled` when she dismisses the sheet — checked BEFORE failure', async () => {
    const outcome = await makeRevenueCatBillingPort(
      surface({
        purchasePackage: async () => {
          throw new Error('user cancelled');
        },
        wasCancelled: () => true,
      }),
    ).purchase('closet_premium_monthly');
    expect(outcome.kind).toBe('cancelled');
  });

  it('reports `alreadyOwned` distinctly, so an existing member is not told she failed', async () => {
    const outcome = await makeRevenueCatBillingPort(
      surface({
        purchasePackage: async () => {
          throw new Error('already purchased');
        },
        wasAlreadyOwned: () => true,
      }),
    ).purchase('closet_premium_monthly');
    expect(outcome.kind).toBe('alreadyOwned');
  });

  it('reports `failed` for a declined payment — NOT disguised as a cancellation', async () => {
    // Disguising a decline as a cancel means she never learns why nothing happened.
    const outcome = await makeRevenueCatBillingPort(
      surface({
        purchasePackage: async () => {
          throw new Error('payment declined');
        },
      }),
    ).purchase('closet_premium_monthly');
    expect(outcome.kind).toBe('failed');
  });

  it('reports `failed` when the store resolves without an entitlement', async () => {
    const outcome = await makeRevenueCatBillingPort(
      surface({ purchasePackage: async () => ({ hasEntitlement: false }) }),
    ).purchase('closet_premium_monthly');
    expect(outcome.kind).toBe('failed');
  });

  it('reports `failed` — and never charges — when the productId is not in the offering', async () => {
    const purchasePackage = vi.fn(async () => ({ hasEntitlement: true }));
    const outcome = await makeRevenueCatBillingPort(surface({ purchasePackage })).purchase(
      'some_other_product',
    );
    expect(outcome.kind).toBe('failed');
    // The important half: no purchase was attempted for a product we could not resolve.
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('purchases the package matching the requested productId, not merely the first', async () => {
    const other: RevenueCatPackage = {
      identifier: '$rc_annual',
      product: {
        identifier: 'closet_premium_annual',
        priceString: '$39.99',
        subscriptionPeriod: 'P1Y',
        introPrice: null,
      },
    };
    const purchasePackage = vi.fn(async () => ({ hasEntitlement: true }));
    await makeRevenueCatBillingPort(
      surface({
        getCurrentOffering: async () => ({ availablePackages: [MONTHLY_PKG, other] }),
        purchasePackage,
      }),
    ).purchase('closet_premium_annual');
    expect(purchasePackage).toHaveBeenCalledWith(other);
  });
});

describe('restore', () => {
  it('reports restored=true when an entitlement came back', async () => {
    const result = await makeRevenueCatBillingPort(
      surface({ restore: async () => ({ hasEntitlement: true }) }),
    ).restore();
    expect(result.restored).toBe(true);
  });

  it('reports restored=false when there was nothing to restore', async () => {
    // Distinguishable so the screen can say "we didn't find a membership" rather than
    // leaving a tapped button looking broken.
    const result = await makeRevenueCatBillingPort(surface()).restore();
    expect(result.restored).toBe(false);
  });
});
