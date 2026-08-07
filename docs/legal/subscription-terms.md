**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**

# [App Name] — Subscription Terms (auto-renewable subscription disclosures)

**Status:** unpublished draft. **Effective date:** [TO BE CONFIRMED: TBC-01]
**Last updated:** [TO BE CONFIRMED: TBC-02]

> These are the Apple- and Google-mandated auto-renewable-subscription disclosures plus the
> commercial terms. Apple's App Review Guideline 3.1.2 requires specific disclosures **both** in the
> app binary adjacent to the purchase control **and** in the terms linked from the App Store listing;
> §7 below is the paywall text that satisfies the in-binary half. Do not publish until the price,
> period and trial fields are filled — a placeholder price on a live paywall is a rejection and a
> consumer-law problem. Consolidated placeholder checklist: `docs/legal/README.md`.

---

## 1. What the subscription unlocks

Without a subscription you can:

- sign in, run the on-device photo screening, approve photos, and have a **small preview batch** of
  your own garments processed and shown to you as clean cutouts, so you can see the product working
  on your real clothes before paying. The preview batch is capped per account at a small number of
  photos ([TO BE CONFIRMED: TBC-38 — the exact preview cap to state publicly; the current server-side
  cap is 10 photos per account, which is an implementation value, not yet a published commitment]).

With an active subscription you get:

- **processing of the rest of your approved photos** into your full wardrobe;
- the **wardrobe library** — browse and filter your digitised closet, and resolve near-duplicates;
- **weather-aware daily outfit suggestions** from what you have marked clean;
- the **manual outfit builder** and saved outfits;
- **availability tracking** (clean / in the wash / unavailable);
- the **one-tap wear log**;
- **colour-harmony guidance** and the optional self-identified **colour palette (beta)**.

To be accurate about the limits:

- Processing volume is not literally unlimited. Fair-use rate limits and per-account processing caps
  apply so that one account cannot consume our paid processing capacity.
  [TO BE CONFIRMED: TBC-39 — the fair-use position to state publicly, and the exact wording used on
  the paywall. The paywall must not say "unlimited" if a cap exists.]
- Virtual try-on, shopping, analytics and social features are **not** included and are not part of
  the app.
- The colour palette is labelled **beta**.
- All styling and colour guidance is **advisory** — see `terms-of-service.md` §4.

## 2. Price, period, and trial

- **Price:** [TO BE CONFIRMED: TBC-40 — price per period, per currency/storefront. Prices are set per
  App Store / Google Play storefront and may differ by country; the in-app paywall must display the
  localised price returned by the store, not a hardcoded figure.]
- **Billing period:** [TO BE CONFIRMED: TBC-41 — the subscription period(s) offered, e.g. monthly
  and/or annual]
- **Free trial or introductory offer:** [TO BE CONFIRMED: TBC-42 — the product intent recorded in the
  product documentation is a hard paywall with **no free trial**. Confirm this is still the commercial
  decision. If it stays "no trial", say so plainly here and remove trial language; if any
  introductory offer is ever added, Apple and Google both require the trial length, what happens at
  the end of the trial, and the post-trial price to be disclosed adjacent to the purchase.]
- Taxes may apply depending on your country and are handled by the store.

## 3. Auto-renewal — the required disclosure

- **Your subscription renews automatically.** Payment is charged to your Apple ID or Google account
  at confirmation of purchase and again at the start of each renewal period.
- **It keeps renewing until you cancel it.** There is no fixed end date.
- **Renewal is charged within 24 hours before the end of the current period**, at the then-current
  price for your subscription.
- **To stop renewing, you must cancel at least 24 hours before the current period ends.** Cancelling
  later than that means the next period has already been charged and you keep access until it ends.

## 4. How to cancel — this is in your platform settings, not in the app

**You cancel with Apple or Google, not with us.** We cannot cancel your subscription for you, and we
cannot stop a renewal on your behalf.

- **iOS / iPadOS:** Settings → tap your name → Subscriptions → [App Name] → Cancel Subscription.
  (Or: App Store → your account → Subscriptions.)
- **Android:** Google Play Store → your profile icon → Payments & subscriptions → Subscriptions →
  [App Name] → Cancel subscription.

