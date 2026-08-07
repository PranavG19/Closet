// Wardrobe grid — the signature surface (docs/03). Cutouts sit centered on a
// bg.sunken well so garments feel lifted off the page. This is a STRUCTURAL
// skeleton: it wires the real useWardrobe() hook with designed loading / empty /
// error states and a token-only grid. Placeholder tiles stand in for the cutout
// image + name + availability chip; final visuals are the human's.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import type { WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe } from '../../src/api/index.js';
import {
  Screen,
  Card,
  Text,
  AvailabilityChip,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../src/ui/index.js';

function ItemTile({ item }: { readonly item: WardrobeItemRow }): React.JSX.Element {
  const tokens = useTokens();
  const tile: ViewStyle = { width: '48%', marginBottom: tokens.spacing.lg };
  // The cutout image slots into this sunken well; placeholder for the scaffold.
  const well: ViewStyle = {
    aspectRatio: 1,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.sm,
  };
  return (
    <View style={tile}>
      <View style={well} accessibilityLabel={`${item.category} garment`}>
        <Text variant="caption" tone="tertiary">
          {item.category}
        </Text>
      </View>
      <Text variant="body" tone="primary">
        {item.color ?? item.category}
      </Text>
      <AvailabilityChip availability={item.availability} style={{ marginTop: tokens.spacing.xs }} />
    </View>
  );
}

export function WardrobeScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useWardrobe();

  if (query.isPending) return <LoadingState message="Loading your closet…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your closet." onRetry={() => void query.refetch()} />;
  }

  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Your closet is empty"
        body="Add your first pieces and they'll appear here as clean cutouts."
        actionLabel="Add clothing"
        onAction={() => {}}
      />
    );
  }

  const grid: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' };
  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Your closet
      </Text>
      <Card variant="sunken" padding="md" style={grid}>
        {items.map((item) => (
          <ItemTile key={item.id} item={item} />
        ))}
      </Card>
    </Screen>
  );
}
