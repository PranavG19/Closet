// Paywall (docs/03: premium, honest, no dark patterns — value already shown). This
// skeleton reads the real entitlement via useEntitlement() and branches: an active
// entitlement shows the "you're subscribed" state; otherwise the offer. The actual
// RevenueCat purchase call is intentionally NOT wired here — the purchase/webhook
// money path is human-gated and owned server-side; this screen only READS the
// entitlement the webhook writes and presents the offer structure.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { useEntitlement } from '../../src/api/index.js';
import { Screen, Card, Text, Button, LoadingState, ErrorState } from '../../src/ui/index.js';

const VALUE_POINTS: readonly string[] = [
  'Unlimited garment parsing',
  'Daily outfit suggestions',
  'Your full palette match',
];

export function PaywallScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useEntitlement();

  if (query.isPending) return <LoadingState message="Checking your membership…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't check your membership." onRetry={() => void query.refetch()} />;
  }

  if (query.data.entitlement_active) {
    return (
      <Screen padding="lg">
        <Card variant="surface" padding="lg">
          <Text variant="title" tone="primary">
            You're a member
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: tokens.spacing.sm }}>
            Thank you — every feature is unlocked.
          </Text>
        </Card>
      </Screen>
    );
  }

  const point: ViewStyle = { flexDirection: 'row', alignItems: 'center', marginTop: tokens.spacing.sm };
  const dot: ViewStyle = {
    width: tokens.spacing.sm,
    height: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.accent.pink,
    marginRight: tokens.spacing.sm,
  };

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.sm }}>
        Go premium
      </Text>
      <Text variant="body" tone="secondary" style={{ marginBottom: tokens.spacing.lg }}>
        Your wardrobe, styled every day. Cancel anytime.
      </Text>
      <Card variant="surface" padding="lg">
        {VALUE_POINTS.map((text) => (
          <View key={text} style={point}>
            <View style={dot} />
            <Text variant="body" tone="primary">
              {text}
            </Text>
          </View>
        ))}
        <Button
          label="Subscribe"
          accent="pink"
          onPress={() => {}}
          style={{ marginTop: tokens.spacing.xl }}
        />
        <Text variant="caption" tone="tertiary" style={{ marginTop: tokens.spacing.md, textAlign: 'center' }}>
          Billed through the App Store. No hidden charges.
        </Text>
      </Card>
    </Screen>
  );
}
