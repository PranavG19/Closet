// Wardrobe grid — the signature surface (docs/03). Cutouts sit centered on a
// bg.sunken well so garments feel lifted off the page.
//
// THE CUTOUTS NOW ACTUALLY RENDER. Every tile previously drew a grey square with the
// category name in it — for a wardrobe app, whose entire proposition is seeing your clothes
// as clean cutouts, the one thing the screen existed to show was the one thing it did not.
// `cutout_path` was fetched, parsed, and threaded all the way to the client, then read by
// nothing.
//
// The bytes need a SIGNED URL: the `cutouts` bucket is private and its RLS policy binds the
// first path segment to auth.uid(), and <Image> cannot carry our JWT. See src/storage/cutoutUri.ts.
//
// The grid is a FlatList (numColumns=2), not a .map() in a ScrollView: a ScrollView
// mounts EVERY tile and its <Image> up front, so a large closet pays the full render +
// image-decode cost on open and holds every cutout in memory at once. FlatList windows
// the rows — off-screen tiles are not mounted — so open cost and memory stay flat as the
// closet grows. ItemTile is React.memo'd and the signed-URL map is passed as `extraData`,
// so a tile re-renders only when ITS OWN cutout URL arrives, not when any sibling's does.
import React from 'react';
import { View, Image, Pressable, FlatList, type ViewStyle, type ImageStyle, type ListRenderItem } from 'react-native';
import type { Availability, WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useToggleAvailability } from '../../src/api/index.js';
import {
  Screen,
  Text,
  AvailabilityChip,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../src/ui/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { FilterBar } from './FilterBar.js';
import { StatusSheet } from './StatusSheet.js';
import { deriveListParams, hasActiveFilter, type WardrobeFilter } from './wardrobeFilters.js';

// Memoized: in a FlatList the parent re-renders on every windowing change, so without
// this every visible tile would re-render whenever any one cutout URL arrived. The props
// are an item row (stable ref from react-query) and a string|undefined, so the default
// shallow compare is exactly right — a tile re-renders only when its own URL flips in.
const ItemTile = React.memo(function ItemTile({
  item,
  cutoutUri,
  onPressStatus,
}: {
  readonly item: WardrobeItemRow;
  // Undefined when there is no cutout yet (garment added before its parse finished) or the
  // URL could not be signed. Either way the well below is drawn empty — the tile degrades,
  // the screen does not.
  readonly cutoutUri: string | undefined;
  // Opens the status sheet for THIS garment (F7). Stable across renders (useCallback in the
  // screen) so the memo'd tile isn't invalidated by a new function identity each render.
  readonly onPressStatus: (item: WardrobeItemRow) => void;
}): React.JSX.Element {
  const tokens = useTokens();
  // width:'48%' inside a 2-column FlatList row whose columnWrapperStyle is
  // space-between reproduces the prior grid gutter exactly. `xl` row spacing gives the
  // grid gallery breathing room (was `lg`).
  const tile: ViewStyle = { width: '48%', marginBottom: tokens.spacing.xl };
  // The sunken well the cutout sits on. It stays behind the image rather than being replaced
  // by it: a PNG cutout is alpha-composited (CutoutPort guarantees `hasAlpha`), so the well
  // IS the backdrop the garment is lifted off, not a placeholder to swap out.
  const well: ViewStyle = {
    aspectRatio: 1,
    // Deeply-rounded warm tray (lg=28) so each cutout reads as genuinely lifted off the
    // page — the boutique-shelf feeling that is the product's whole promise.
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.sm,
    // Clip the image to the rounded corners; without this the PNG's square bounds bleed
    // past the radius on Android.
    overflow: 'hidden',
  };
  // `contain`, never `cover`: a cutout cropped to fill the square would cut the sleeves off
  // a coat. The whole garment has to be visible — that is the product.
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };
  return (
    <View style={tile}>
      <View style={well} accessibilityLabel={`${item.category} garment`}>
        {cutoutUri !== undefined ? (
          <Image
            source={{ uri: cutoutUri }}
            style={image}
            // The tile's own accessibilityLabel already names the garment, so the image is
            // decorative to a screen reader — labelling it again would read the category
            // twice.
            accessible={false}
          />
        ) : (
          <Text variant="caption" tone="tertiary">
            {item.category}
          </Text>
        )}
      </View>
      <Text variant="body" tone="primary">
        {item.color ?? item.category}
      </Text>
      {/* The chip is now the tap target for changing status (F7): it already SHOWS the state, so
          tapping it to CHANGE the state is the least-surprising affordance. Wrapped rather than
          made pressable itself so the chip stays a pure presentational primitive. */}
      <Pressable
        onPress={() => onPressStatus(item)}
        accessibilityRole="button"
        accessibilityLabel={`Change availability for ${item.color ?? item.category}`}
        style={{ marginTop: tokens.spacing.xs, alignSelf: 'flex-start' }}
      >
        <AvailabilityChip availability={item.availability} />
      </Pressable>
    </View>
  );
});

