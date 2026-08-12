// The circular selection check — a garment tile / laundry row is "chosen". Two consumers
// (Add, Laundry), so it earns extraction (duplicate-twice rule). Reuses accent.pink /
// border.hairline / text.onAccent only — no new color token.
import React from 'react';
import { View } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';

export interface SelectMarkProps {
  readonly selected: boolean;
  readonly size?: number;
}

export function SelectMark({ selected, size = 24 }: SelectMarkProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={{
        width: size,
        height: size,
        borderRadius: tokens.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? tokens.color.accent.pink : 'transparent',
        borderWidth: selected ? 0 : 1,
        borderColor: tokens.color.border.hairline,
      }}
    >
      {selected ? (
        // A tick glyph on the pink fill. onAccent is the only text tone legal on an accent fill.
        <Text variant="caption" tone="onAccent" style={{ lineHeight: size }}>
          ✓
        </Text>
      ) : null}
    </View>
  );
}
