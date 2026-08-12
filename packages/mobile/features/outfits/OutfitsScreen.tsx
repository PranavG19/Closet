// Outfits list (F6) — structural skeleton wired to useOutfits() with designed
// loading / empty / error states. The builder canvas (item slots by category) is a
// later screen; this is the list surface.
//
// The list is a FlatList, not a .map() in a ScrollView, so a large outfit collection
// windows its rows rather than mounting every card up front. Row is React.memo'd (the
// outfit row is a stable react-query ref) so parent re-renders during scroll don't
// re-render every visible card.
import React from 'react';
import { View, Image, FlatList, type ImageStyle, type ListRenderItem, type ViewStyle } from 'react-native';
import type { OutfitSummary } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useOutfits } from '../../src/api/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Card, Text, Button, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';
import { OutfitBuilderScreen } from './OutfitBuilderScreen.js';

// "3 pieces" / "1 piece" / "No pieces yet" — singular/plural correct, and an honest empty
// label rather than "0 pieces" (an outfit with nothing in it reads as unfinished, not a count).
function piecesLabel(count: number): string {
  if (count === 0) return 'No pieces yet';
  return count === 1 ? '1 piece' : `${count} pieces`;
}

// A row of small garment thumbnails — the outfit's members as cutouts, so the card shows the
// LOOK, not just its name. Each path is resolved to a signed URL by the parent (uris map keyed
// BY PATH); a path still awaiting its URL draws an empty sunken well, exactly like the wardrobe
// grid — the strip degrades tile-by-tile, never blocks the card.
const OutfitPreviewStrip = React.memo(function OutfitPreviewStrip({
  paths,
  uris,
}: {
  readonly paths: readonly string[];
  readonly uris: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const tokens = useTokens();
  const thumb: ViewStyle = {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.sunken,
    marginRight: tokens.spacing.sm,
    overflow: 'hidden',
  };
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };
  return (
    <View style={{ flexDirection: 'row', marginTop: tokens.spacing.sm }}>
      {paths.map((path) => (
        <View key={path} style={thumb}>
          {uris[path] !== undefined ? (
            <Image source={{ uri: uris[path] }} style={image} accessible={false} />
          ) : null}
        </View>
      ))}
    </View>
  );
});

const OutfitCard = React.memo(function OutfitCard({
  outfit,
  uris,
  style,
}: {
  readonly outfit: OutfitSummary;
  // Signed-URL map keyed by cutout PATH (the parent signs every outfit's preview paths in one
  // pass). A path missing from the map draws an empty well.
  readonly uris: Readonly<Record<string, string>>;
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
      {outfit.preview_paths.length > 0 && (
        <OutfitPreviewStrip paths={outfit.preview_paths} uris={uris} />
      )}
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

  // Sign every outfit's preview cutout paths in ONE pass (not per-card): flatten all outfits'
  // preview_paths, hand them to useCutoutUris as {id: path, cutout_path: path} row-likes so the
  // returned map is keyed BY PATH. Deduped so a garment reused across outfits signs once. This
  // hook is unconditional (before the early returns) and no-ops when there's nothing to sign.
  const previewRows = React.useMemo(() => {
    const outfits = query.data?.outfits ?? [];
    const paths = [...new Set(outfits.flatMap((outfit) => outfit.preview_paths))];
    return paths.map((path) => ({ id: path, cutout_path: path }));
  }, [query.data]);
  const previewUris = useCutoutUris(previewRows);
  const uris = previewUris.data ?? {};

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
    <OutfitCard outfit={item} uris={uris} style={cardSpacing} />
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
        // Re-render visible cards when signed URLs land (the map identity changes); without this
        // the memo'd cards would keep empty preview wells until an unrelated re-render.
        extraData={uris}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
