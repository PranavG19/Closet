// F4 filter bar — two horizontally-scrolling chip rows (category, availability) above the
// wardrobe grid. A chip is a pill Pressable; the selected chip is a filled accent, the rest are
// hairline outlines — the SAME accent/hairline language Button uses, so the filter reads as part
// of the design system, not a bolt-on. Colours come from useTokens() only.
//
// This component is presentational: it holds NO state. The screen owns the WardrobeFilter and
// passes it down with an onChange; tapping a chip calls the pure toggle in wardrobeFilters.ts.
// That keeps the tested logic (toggle/derive) out of the view entirely.
import React from 'react';
import { View, ScrollView, Pressable, type ViewStyle } from 'react-native';
import type { WardrobeCategory, Availability } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Text } from '../../src/ui/index.js';
import {
  CATEGORY_OPTIONS,
  AVAILABILITY_OPTIONS,
  categoryLabel,
  availabilityLabel,
  toggleCategory,
  toggleAvailability,
  type WardrobeFilter,
} from './wardrobeFilters.js';

function Chip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const base: ViewStyle = {
    minHeight: 36,
    paddingVertical: tokens.spacing.xs,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radius.pill,
    marginRight: tokens.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  };
  const variant: ViewStyle = selected
    ? { backgroundColor: tokens.color.accent.pink }
    : { borderWidth: 1, borderColor: tokens.color.border.hairline, backgroundColor: tokens.color.bg.surface };
  return (
    <Pressable
      accessibilityRole="button"
      // `selected` is exposed to assistive tech so the active facet is announced, not just
      // shown by colour (docs/03: meaning never by hue alone).
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[base, variant]}
    >
      <Text variant="caption" tone={selected ? 'onAccent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

// A single horizontally-scrolling row of chips. Kept generic over the option/label/selected
// trio so category and availability rows share one implementation rather than duplicating the
// ScrollView + map.
function ChipRow<T extends string>({
  options,
  labelOf,
  isSelected,
  onToggle,
}: {
  readonly options: readonly T[];
  readonly labelOf: (value: T) => string;
  readonly isSelected: (value: T) => boolean;
  readonly onToggle: (value: T) => void;
}): React.JSX.Element {
  const tokens = useTokens();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: tokens.spacing.xs }}
    >
      {options.map((value) => (
        <Chip key={value} label={labelOf(value)} selected={isSelected(value)} onPress={() => onToggle(value)} />
      ))}
    </ScrollView>
  );
}

export interface FilterBarProps {
  readonly filter: WardrobeFilter;
  readonly onChange: (next: WardrobeFilter) => void;
}

export function FilterBar({ filter, onChange }: FilterBarProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ marginBottom: tokens.spacing.md }}>
      <ChipRow<WardrobeCategory>
        options={CATEGORY_OPTIONS}
        labelOf={categoryLabel}
        isSelected={(c) => filter.category === c}
        onToggle={(c) => onChange(toggleCategory(filter, c))}
      />
      <ChipRow<Availability>
        options={AVAILABILITY_OPTIONS}
        labelOf={availabilityLabel}
        isSelected={(a) => filter.availability === a}
        onToggle={(a) => onChange(toggleAvailability(filter, a))}
      />
    </View>
  );
}
