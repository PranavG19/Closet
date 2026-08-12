// Outfits list (F6) — structural skeleton wired to useOutfits() with designed
// loading / empty / error states. The builder canvas (item slots by category) is a
// later screen; this is the list surface.
//
// The list is a FlatList, not a .map() in a ScrollView, so a large outfit collection
// windows its rows rather than mounting every card up front. Row is React.memo'd (the
// outfit row is a stable react-query ref) so parent re-renders during scroll don't
// re-render every visible card.
import React from 'react';
import { FlatList, type ListRenderItem, type ViewStyle } from 'react-native';
import type { OutfitSummary } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useOutfits } from '../../src/api/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Card, Text, Button, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';
import { OutfitBuilderScreen } from './OutfitBuilderScreen.js';

// "3 pieces" / "1 piece" / "No pieces yet" — singular/plural correct, and an honest empty
// label rather than "0 pieces" (an outfit with nothing in it reads as unfinished, not a count).
function piecesLabel(count: number): string {
  if (count === 0) return 'No pieces yet';
  return count === 1 ? '1 piece' : `${count} pieces`;
}

const OutfitCard = React.memo(function OutfitCard({
  outfit,
  style,
}: {
  readonly outfit: OutfitSummary;
  readonly style: ViewStyle;
}): React.JSX.Element {
  const tokens = useTokens();
  return (
    <Card variant="surface" padding="md" style={style}>
      <Text variant="title" tone="primary">
        {outfit.name ?? 'Untitled look'}
      </Text>
      <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.xs }}>
        {piecesLabel(outfit.item_count)}
      </Text>
    </Card>
  );
});

export function OutfitsScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useOutfits();
  // F6: whether the builder canvas is open. In-feature state (no push navigation — the nav shell
  // is a flat tab bar with no stack), declared before any early return so the hook order is
  // stable across the loading/empty/error branches (Rules of Hooks).
  const [building, setBuilding] = React.useState(false);
  // Mount → first-ready metric. Unconditional, before any early return, so the hook order is
  // stable across the building/loading/empty/error branches (Rules of Hooks).
  useScreenLoad('outfits', query.isSuccess);

  if (building) {
    return <OutfitBuilderScreen onDone={() => setBuilding(false)} onCancel={() => setBuilding(false)} />;
  }

  if (query.isPending) return <LoadingState message="Loading your outfits…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your outfits." onRetry={() => void query.refetch()} />;
  }

  const outfits = query.data.outfits;
  if (outfits.length === 0) {
    return (
      <EmptyState
        title="No outfits yet"
        body="Build a look from your closet and save it here."
        actionLabel="Build an outfit"
        onAction={() => setBuilding(true)}
      />
    );
  }

  const cardSpacing: ViewStyle = { marginBottom: tokens.spacing.md };
  const renderItem: ListRenderItem<OutfitSummary> = ({ item }) => (
    <OutfitCard outfit={item} style={cardSpacing} />
  );
  return (
    <Screen padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.md }}>
        Outfits
      </Text>
      <Button
        label="Build a look"
        onPress={() => setBuilding(true)}
        style={{ marginBottom: tokens.spacing.lg }}
      />
      <FlatList
        data={outfits}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
