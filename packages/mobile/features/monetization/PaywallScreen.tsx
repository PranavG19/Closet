// Paywall (docs/03: premium, honest, no dark patterns — value already shown).
//
// APP STORE GUIDELINE 3.1.2 IS THE HARD REQUIREMENT THIS SCREEN EXISTS TO SATISFY. The
// price, the billing period, and the auto-renewal terms must be present IN THE BINARY,
// visible adjacent to the purchase control — not behind a link, not fetched from a web
// page. The previous version of this screen rendered three value bullets, a `Subscribe`
// button with `onPress={() => {}}`, and no number anywhere; that is a rejection on sight,
// and it was invisible to a 228-test suite because no test-shaped oracle can see a missing
// price. The disclosure text itself lives in @closet/shared's subscriptionDisclosure() so
// it is unit-tested against docs/legal/subscription-terms.md §7 rather than hand-written
// here where nothing checks it.
//
// THE PRICE IS NEVER HARDCODED. It is the store's own localised display string, read
// through BillingPort. See that port for why a formatted string beats a number + currency
// code (decimal separators, symbol placement, tax-inclusive storefronts).
//
// ENTITLEMENT IS NEVER GRANTED CLIENT-SIDE. A successful purchase means "the store took
// the money", not "she is entitled". The RevenueCat webhook is the sole writer of
// subscriptions.entitlement_active; this screen re-reads the entitlement after a purchase
// and lets the server be the truth. That is why `purchased` refetches rather than
// optimistically flipping to the member state.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { subscriptionDisclosure } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useEntitlement } from '../../src/api/index.js';
import { Screen, Card, Text, Button, LoadingState, ErrorState } from '../../src/ui/index.js';
import { useOffer, usePurchase, useRestore } from './hooks.js';
import { useScreenLoad } from '../../src/metrics/index.js';

const VALUE_POINTS: readonly string[] = [
  'Every piece you own, digitised',
  'A look chosen for you each morning',
  'Styled around your colours',
];

