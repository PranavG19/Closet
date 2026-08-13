// Outfits list (F6) — structural skeleton wired to useOutfits() with designed
// loading / empty / error states. The builder canvas (item slots by category) is a
// later screen; this is the list surface.
//
// The list is a FlatList, not a .map() in a ScrollView, so a large outfit collection
// windows its rows rather than mounting every card up front. Row is React.memo'd (the
// outfit row is a stable react-query ref) so parent re-renders during scroll don't
// re-render every visible card.
import React from 'react';
import { View, Image, Pressable, FlatList, type ImageStyle, type ListRenderItem, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OutfitSummary } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useOutfits, useDeleteOutfit, useRenameOutfit } from '../../src/api/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Text, Divider, SectionHeader, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';
import { OutfitBuilderScreen } from './OutfitBuilderScreen.js';
import { OutfitDetailScreen } from './OutfitDetailScreen.js';

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

// A clean, tappable list row — the LOOK, not its chrome. Previously each card carried a
// permanent two-link action bar (Rename/Remove) that mutated in place into Save/Cancel or
// Delete/Keep, plus an inline TextInput that shifted every row below it — the "two bars"
// clutter. Management now lives on the look's own detail page (OutfitDetailScreen); the row is
// preview + name + count + a chevron, and the whole row taps through. This matches the module's
// own stated intent: "the card shows the LOOK, not just its name".
const OutfitCard = React.memo(function OutfitCard({
  outfit,
  uris,
  onOpen,
  style,
}: {
  readonly outfit: OutfitSummary;
  // Signed-URL map keyed by cutout PATH (the parent signs every outfit's preview paths in one
  // pass). A path missing from the map draws an empty well.
  readonly uris: Readonly<Record<string, string>>;
  // Open this look's detail page. Stable (useCallback in the screen).
  readonly onOpen: (outfit: OutfitSummary) => void;
  readonly style: ViewStyle;
}): React.JSX.Element {
  const tokens = useTokens();
  // A bare row on the canvas (law 2: not a card), divided by a hairline. An untitled look wears
  // its placeholder name in the serif `note` italic (synthesis §3.5); a named one is `title`.
  return (
    <View style={style}>
      <Divider />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${outfit.name ?? 'Untitled look'}, ${piecesLabel(outfit.item_count)}. Open to rename or delete.`}
        onPress={() => onOpen(outfit)}
        style={{ paddingTop: tokens.spacing.lg }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            {outfit.name !== null ? (
              <Text variant="title" tone="primary">
                {outfit.name}
              </Text>
            ) : (
              <Text variant="note" tone="secondary">
                Untitled look
              </Text>
            )}
            <Text variant="overline" style={{ marginTop: tokens.spacing.xs }}>
              {piecesLabel(outfit.item_count)}
            </Text>
          </View>
          {/* A quiet chevron signals the row taps through — the only chrome on the card. */}
          <Ionicons name="chevron-forward" size={20} color={tokens.color.text.tertiary} />
        </View>
        {outfit.preview_paths.length > 0 && (
          <OutfitPreviewStrip paths={outfit.preview_paths} uris={uris} />
        )}
      </Pressable>
    </View>
  );
});

export function OutfitsScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useOutfits();
  // F6: whether the builder canvas is open. In-feature state (no push navigation — the nav shell
  // is a flat tab bar with no stack), declared before any early return so the hook order is
  // stable across the loading/empty/error branches (Rules of Hooks).
  const [building, setBuilding] = React.useState(false);
  // The id of the outfit whose detail page is open (null = the list). Management (rename/delete)
  // lives there, off the list rows. Declared before any early return (Rules of Hooks).
  const [openId, setOpenId] = React.useState<string | null>(null);
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

  // Delete mutation. deletingId tracks WHICH card is in flight so only that card's confirm
  // disables (not every card). Stable callback so the memo'd cards aren't re-rendered by a
  // fresh identity each render.
  const deleteOutfit = useDeleteOutfit();
  const deletingId = deleteOutfit.isPending ? deleteOutfit.variables : undefined;
  // Delete from the detail page; on a confirmed delete, close the page back to the list (the
  // just-deleted look no longer exists to show).
  const onDelete = React.useCallback(
    (id: string) => deleteOutfit.mutate(id, { onSuccess: () => setOpenId(null) }),
    [deleteOutfit],
  );

  const renameOutfit = useRenameOutfit();
  const renamingId = renameOutfit.isPending ? renameOutfit.variables.id : undefined;
  const onRename = React.useCallback(
    (id: string, name: string) => renameOutfit.mutate({ id, name }),
    [renameOutfit],
  );
  const onOpen = React.useCallback((outfit: OutfitSummary) => setOpenId(outfit.id), []);

  if (building) {
    return <OutfitBuilderScreen onDone={() => setBuilding(false)} onCancel={() => setBuilding(false)} />;
  }

  if (query.isPending) return <LoadingState message="Loading your outfits…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your outfits." onRetry={() => void query.refetch()} />;
  }

  const outfits = query.data.outfits;
  // Detail page for the open look. Resolved from the live list so a rename reflects immediately;
  // if the id vanished (e.g. deleted in another session) we fall back to the list.
  const openOutfit = openId !== null ? outfits.find((o) => o.id === openId) : undefined;
  if (openOutfit !== undefined) {
    return (
      <OutfitDetailScreen
        outfit={openOutfit}
        uris={uris}
        onBack={() => setOpenId(null)}
        onRename={onRename}
        onDelete={onDelete}
        renaming={renamingId === openOutfit.id}
        deleting={deletingId === openOutfit.id}
      />
    );
  }
  if (outfits.length === 0) {
    return (
      <EmptyState
        eyebrow="Your looks"
        title="Your looks live here"
        body="Build a look from your closet and save it here."
        actionLabel="Build an outfit"
        onAction={() => setBuilding(true)}
      />
    );
  }

  const rowSpacing: ViewStyle = { marginBottom: tokens.spacing.lg };
  const renderItem: ListRenderItem<OutfitSummary> = ({ item }) => (
    <OutfitCard outfit={item} uris={uris} onOpen={onOpen} style={rowSpacing} />
  );
  return (
    <Screen padding="lg">
      {/* Masthead: eyebrow + serif title, with the quiet build action on the shared baseline. */}
      <SectionHeader
        eyebrow="Your looks"
        title="Outfits"
        titleVariant="display"
        action={{ label: 'Build a look', onPress: () => setBuilding(true) }}
      />
      <FlatList
        data={outfits}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={{ marginTop: tokens.spacing.lg }}
        // Re-render visible cards when signed URLs land (the map identity changes); the cards no
        // longer carry per-card delete/rename state (that moved to the detail page).
        extraData={Object.keys(uris).length}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
