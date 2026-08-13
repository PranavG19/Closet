// F6 outfit-builder canvas — the UI that was missing while the whole write path (outfits-create
// server, useCreateOutfit, and the pure tested draft.ts slot model) already existed. She taps a
// garment to place it in its slot; the slot logic (dress↔top/bottom exclusivity, completeness)
// lives in draft.ts, so this screen only renders the draft and dispatches taps — the rules are
// unit-tested, not trusted to the view.
//
// NO PUSH NAVIGATION. The app's nav is a flat 7-tab shell (tabs.ts) with no stack, so the builder
// is not a route — OutfitsScreen holds a `building` flag and renders this in place, with onDone/
// onCancel callbacks. That keeps F6 entirely inside the outfits feature and never touches the
// navigation barrel (single-writer).
import React from 'react';
import { View, ScrollView, Pressable, Image, type ViewStyle, type ImageStyle } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useCreateOutfit } from '../../src/api/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Text, Button, Divider, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';
import {
  EMPTY_DRAFT,
  OUTFIT_SLOTS,
  place,
  remove,
  isComplete,
  incompleteReason,
  toItems,
  slotForCategory,
  type Draft,
  type OutfitSlot,
} from './draft.js';

// A client-minted outfit id, generated at SAVE-TAP time (not inside the mutationFn) so a
// react-query retry re-sends the SAME id and the server's UNIQUE(user_id, id) resolves the
// retry onto the same row instead of creating a duplicate look (D-001 idempotent create).
//
// Uses expo-crypto, NOT `globalThis.crypto.randomUUID()` — the Hermes/RN runtime has no global
// `crypto`, so the global form throws "Cannot read property 'randomUUID' of undefined" at tap
// time (caught on the simulator). expo-crypto is a declared dependency already used for the
// Apple-auth nonce (src/session/nativeProviders.ts).
function mintOutfitId(): string {
  return Crypto.randomUUID();
}

