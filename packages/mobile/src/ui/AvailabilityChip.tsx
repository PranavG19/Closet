// Availability chip — clean / dirty / unavailable. Meaning is NEVER carried by
// hue alone (docs/03 accessibility): the chip always pairs the state color with a
// text label (and an a11y label). Copy is neutral and kind ("In the wash", not
// "DIRTY"). Colors from useTokens() only.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';

export type Availability = 'clean' | 'dirty' | 'unavailable';

const LABEL: Readonly<Record<Availability, string>> = {
  clean: 'Ready to wear',
  dirty: 'In the wash',
  unavailable: 'Unavailable',
};

export interface AvailabilityChipProps {
  readonly availability: Availability;
  readonly style?: ViewStyle;
}

export function AvailabilityChip({ availability, style }: AvailabilityChipProps): React.JSX.Element {
  const tokens = useTokens();
  const dotColor = tokens.color.state[availability];
  const label = LABEL[availability];

  const container: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: tokens.spacing.xs,
    paddingHorizontal: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.bg.sunken,
  };
  const dot: ViewStyle = {
    width: tokens.spacing.sm,
    height: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: dotColor,
    marginRight: tokens.spacing.xs,
  };

  return (
    <View style={[container, style]} accessibilityLabel={label}>
      <View style={dot} />
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}
