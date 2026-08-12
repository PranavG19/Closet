// Laundry (F7) — the "in the wash" surface. Copy is neutral and kind (laundry is normal, not
// an error).
//
// BATCH MARK-CLEAN, because doing laundry is a LOAD, not a garment. This screen previously
// offered one "Mark clean" button per row, so finishing a wash meant fifteen taps and fifteen
// round-trips — and because each one invalidates the wardrobe cache, the list re-rendered and
// shifted under her finger between taps. That is the wrong interaction shape for the task, not
// a styling problem. Selection lives in basket.ts (pure, unit-tested); this file is the render
// and the submit loop.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, Pressable, FlatList, type ViewStyle, type ListRenderItem } from 'react-native';
import type { WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useToggleAvailability } from '../../src/api/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import {
  Screen,
  Text,
  Button,
  Divider,
  SectionHeader,
  SelectMark,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../src/ui/index.js';
import {
  EMPTY_BASKET,
  clear,
  count,
  isSelected,
  pending,
  prune,
  selectAll,
  toggle,
} from './basket.js';

export function LaundryScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useWardrobe({ availability: 'dirty' });
  const toggleAvailability = useToggleAvailability();
  const [basket, setBasket] = React.useState(EMPTY_BASKET);
  const [failedCount, setFailedCount] = React.useState(0);
  // Mount → first-ready metric. Ready = the dirty-items list resolved. Unconditional and before
  // the effect + early returns below so the hook order is stable (Rules of Hooks).
  useScreenLoad('laundry', query.isSuccess);

  const items = query.data?.items ?? [];
  // Joined, not the array: a refetch returns a new array instance with the same contents, so
  // an effect keyed on identity would re-run forever.
  const visibleKey = items.map((item) => item.id).join(',');

  // Keep the basket honest when the list refetches: a garment marked clean elsewhere must not
  // stay counted here. `prune` preserves identity when nothing changed, which is what makes
  // this safe to run on every list change without looping.
  React.useEffect(() => {
    const visibleIds = visibleKey === '' ? [] : visibleKey.split(',');
    setBasket((current) => prune(current, visibleIds));
  }, [visibleKey]);

  if (query.isPending) return <LoadingState message="Checking the hamper…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your laundry." onRetry={() => void query.refetch()} />;
  }

  if (items.length === 0) {
    return <EmptyState eyebrow="In the wash" title="Nothing in the wash" body="Everything's ready to wear." />;
  }

  const visibleIds = items.map((item) => item.id);
  const selectedCount = count(basket);
  const allSelected = selectedCount === items.length;

  // Mark every selected garment clean.
  //
  // Submitted SEQUENTIALLY, on purpose. There is no batch endpoint — inventing one would be a
  // deploy-topology change, not a UI fix — so each garment is an independent write. Firing
  // fifteen at once would race the shared wardrobe cache invalidation and hammer the endpoint.
  //
  // A failure does NOT abort the run: the remaining garments are still attempted and the
  // number of failures is reported. Stopping at the first error would leave her with a
  // half-emptied hamper and no idea which half — and since each write is independent, there is
  // nothing to roll back.
  const markSelectedClean = async (): Promise<void> => {
    setFailedCount(0);
    let failures = 0;
    for (const id of pending(basket, visibleIds)) {
      try {
        await toggleAvailability.mutateAsync({ item_id: id, availability: 'clean' });
      } catch {
        // The specific error is deliberately not surfaced: raw error text may carry PII and
        // never reaches the UI. The count is the part she can act on.
        failures += 1;
      }
    }
    setFailedCount(failures);
    setBasket(clear());
  };

  // A bare hairline-divided row (law 2): a SelectMark + the garment name, with the one-off
  // "mark clean" as a quiet link on the right. Selection is carried by the SelectMark, not a
  // border tint (tinting would move the surface labels were contrast-checked against).
  const row: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: tokens.spacing.md,
  };

  // The hamper is a FlatList (windowed) rather than a .map() in a ScrollView. The header
  // block (title, select-all bar, batch mark-clean button, failure notice) rides
  // ListHeaderComponent so it scrolls with the list exactly as before. Rows are re-rendered
  // on selection or mutation-pending change via `extraData` — a row's border and its button's
  // disabled state both depend on those, so they must be in the windowing dependency.
  const isMutating = toggleAvailability.isPending;
  const renderItem: ListRenderItem<WardrobeItemRow> = ({ item }) => {
    const selected = isSelected(basket, item.id);
    return (
      <Pressable
        onPress={() => setBasket(toggle(basket, item.id))}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${item.color ?? item.category}, in the wash`}
      >
        <Divider />
        <View style={row}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md }}>
            <SelectMark selected={selected} />
            <Text variant="body" tone="primary">
              {item.color ?? item.category}
            </Text>
          </View>
          {/* The one-off path: mark exactly one garment clean without building a selection.
              A quiet link, not a filled button — the filled action is the batch bar only. */}
          {!selected && (
            <Button
              label="Mark clean"
              intent="link"
              disabled={isMutating}
              onPress={() => toggleAvailability.mutate({ item_id: item.id, availability: 'clean' })}
            />
          )}
        </View>
      </Pressable>
    );
  };

  const header = (
    <View style={{ marginBottom: tokens.spacing.sm }}>
      <SectionHeader
        eyebrow="In the wash"
        title="Laundry"
        titleVariant="display"
        action={{
          label: allSelected ? 'Clear' : 'Select all',
          onPress: () => setBasket(allSelected ? clear() : selectAll(visibleIds)),
        }}
      />

      {selectedCount > 0 && (
        <View style={{ marginTop: tokens.spacing.lg }}>
          <Text variant="overline" style={{ marginBottom: tokens.spacing.xs }}>
            {`${selectedCount} selected`}
          </Text>
          <Button
            // The count is IN the label, so the button states exactly what it will do. A
            // reversible action does not need an "are you sure" dialog; it needs an honest label.
            // This is the ONE earned filled button on the screen (the committed batch action).
            label={isMutating ? 'Putting them away…' : `Mark ${selectedCount} clean`}
            accent="pink"
            disabled={isMutating}
            onPress={() => void markSelectedClean()}
          />
        </View>
      )}

      {failedCount > 0 && (
        <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.md }}>
          {`${failedCount} couldn't be updated. Pull down to refresh and try again.`}
        </Text>
      )}
    </View>
  );

  return (
    <Screen padding="lg">
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        extraData={`${[...basket.ids].sort().join(',')}|${isMutating}`}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
