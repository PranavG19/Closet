// The App Store / Play required subscription disclosure, as a PURE FUNCTION of the
// store's offer. This is the text Apple review reads on the paywall, so it is derived in
// one place and unit-tested against the spec rather than hand-written into a screen where
// nothing can check it.
//
// The authority is docs/legal/subscription-terms.md §7, which lists exactly what must
// appear adjacent to the purchase control:
//   - localised price and period, READ FROM THE STORE, never hardcoded
//   - the words "renews automatically" and "until you cancel"
//   - cancellation happens in platform settings, NOT in the app
//   - trial terms ONLY if a trial actually exists, including the post-trial price
// App Store Guideline 3.1.2 makes the price/period/renewal terms a binary requirement:
// a paywall without them is a rejection, which is what the pre-fix screen would have got.
//
// It returns SENTENCES, not a formatted blob, so the screen controls layout while the
// wording stays here.
import type { BillingPeriod, SubscriptionOffer } from './ports/BillingPort.js';

// How each period is said in the renewal sentence. A closed map rather than string
// interpolation on the enum value: "renews automatically at $4.99 per annual" is wrong,
// and a ternary chain would silently fall through if a period were added.
const PER_PERIOD: Readonly<Record<BillingPeriod, string>> = {
  weekly: 'per week',
  monthly: 'per month',
  annual: 'per year',
};

// The headline period phrasing ("Monthly" / "Yearly"), separate from PER_PERIOD because
// "$4.99 per month" and "Monthly membership" need different grammar.
const PERIOD_NOUN: Readonly<Record<BillingPeriod, string>> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  annual: 'Yearly',
};

export interface SubscriptionDisclosure {
  // e.g. "Monthly membership — $4.99". The price-bearing line; must be visible, not
  // behind a link or a scroll.
  readonly headline: string;
  // The auto-renewal sentence. Contains "renews automatically" and "until you cancel".
  readonly renewal: string;
  // Where cancellation happens. Apple requires this to point at platform settings, and
  // requires the app NOT to claim it can cancel on her behalf.
  readonly cancellation: string;
  // The trial sentence, present ONLY when the offer actually carries an introductory
  // offer. `undefined` means render nothing — trial language with no trial is itself a
  // violation, and it is also just a lie.
  readonly trial?: string;
}

export function subscriptionDisclosure(offer: SubscriptionOffer): SubscriptionDisclosure {
  const per = PER_PERIOD[offer.period];

  const disclosure: SubscriptionDisclosure = {
    headline: `${PERIOD_NOUN[offer.period]} membership — ${offer.localizedPrice}`,
    // "at least 24 hours before" is the store's actual cancellation deadline, not a
    // rounded "before it renews" — understating it would mislead her into a charge.
    renewal:
      `Renews automatically at ${offer.localizedPrice} ${per} until you cancel. ` +
      `Cancel at least 24 hours before the period ends to stop the next charge.`,
    cancellation: 'Manage or cancel anytime in your device account settings.',
  };

  if (offer.introductoryOffer === undefined) return disclosure;

  // Post-trial price stated explicitly: Apple requires what happens at the end of the
  // trial AND the price charged then, adjacent to the purchase.
  return {
    ...disclosure,
    trial:
      `Includes a ${offer.introductoryOffer.localizedDuration} free trial. ` +
      `You'll be charged ${offer.localizedPrice} ${per} when it ends unless you cancel first.`,
  };
}