**Deleting the app does not cancel your subscription. Deleting your [App Name] account does not
cancel your subscription either.** If you want both, cancel in your platform settings *and* delete
your account in the app — they are separate actions with separate effects.

When you cancel, you keep access until the end of the period you have already paid for.

## 5. Restoring purchases

If you reinstall the app, change device, or sign in again, use **Restore Purchases** on the paywall to
re-link the subscription attached to your Apple ID or Google account.
[TO BE CONFIRMED: TBC-43 — Apple requires a restore mechanism for non-consumable and auto-renewable
purchases. The paywall screen currently in the repository does not yet have a Restore Purchases
control wired; it must be present and working before submission.]

Your subscription is tied to your **store account** (Apple ID / Google account). If you sign in to
[App Name] with a different sign-in identity than the one previously entitled, your entitlement may
not appear — contact us at [TO BE CONFIRMED: TBC-05] and we will help.

There may be a short delay between a successful purchase or renewal and the unlock appearing in the
app, because the store notifies our systems asynchronously.

## 6. Refunds

**Refunds are handled by the platform, not by us.** We are not the seller of record and we cannot
issue refunds for in-app purchases.

- **Apple:** request a refund at reportaproblem.apple.com.
- **Google:** request a refund through Google Play.

[TO BE CONFIRMED: TBC-44 — statutory withdrawal/cooling-off rights. EU/UK consumers generally have a
14-day right of withdrawal for digital content, subject to the express-consent-and-acknowledgement
exception where supply begins immediately. Counsel must state the position and confirm how it
interacts with Apple's and Google's refund processes, which we do not control.]

## 7. Required disclosure text for the paywall (adjacent to the purchase control)

The following must appear on the paywall screen itself, visible next to the subscribe button — not
only behind a link — with functioning links to the Terms of Service and the Privacy Policy. Apple
requires the price, period, and auto-renewal terms to be present in the binary.

> **[App Name] Premium — [TO BE CONFIRMED: TBC-41 period] for [TO BE CONFIRMED: TBC-40 price].**
> Your subscription renews automatically at [price] per [period] unless you cancel at least 24 hours
> before the end of the current period. Payment is charged to your [Apple ID / Google account] at
> confirmation of purchase. Manage or cancel your subscription in your
> [Apple ID / Google Play] account settings — not in the app.
> [If, and only if, an introductory offer exists: "Includes a [length] free trial. You will be
> charged [price] when the trial ends unless you cancel at least 24 hours before it ends." Otherwise
> omit entirely — see TBC-42.]
> [Terms of Service] · [Privacy Policy] · [Restore Purchases]

Checklist for whoever builds that screen:

- [ ] localised price and period shown, read from the store, never hardcoded
- [ ] the words "renews automatically" (or equivalent) and "until you cancel"
- [ ] cancellation is stated to happen in platform settings
- [ ] trial terms shown **only** if a trial actually exists, with post-trial price
- [ ] tappable link to the Terms of Service
- [ ] tappable link to the Privacy Policy
- [ ] a working **Restore Purchases** control (TBC-43)
- [ ] no countdown timers, fake scarcity, or pre-checked upsells — the product's own rule is no dark
      patterns

## 8. Price changes

If we change the price, Apple and Google will notify you and, where their rules require it, ask for
your consent before the new price is charged. If you do not agree, cancel before the next renewal.
[TO BE CONFIRMED: TBC-45 — align this with current Apple and Google price-change consent rules at
submission time, and with any consumer-law notice period.]

## 9. Family Sharing and multiple devices

[TO BE CONFIRMED: TBC-46 — whether Family Sharing (Apple) / family library (Google) is enabled for
the subscription product. If it is not enabled, say so, because users ask.]

## 10. If the subscription cannot be delivered

If the paid features are unavailable for an extended period, contact us at
[TO BE CONFIRMED: TBC-05].
[TO BE CONFIRMED: TBC-31 / TBC-35 — remedy and refund position for extended unavailability or
discontinuation, given that we cannot issue store refunds ourselves.]

## 11. Related documents

`terms-of-service.md` · `privacy-policy.md`

---

**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**
