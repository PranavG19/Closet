// Outfits list (F6) — structural skeleton wired to useOutfits() with designed
// loading / empty / error states. The builder canvas (item slots by category) is a
// later screen; this is the list surface.
//
// The list is a FlatList, not a .map() in a ScrollView, so a large outfit collection
// windows its rows rather than mounting every card up front. Row is React.memo'd (the
// outfit row is a stable react-query ref) so parent re-renders during scroll don't
// re-render every visible card.
import React from 'react';
import { View, Image, TextInput, FlatList, type ImageStyle, type ListRenderItem, type TextStyle, type ViewStyle } from 'react-native';
import type { OutfitSummary } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useOutfits, useDeleteOutfit, useRenameOutfit } from '../../src/api/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Text, Button, Divider, SectionHeader, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';
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
  onDelete,
  onRename,
  deleting,
  renaming,
  style,
}: {
  readonly outfit: OutfitSummary;
  // Signed-URL map keyed by cutout PATH (the parent signs every outfit's preview paths in one
  // pass). A path missing from the map draws an empty well.
  readonly uris: Readonly<Record<string, string>>;
  // Called with this outfit's id once the two-tap confirm is satisfied. Stable (useCallback).
  readonly onDelete: (id: string) => void;
  // Called with { id, name } to rename (name null clears it). Stable (useCallback).
  readonly onRename: (id: string, name: string) => void;
  // True while THIS outfit's delete is in flight — disables the confirm so a double-tap can't
  // fire two deletes.
  readonly deleting: boolean;
  // True while THIS outfit's rename is in flight.
  readonly renaming: boolean;
  readonly style: ViewStyle;
}): React.JSX.Element {
  const tokens = useTokens();
  // Two-tap confirm, local to the card: "Remove" arms → "Delete this look?" confirms. A saved
  // outfit is rebuildable (unlike an account), so this is a light guard against a mis-tap, not
  // the heavyweight type-to-confirm the account purge needs.
  const [armed, setArmed] = React.useState(false);
  // Inline rename: "Rename" reveals a TextInput seeded with the current name; Save commits.
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const nameInput: TextStyle = {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.color.border.hairline,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surface,
    paddingHorizontal: tokens.spacing.md,
    color: tokens.color.text.primary,
    fontSize: tokens.typography.body.fontSize,
    marginTop: tokens.spacing.sm,
  };

  const beginRename = (): void => {
    setDraft(outfit.name ?? '');
    setEditing(true);
  };
  const commitRename = (): void => {
    onRename(outfit.id, draft);
    setEditing(false);
  };

  // A bare row on the canvas (law 2: not a card), divided by a hairline. An untitled look wears
  // its placeholder name in the serif `note` italic (synthesis §3.5); a named one is `title`.
  return (
    <View style={style}>
      <Divider />
      <View style={{ paddingTop: tokens.spacing.lg }}>
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
        {outfit.preview_paths.length > 0 && (
          <OutfitPreviewStrip paths={outfit.preview_paths} uris={uris} />
        )}
        {editing ? (
          <>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={80}
              placeholder="Name this look"
              placeholderTextColor={tokens.color.text.tertiary}
              accessibilityLabel="Outfit name"
              editable={!renaming}
              style={nameInput}
            />
            <View style={{ flexDirection: 'row', marginTop: tokens.spacing.md, gap: tokens.spacing.xl }}>
              <Button label={renaming ? 'Saving…' : 'Save'} intent="link" disabled={renaming} onPress={commitRename} />
              <Button label="Cancel" intent="ghost" disabled={renaming} onPress={() => setEditing(false)} />
            </View>
          </>
        ) : !armed ? (
          <View style={{ flexDirection: 'row', marginTop: tokens.spacing.md, gap: tokens.spacing.xl }}>
            <Button label="Rename" intent="link" onPress={beginRename} />
            <Button label="Remove" intent="ghost" onPress={() => setArmed(true)} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', marginTop: tokens.spacing.md, gap: tokens.spacing.xl }}>
            {/* the destructive action wears the red rule (synthesis §3.1 exception) — quiet, not a fill */}
            <Button
              label={deleting ? 'Removing…' : 'Delete this look'}
              intent="link"
              accent="red"
              disabled={deleting}
              onPress={() => onDelete(outfit.id)}
            />
            <Button label="Keep" intent="ghost" disabled={deleting} onPress={() => setArmed(false)} />
          </View>
        )}
      </View>
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
  const onDelete = React.useCallback((id: string) => deleteOutfit.mutate(id), [deleteOutfit]);

  const renameOutfit = useRenameOutfit();
  const renamingId = renameOutfit.isPending ? renameOutfit.variables.id : undefined;
  const onRename = React.useCallback(
    (id: string, name: string) => renameOutfit.mutate({ id, name }),
    [renameOutfit],
  );

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
        eyebrow="Your looks"
        title="No outfits yet"
        body="Build a look from your closet and save it here."
        actionLabel="Build an outfit"
        onAction={() => setBuilding(true)}
      />
    );
  }

  const rowSpacing: ViewStyle = { marginBottom: tokens.spacing.lg };
  const renderItem: ListRenderItem<OutfitSummary> = ({ item }) => (
    <OutfitCard
      outfit={item}
      uris={uris}
      onDelete={onDelete}
      onRename={onRename}
      deleting={deletingId === item.id}
      renaming={renamingId === item.id}
      style={rowSpacing}
    />
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
        // Re-render visible cards when signed URLs land OR a delete starts/ends (both change
        // identity/value); without this the memo'd cards would keep stale wells / button state.
        extraData={`${Object.keys(uris).length}|${deletingId ?? ''}|${renamingId ?? ''}`}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
