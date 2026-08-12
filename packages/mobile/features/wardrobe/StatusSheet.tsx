// F7 — the bottom sheet that changes a garment's availability from the closet grid. Tapping a
// tile's status chip opens this; it offers the OTHER two states (statusChange.ts) and calls back
// with the chosen one. Presentational and stateless: it holds no mutation, so the same sheet is
// trivially previewable and the screen owns the write + its pending/error handling.
//
// A Modal (not an absolute View) so it sits above the FlatList and the tab bar, and so the OS
// back gesture / hardware back dismisses it. The scrim is a Pressable that closes on tap-outside
// — the standard sheet affordance. Colours from useTokens() only (the scrim is the one token
// that is intentionally an rgba wash; see tokens.overlay).
import React from 'react';
import { Modal, Pressable, View, type ViewStyle } from 'react-native';
import type { Availability, WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Card, Text, AvailabilityChip } from '../../src/ui/index.js';
import { alternativeStatuses, statusActionLabel } from './statusChange.js';

export interface StatusSheetProps {
  // The garment whose status is being changed, or null when the sheet is closed. Passing the
  // whole row (not just an id) lets the sheet name the piece in its header without a second read.
  readonly item: WardrobeItemRow | null;
  readonly onClose: () => void;
  readonly onSelect: (target: Availability) => void;
  // Disables the rows while a change is in flight, so a double-tap can't fire two writes.
  readonly busy?: boolean;
}

export function StatusSheet({ item, onClose, onSelect, busy = false }: StatusSheetProps): React.JSX.Element {
  const tokens = useTokens();

  const scrim: ViewStyle = {
    flex: 1,
    backgroundColor: tokens.color.overlay.scrim,
    justifyContent: 'flex-end',
  };
  const sheet: ViewStyle = {
    // The sheet's top corners are the deep 'lg' radius (28) so it reads as the pillowy surface
    // the design language uses for sheets; the bottom is square against the screen edge.
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    gap: tokens.spacing.sm,
    // Extra bottom padding so the last row clears the home-indicator region.
    paddingBottom: tokens.spacing.xl,
  };
  const rowStyle: ViewStyle = {
    minHeight: 44,
    paddingVertical: tokens.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    opacity: busy ? 0.5 : 1,
  };

  const targets = item !== null ? alternativeStatuses(item.availability) : [];

  return (
    <Modal
      visible={item !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Tap-outside closes. The inner Pressable swallows the tap so a press on the sheet body
          doesn't bubble up to the scrim and dismiss it. */}
      <Pressable style={scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        {/* accessible={false}: this Pressable exists only to swallow taps on the sheet body so
            they don't bubble to the scrim and dismiss it. Without this, VoiceOver surfaces it as
            an unlabeled interactive element; marking it inaccessible lets focus fall through to
            the real controls (title, chip, status rows) it wraps. */}
        <Pressable onPress={() => {}} accessible={false}>
          <Card padding="lg" style={sheet}>
            {item !== null && (
              <>
                <Text variant="title" tone="primary">
                  {item.color ?? item.category}
                </Text>
                <View style={{ flexDirection: 'row', marginBottom: tokens.spacing.sm }}>
                  <AvailabilityChip availability={item.availability} />
                </View>
                {targets.map((target) => (
                  <Pressable
                    key={target}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    accessibilityLabel={statusActionLabel(target)}
                    disabled={busy}
                    onPress={() => onSelect(target)}
                    style={({ pressed }) => [rowStyle, pressed && !busy ? { opacity: 0.85 } : null]}
                  >
                    <Text variant="body" tone="primary">
                      {statusActionLabel(target)}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