export function WardrobeScreen(): React.JSX.Element {
  const tokens = useTokens();
  // F4: the active filter, declared FIRST so the hook order is stable across every branch
  // below (Rules of Hooks). Its params drive the list query — the SERVER filters under RLS
  // (wardrobe/list.ts), so changing a chip refetches a genuinely filtered page rather than
  // hiding rows client-side.
  const [filter, setFilter] = React.useState<WardrobeFilter>({});
  const query = useWardrobe(deriveListParams(filter));
  // F7: the garment whose status sheet is open (null = closed), and the mutation that writes the
  // change. The sheet lives at the screen root, not per-tile, so only one is ever mounted.
  const [statusItem, setStatusItem] = React.useState<WardrobeItemRow | null>(null);
  const toggleAvailability = useToggleAvailability();
  // Stable so the memo'd ItemTile isn't re-rendered by a fresh callback identity every render.
  const openStatusSheet = React.useCallback((item: WardrobeItemRow) => setStatusItem(item), []);
  // Mount → first-ready-paint metric. Ready = the list query resolved (success), which is the
  // moment the grid is useful; called unconditionally BEFORE any early return so the hook order
  // is stable (Rules of Hooks).
  useScreenLoad('wardrobe', query.isSuccess);
  const onSelectStatus = (target: Availability): void => {
    if (statusItem === null) return;
    toggleAvailability.mutate(
      { item_id: statusItem.id, availability: target },
      // Close only on a confirmed write; on error the sheet stays open so she can retry or
      // dismiss (the list invalidation on success refreshes the chip to its new state).
      { onSuccess: () => setStatusItem(null) },
    );
  };
  // Signed image URLs, keyed by item id. A separate query from the rows because signed URLs
  // expire and rows do not (see useCutoutUris). Its loading and error states are deliberately
  // NOT gated on: the closet renders immediately with empty wells and the garments appear as
  // their URLs arrive, rather than the whole grid waiting on image signing.
  const cutouts = useCutoutUris(query.data?.items ?? []);

  if (query.isPending) return <LoadingState message="Loading your closet…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your closet." onRetry={() => void query.refetch()} />;
  }

  const items = query.data.items;
  const filtered = hasActiveFilter(filter);
  // A TRULY empty closet (no filter, no items) is the only case that takes over the whole
  // screen — there is nothing to filter, so the filter bar would be noise. A filtered-empty
  // result keeps the bar visible below (she must be able to clear the filter she just set),
  // so it is handled inline, not here.
  if (items.length === 0 && !filtered) {
    return (
      <EmptyState
        title="Your closet is empty"
        body="Add your first pieces and they'll appear here as clean cutouts."
        actionLabel="Add clothing"
        onAction={() => {}}
      />
    );
  }

  // The FlatList IS the scroller (so `Screen` is non-scroll: nesting a FlatList in a
  // ScrollView would defeat windowing and warn). The tiles now float directly on the warm
  // cream canvas — dropping the bordered panel-within-a-panel is what turns a cramped grid
  // into a breathable gallery (each tile's own well is the frame).
  const renderItem: ListRenderItem<WardrobeItemRow> = ({ item }) => (
    <ItemTile item={item} cutoutUri={cutouts.data?.[item.id]} onPressStatus={openStatusSheet} />
  );
  return (
    <Screen padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.md }}>
        Your closet
      </Text>
      <FilterBar filter={filter} onChange={setFilter} />
      {items.length === 0 ? (
        // Filtered to nothing — DISTINCT from an empty closet. She owns clothes; this selection
        // just has none, so the advice is "loosen the filter", not "add pieces". The bar stays
        // above so she can clear it.
        <View style={{ paddingVertical: tokens.spacing.xl }}>
          <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
            Nothing matches these filters. Tap a selected chip to clear it.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          // Re-render visible tiles when a signed URL lands (the map identity changes); without
          // this, memo'd tiles would keep their empty wells until an unrelated re-render.
          extraData={cutouts.data}
          showsVerticalScrollIndicator={false}
        />
      )}
      <StatusSheet
        item={statusItem}
        busy={toggleAvailability.isPending}
        onClose={() => setStatusItem(null)}
        onSelect={onSelectStatus}
      />
    </Screen>
  );
}
