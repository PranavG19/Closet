// Today's suggestion card (F5). The daily loop's heuristic runs ON-DEVICE over the
// user's own wardrobe (docs/06: zero server endpoint) — this skeleton renders the
// suggestion CARD structure over the wardrobe data the client already has, with a
// gentle (advisory, never bossy) palette/harmony highlight slot and a one-tap
// "I wore this" wear-log affordance. The heuristic wiring itself lands with the
// on-device suggestion pure-fn integration; this is the structural surface.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useLogWear } from '../../src/api/index.js';
import { Screen, Card, Text, Button, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';

// client_id is minted by the CALLER at tap time (idempotency). uuid via the RN
// crypto global; a retry of the same tap reuses this id so the wear row dedups.
function mintClientId(): string {
  return (globalThis.crypto as { randomUUID(): string }).randomUUID();
}

export function SuggestionsScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useWardrobe({ availability: 'clean' });
  const logWear = useLogWear();

  if (query.isPending) return <LoadingState message="Putting together today's look…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't build a suggestion." onRetry={() => void query.refetch()} />;
  }

  const hero = query.data.items[0];
  if (hero === undefined) {
    return (
      <EmptyState
        title="Nothing to suggest yet"
        body="Add a few pieces and we'll style today's look for you."
      />
    );
  }

  // Gentle highlight strip — advisory, never a red error/nag (docs/03).
  const highlight: ViewStyle = {
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.accent.pink,
    paddingLeft: tokens.spacing.md,
    marginTop: tokens.spacing.md,
  };
  const heroWell: ViewStyle = {
    aspectRatio: 1,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.md,
  };

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Today
      </Text>
      <Card variant="surface" padding="lg">
        <View style={heroWell} accessibilityLabel={`Suggested ${hero.category}`}>
          <Text variant="caption" tone="tertiary">
            {hero.category}
          </Text>
        </View>
        <Text variant="title" tone="primary">
          {hero.color ?? hero.category}
        </Text>
        <View style={highlight}>
          <Text variant="body" tone="secondary">
            This pairs beautifully with your neutrals.
          </Text>
        </View>
        <Button
          label={logWear.isPending ? 'Logging…' : 'I wore this'}
          disabled={logWear.isPending}
          onPress={() => logWear.mutate({ item_id: hero.id, client_id: mintClientId() })}
          style={{ marginTop: tokens.spacing.lg }}
        />
      </Card>
    </Screen>
  );
}
