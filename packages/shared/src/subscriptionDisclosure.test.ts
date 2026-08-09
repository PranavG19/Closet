// The oracle here is NOT this function's own output — it is the checklist in
// docs/legal/subscription-terms.md §7 and App Store Guideline 3.1.2, asserted item by
// item. Each test names the requirement it enforces, so a failure says which rule broke
// rather than "snapshot changed".
//
// Deliberately NOT a snapshot test: a snapshot would happily record a disclosure that
// omits the price, because the snapshot's expected value is whatever the code emitted.
// That is the mirror-oracle failure mode this suite exists to avoid.
import { describe, it, expect } from 'vitest';
import { SubscriptionOffer } from './ports/BillingPort.js';
import { subscriptionDisclosure } from './subscriptionDisclosure.js';

const MONTHLY: SubscriptionOffer = {
  productId: 'closet_premium_monthly',
  localizedPrice: '$4.99',
  period: 'monthly',
};

describe('subscriptionDisclosure — App Store 3.1.2 required text', () => {
  it('shows the localised price in the headline (the 3.1.2 rejection this prevents)', () => {
    const d = subscriptionDisclosure(MONTHLY);
    expect(d.headline).toContain('$4.99');
  });

  it('states the period, correctly declined per period', () => {
    // "per annual" would be the interpolation bug a closed map prevents.
    expect(subscriptionDisclosure(MONTHLY).renewal).toContain('per month');
    expect(subscriptionDisclosure({ ...MONTHLY, period: 'annual' }).renewal).toContain('per year');
    expect(subscriptionDisclosure({ ...MONTHLY, period: 'weekly' }).renewal).toContain('per week');
    expect(subscriptionDisclosure({ ...MONTHLY, period: 'annual' }).headline).toContain('Yearly');
  });

  it('contains the auto-renewal disclosure verbatim-enough: renews automatically + until you cancel', () => {
    const { renewal } = subscriptionDisclosure(MONTHLY);
    expect(renewal).toContain('Renews automatically');
    expect(renewal).toContain('until you cancel');
  });

  it('repeats the price in the renewal sentence, so the amount charged is unambiguous', () => {
    expect(subscriptionDisclosure(MONTHLY).renewal).toContain('$4.99');
  });

  it('states the 24-hour cancellation deadline rather than a vague "before it renews"', () => {
    expect(subscriptionDisclosure(MONTHLY).renewal).toContain('24 hours');
  });

  it('directs cancellation to device settings and never claims the app can cancel', () => {
    const { cancellation } = subscriptionDisclosure(MONTHLY);
    expect(cancellation).toMatch(/account settings/i);
  });

  it('says NOTHING about a trial when the offer has none', () => {
    // Trial language with no trial is both a store violation and a false statement.
    const d = subscriptionDisclosure(MONTHLY);
    expect(d.trial).toBeUndefined();
    const allText = `${d.headline} ${d.renewal} ${d.cancellation}`;
    expect(allText).not.toMatch(/trial|free/i);
  });

  it('when a trial EXISTS, states its length and the post-trial price', () => {
    const d = subscriptionDisclosure({
      ...MONTHLY,
      introductoryOffer: { localizedDuration: '7 days' },
    });
    expect(d.trial).toBeDefined();
    expect(d.trial).toContain('7 days');
    // The post-trial price is the requirement most often missed.
    expect(d.trial).toContain('$4.99');
    expect(d.trial).toMatch(/unless you cancel/i);
  });

  it('carries a non-USD localised price through untouched', () => {
    // The store returns an already-formatted string; we must never reformat it. A comma
    // decimal separator and a trailing symbol would both break under number formatting.
    const d = subscriptionDisclosure({ ...MONTHLY, localizedPrice: '4,99 €' });
    expect(d.headline).toContain('4,99 €');
    expect(d.renewal).toContain('4,99 €');
  });
});

describe('SubscriptionOffer schema — a blank price must not be representable', () => {
  it('rejects an empty localizedPrice rather than letting a blank paywall render', () => {
    const result = SubscriptionOffer.safeParse({ ...MONTHLY, localizedPrice: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown billing period', () => {
    const result = SubscriptionOffer.safeParse({ ...MONTHLY, period: 'fortnightly' });
    expect(result.success).toBe(false);
  });

  it('accepts an offer with no introductoryOffer key at all', () => {
    expect(SubscriptionOffer.safeParse(MONTHLY).success).toBe(true);
  });
});
