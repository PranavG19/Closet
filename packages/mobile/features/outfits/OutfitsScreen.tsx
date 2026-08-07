// Outfits list (F6) — structural skeleton wired to useOutfits() with designed
// loading / empty / error states. The builder canvas (item slots by category) is a
// later screen; this is the list surface.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { useTokens } from '../../src/tokens/index.js';
import { useOutfits } from '../../src/api/index.js';
import { Screen, Card, Text, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';

export function OutfitsScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useOutfits();

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
        onAction={() => {}}
      />
    );
  }

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Outfits
      </Text>
      {outfits.map((outfit) => (
        <Card key={outfit.id} variant="surface" padding="md" style={{ marginBottom: tokens.spacing.md }}>
          <Text variant="title" tone="primary">
            {outfit.name ?? 'Untitled look'}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
