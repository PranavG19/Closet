// Laundry (F7) — the "in the wash" surface. Structural skeleton: lists the dirty
// items via useWardrobe({availability:'dirty'}) with the token-only availability
// chip and a toggle back to clean. Copy is neutral and kind (laundry is normal,
// not an error).
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useToggleAvailability } from '../../src/api/index.js';
import {
  Screen,
  Card,
  Text,
  Button,
  AvailabilityChip,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../src/ui/index.js';

export function LaundryScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useWardrobe({ availability: 'dirty' });
  const toggle = useToggleAvailability();

  if (query.isPending) return <LoadingState message="Checking the hamper…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your laundry." onRetry={() => void query.refetch()} />;
  }

  const items = query.data.items;
  if (items.length === 0) {
    return <EmptyState title="Nothing in the wash" body="Everything's ready to wear." />;
  }

  const row: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacing.md,
  };

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Laundry
      </Text>
      {items.map((item) => (
        <Card key={item.id} variant="surface" padding="md" style={row}>
          <View>
            <Text variant="body" tone="primary">
              {item.color ?? item.category}
            </Text>
            <AvailabilityChip availability="dirty" style={{ marginTop: tokens.spacing.xs }} />
          </View>
          <Button
            label="Mark clean"
            intent="secondary"
            onPress={() => toggle.mutate({ item_id: item.id, availability: 'clean' })}
          />
        </Card>
      ))}
    </Screen>
  );
}