// Human labels for the slots, in the OUTFIT_SLOTS body order. Kept here (a view concern) rather
// than in draft.ts, which is the pure rule model.
const SLOT_LABEL: Readonly<Record<OutfitSlot, string>> = {
  outerwear: 'Outerwear',
  top: 'Top',
  dress: 'Dress',
  bottom: 'Bottom',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

function CandidateChip({
  item,
  cutoutUri,
  selected,
  onPress,
}: {
  readonly item: WardrobeItemRow;
  readonly cutoutUri: string | undefined;
  readonly selected: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const box: ViewStyle = {
    width: 72,
    marginRight: tokens.spacing.sm,
    alignItems: 'center',
  };
  const well: ViewStyle = {
    width: 72,
    height: 72,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // A selected candidate gets an accent ring — paired with the check in the slot below, so the
    // selection is never carried by colour alone (docs/03 a11y).
    borderWidth: selected ? 2 : 1,
    borderColor: selected ? tokens.color.accent.pink : tokens.color.border.hairline,
  };
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.color ?? item.category}${selected ? ', selected' : ''}`}
      onPress={onPress}
      style={box}
    >
      <View style={well}>
        {cutoutUri !== undefined ? (
          <Image source={{ uri: cutoutUri }} style={image} accessible={false} />
        ) : (
          <Text variant="caption" tone="tertiary">
            {item.category}
          </Text>
        )}
      </View>
      <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.xs }}>
        {item.color ?? item.category}
      </Text>
    </Pressable>
  );
}

export interface OutfitBuilderScreenProps {
  // Called after a successful save (the list re-fetches via cache invalidation). The parent
  // returns to the list surface.
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

export function OutfitBuilderScreen({ onDone, onCancel }: OutfitBuilderScreenProps): React.JSX.Element {
  const tokens = useTokens();
  // The closet to build from. UNFILTERED by availability on purpose: a look is planned, not
  // necessarily worn today, so a garment in the wash is still a valid piece of an outfit — the
  // daily suggestion is where availability gates, not here.
  const query = useWardrobe();
  const create = useCreateOutfit();
  // Draft + hooks declared before any early return so hook order is stable (Rules of Hooks).
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const cutouts = useCutoutUris(query.data?.items ?? []);
  // Mount → first-ready metric. Ready = the closet-to-build-from resolved.
  useScreenLoad('outfit_builder', query.isSuccess);

  if (query.isPending) return <LoadingState message="Loading your closet…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your closet." onRetry={() => void query.refetch()} />;
  }

  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Your closet is empty"
        body="Add a few pieces first, then build a look from them."
        actionLabel="Back to outfits"
        onAction={onCancel}
      />
    );
  }

  // Group the closet by slot ONCE. An item whose category maps to no slot (should not happen —
  // categories and slots are 1:1 today) is simply not offered, rather than crashing the canvas.
  const itemsBySlot = new Map<OutfitSlot, WardrobeItemRow[]>();
  for (const item of items) {
    const slot = slotForCategory(item.category);
    if (slot === null) continue;
    const list = itemsBySlot.get(slot) ?? [];
    list.push(item);
    itemsBySlot.set(slot, list);
  }

  const complete = isComplete(draft);
  const reason = incompleteReason(draft);

  const onSave = (): void => {
    if (!complete || create.isPending) return;
    create.mutate(
      { id: mintOutfitId(), name: draft.name, items: toItems(draft) },
      { onSuccess: onDone },
    );
  };

  // Tapping the placed garment in a slot removes it; tapping a candidate places it (replacing any
  // current occupant, and clearing dress↔top/bottom conflicts — all in draft.place).
  const onCandidate = (slot: OutfitSlot, itemId: string): void => {
    setDraft((prev) => (prev.filled[slot] === itemId ? remove(prev, slot) : place(prev, slot, itemId)));
  };

  const byId = new Map(items.map((row) => [row.id, row]));

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.md }}>
        Build a look
      </Text>

      {OUTFIT_SLOTS.map((slot) => {
        const candidates = itemsBySlot.get(slot) ?? [];
        // A slot with nothing in the closet to fill it is omitted — showing an empty "Dress" row
        // to someone who owns no dress is noise.
        if (candidates.length === 0) return null;
        const placedId = draft.filled[slot];
        const placed = placedId !== undefined ? byId.get(placedId) : undefined;
        // A flat on-canvas slot, NOT an elevated white Card — a stack of raised white cards on the
        // cream canvas reads as generic/Material and breaks the editorial language every list
        // surface (Closet, Laundry, Outfits) already uses: a hairline divider + the section title,
        // candidates on the warm sunken wells. The figure/ground is carried by the divider rhythm,
        // not a shadowed tile.
        return (
          <View key={slot} style={{ marginBottom: tokens.spacing.lg }}>
            <Divider />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: tokens.spacing.md,
              }}
            >
              <Text variant="title" tone="primary">
                {SLOT_LABEL[slot]}
              </Text>
              {placed !== undefined && (
                <Text variant="caption" tone="secondary">
                  {`✓ ${placed.color ?? placed.category}`}
                </Text>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingTop: tokens.spacing.sm }}
            >
              {candidates.map((item) => (
                <CandidateChip
                  key={item.id}
                  item={item}
                  cutoutUri={cutouts.data?.[item.id]}
                  selected={placedId === item.id}
                  onPress={() => onCandidate(slot, item.id)}
                />
              ))}
            </ScrollView>
          </View>
        );
      })}

      {reason !== null && (
        <Text
          variant="caption"
          tone="tertiary"
          accessibilityLiveRegion="polite"
          style={{ marginTop: tokens.spacing.sm, textAlign: 'center' }}
        >
          {reason}
        </Text>
      )}
      {create.isError && (
        <Text
          variant="caption"
          tone="tertiary"
          accessibilityLiveRegion="polite"
          style={{ marginTop: tokens.spacing.sm, textAlign: 'center' }}
        >
          We couldn’t save that look. Try again.
        </Text>
      )}

      <Button
        label={create.isPending ? 'Saving…' : 'Save this look'}
        disabled={!complete || create.isPending}
        onPress={onSave}
        style={{ marginTop: tokens.spacing.lg }}
      />
      <Button label="Cancel" intent="ghost" onPress={onCancel} style={{ marginTop: tokens.spacing.sm }} />
    </Screen>
  );
}
