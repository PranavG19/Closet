// F4 dedupe-by-pick — the review sheet. docs/01 F4: "when the pipeline flags two photos as
// likely the same garment, present both side by side. She either keeps one (they're the same)
// or keeps both (genuinely different). Simple, one tap."
//
// The DETECTION is on-device and pure (findDuplicatePairs over the phashes the client already
// holds — docs/06 §3: "no server pass, no dedupe table"), computed by the screen and handed in
// as `pairs`. This sheet only RENDERS one pair at a time and reports the decision:
//   - "Keep <this one>"  → merge the other away (server keep-one; wear-history re-pointed, F4).
//   - "Keep both"        → a CLIENT-SIDE dismissal, zero server state (keep-both is deliberately
//                          unrepresentable on the server — docs/06). The pair is just skipped.
// Never destructive without her tap: nothing merges until she picks a keeper.
//
// A Modal above the grid + tab bar, same shell as StatusSheet.
import React from 'react';
import { Modal, Pressable, View, Image, type ImageStyle, type ViewStyle } from 'react-native';
import type { WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Card, Text, Button, Divider } from '../../src/ui/index.js';

// One garment in the pair: the row (for its label) + its signed cutout URL (may be undefined
// while signing, exactly like the grid — the well draws empty rather than blocking).
export interface DedupeReviewItem {
  readonly item: WardrobeItemRow;
  readonly cutoutUri: string | undefined;
}

export interface DedupeReviewSheetProps {
  // The two likely-duplicate garments, or null when the sheet is closed.
  readonly pair: { readonly left: DedupeReviewItem; readonly right: DedupeReviewItem } | null;
  // Progress within the batch, so she knows how many pairs remain ("1 of 3").
  readonly index: number;
  readonly total: number;
  readonly onKeep: (keepId: string, discardId: string) => void;
  readonly onKeepBoth: () => void;
  readonly onClose: () => void;
  // Disables the actions while a merge is in flight so a double-tap can't fire two merges.
  readonly busy?: boolean;
}

export function DedupeReviewSheet({
  pair,
  index,
  total,
  onKeep,
  onKeepBoth,
  onClose,
  busy = false,
}: DedupeReviewSheetProps): React.JSX.Element {
  const tokens = useTokens();

  const scrim: ViewStyle = {
    flex: 1,
    backgroundColor: tokens.color.overlay.scrim,
    justifyContent: 'flex-end',
  };
  const sheet: ViewStyle = {
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    gap: tokens.spacing.md,
    paddingBottom: tokens.spacing.xl,
  };
  const well: ViewStyle = {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: tokens.radius.xs,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };

  // One side of the pick: the cutout, its label, and the "keep this one" action.
  const side = (which: DedupeReviewItem, other: DedupeReviewItem): React.JSX.Element => {
    const label = which.item.color ?? which.item.category;
    return (
      <View style={{ flex: 1, gap: tokens.spacing.sm }}>
        <View style={well} accessibilityLabel={`${label} garment`}>
          {which.cutoutUri !== undefined ? (
            <Image source={{ uri: which.cutoutUri }} style={image} accessible={false} />
          ) : null}
        </View>
        <Text variant="body" tone="primary" numberOfLines={1}>
          {label}
        </Text>
        <Button
          label="Keep this one"
          intent="secondary"
          disabled={busy}
          onPress={() => onKeep(which.item.id, other.item.id)}
        />
      </View>
    );
  };

  return (
    <Modal visible={pair !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        {/* Swallows body taps so they don't bubble to the scrim (same idiom as StatusSheet). */}
        <Pressable onPress={() => {}} accessible={false}>
          <Card padding="lg" style={sheet}>
            {pair !== null && (
              <>
                <Text variant="overline">{`Possible duplicate · ${index + 1} of ${total}`}</Text>
                <Text variant="title" tone="primary">
                  Same piece?
                </Text>
                <Text variant="body" tone="secondary">
                  These two look alike. Keep one if they’re the same garment — its wear history moves
                  to the piece you keep. Keep both if they’re genuinely different.
                </Text>

                <View style={{ flexDirection: 'row', gap: tokens.spacing.md, marginTop: tokens.spacing.sm }}>
                  {side(pair.left, pair.right)}
                  {side(pair.right, pair.left)}
                </View>

                <Divider />
                {/* Keep-both is the safe, non-destructive default — a quiet link, not a filled
                    button, so "merge" is never the loud option. */}
                <Button
                  label="Keep both — they’re different"
                  intent="link"
                  disabled={busy}
                  onPress={onKeepBoth}
                />
              </>
            )}
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