export function PaywallScreen(): React.JSX.Element {
  const tokens = useTokens();
  const entitlement = useEntitlement();
  const offer = useOffer();
  const purchase = usePurchase();
  const restore = useRestore();
  // Mount → first-ready metric. Ready = the entitlement check resolved (the first gate the screen
  // waits on; the offer load follows). Unconditional, before any early return (Rules of Hooks).
  useScreenLoad('paywall', entitlement.isSuccess);

  // A one-line status under the button. Deliberately not an alert or a modal: a
  // cancellation must produce NO interruption (it is the most common outcome of tapping
  // subscribe, and an error dialog there is the dark pattern the product rules out).
  const [notice, setNotice] = React.useState<string | null>(null);

  if (entitlement.isPending) return <LoadingState message="Checking your membership…" />;
  if (entitlement.isError) {
    return (
      <ErrorState
        body="We couldn't check your membership."
        onRetry={() => void entitlement.refetch()}
      />
    );
  }

  if (entitlement.data.entitlement_active) {
    return (
      <Screen padding="lg">
        <Card variant="surface" padding="lg">
          <Text variant="title" tone="primary">
            You&apos;re a member
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: tokens.spacing.sm }}>
            Thank you — every feature is unlocked.
          </Text>
        </Card>
      </Screen>
    );
  }

  const point: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: tokens.spacing.sm,
  };
  const dot: ViewStyle = {
    width: tokens.spacing.sm,
    height: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.accentDecorative.pink,
    marginRight: tokens.spacing.sm,
  };

  const valueCard = (
    <>
      {VALUE_POINTS.map((text) => (
        <View key={text} style={point}>
          <View style={dot} />
          <Text variant="body" tone="primary">
            {text}
          </Text>
        </View>
      ))}
    </>
  );

  // NO OFFER FROM THE STORE — products not yet approved, or unavailable in this
  // storefront. Say so plainly and show NO subscribe button. Rendering the button with a
  // blank price is precisely the 3.1.2 failure, so the button is gated on having a real
  // price rather than defaulting to one.
  if (offer.isPending) return <LoadingState message="Loading membership options…" />;
  if (offer.isError || offer.data === null) {
    return (
      <Screen scroll padding="lg">
        <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.sm }}>
          Your whole closet, waiting
        </Text>
        <Card variant="surface" padding="lg">
          {valueCard}
          <Text variant="body" tone="secondary" style={{ marginTop: tokens.spacing.lg }}>
            Membership isn&apos;t available right now. Please try again later.
          </Text>
          <Button
            label="Try again"
            intent="secondary"
            onPress={() => void offer.refetch()}
            style={{ marginTop: tokens.spacing.md }}
          />
          <Button
            label="Restore purchases"
            intent="ghost"
            onPress={() => {
              setNotice(null);
              restore.mutate(undefined, {
                onSuccess: (result) => {
                  setNotice(
                    result.restored
                      ? 'Your membership is restored.'
                      : "We didn't find a previous membership.",
                  );
                  if (result.restored) void entitlement.refetch();
                },
                onError: () => setNotice("We couldn't reach the store."),
              });
            }}
            style={{ marginTop: tokens.spacing.sm }}
          />
          {notice !== null && (
            <Text
              variant="caption"
              tone="secondary"
              // Live region so VoiceOver announces the purchase/restore outcome — this is the
              // entitlement path, and a silent "confirming your membership…" / "not charged" is
              // the worst place for a status a screen-reader user can't hear (WCAG 4.1.3).
              accessibilityLiveRegion="polite"
              style={{ marginTop: tokens.spacing.sm, textAlign: 'center' }}
            >
              {notice}
            </Text>
          )}
        </Card>
      </Screen>
    );
  }

  const disclosure = subscriptionDisclosure(offer.data);
  const productId = offer.data.productId;

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.sm }}>
        Go premium
      </Text>
      <Text variant="body" tone="secondary" style={{ marginBottom: tokens.spacing.lg }}>
        Your wardrobe, styled every day. Cancel anytime.
      </Text>
      <Card variant="surface" padding="lg">
        {valueCard}

        {/* THE PRICE. Guideline 3.1.2 requires it adjacent to the purchase control, so it
            sits directly above the button and is `title` weight — the one number she needs
            before deciding, never a caption she can miss. */}
        <Text variant="title" tone="primary" style={{ marginTop: tokens.spacing.lg }}>
          {disclosure.headline}
        </Text>

        {disclosure.trial !== undefined && (
          <Text variant="body" tone="secondary" style={{ marginTop: tokens.spacing.sm }}>
            {disclosure.trial}
          </Text>
        )}

        <Button
          label={purchase.isPending ? 'Opening the store…' : 'Become a member'}
          accent="pink"
          disabled={purchase.isPending}
          onPress={() => {
            setNotice(null);
            purchase.mutate(productId, {
              onSuccess: (outcome) => {
                switch (outcome.kind) {
                  case 'purchased':
                    // The store charged her. The entitlement still arrives server-side via
                    // the webhook, so re-read it rather than flipping the UI ourselves —
                    // the honest message is "confirming", not "you're a member".
                    setNotice('Thank you — confirming your membership…');
                    void entitlement.refetch();
                    return;
                  case 'alreadyOwned':
                    setNotice('You already have a membership — restoring it.');
                    void entitlement.refetch();
                    return;
                  case 'cancelled':
                    // Say NOTHING. She chose to close the sheet; that is not an error.
                    return;
                  case 'failed':
                    setNotice("We couldn't complete that purchase. You have not been charged.");
                    return;
                }
              },
              onError: () =>
                setNotice("We couldn't reach the store. You have not been charged."),
            });
          }}
          style={{ marginTop: tokens.spacing.lg }}
        />

        {/* The auto-renewal + cancellation disclosures. Required text, and required to be
            legible — `caption`/`secondary`, never tertiary, which fails WCAG AA contrast
            on this canvas. */}
        <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.md }}>
          {disclosure.renewal}
        </Text>
        <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.xs }}>
          {disclosure.cancellation}
        </Text>

        {/* Apple requires a restore control for auto-renewable subscriptions
            (docs/legal/subscription-terms.md §7). A reinstalling member must be able to get
            her membership back without paying twice. */}
        <Button
          label={restore.isPending ? 'Checking…' : 'Restore purchases'}
          intent="ghost"
          disabled={restore.isPending}
          onPress={() => {
            setNotice(null);
            restore.mutate(undefined, {
              onSuccess: (result) => {
                setNotice(
                  result.restored
                    ? 'Your membership is restored.'
                    : "We didn't find a previous membership.",
                );
                if (result.restored) void entitlement.refetch();
              },
              onError: () => setNotice("We couldn't reach the store."),
            });
          }}
          style={{ marginTop: tokens.spacing.sm }}
        />

        {notice !== null && (
          <Text
            variant="caption"
            tone="secondary"
            // Live region so VoiceOver announces the purchase/restore outcome — this is the
            // entitlement path, and a silent "confirming your membership…" / "not charged" is
            // the worst place for a status a screen-reader user can't hear (WCAG 4.1.3).
            accessibilityLiveRegion="polite"
            style={{ marginTop: tokens.spacing.sm, textAlign: 'center' }}
          >
            {notice}
          </Text>
        )}
      </Card>
    </Screen>
  );
}
