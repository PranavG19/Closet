// An edge-to-edge N-column grid with NO card wrappers (brief law 1: the clothes are the
// interface). Children are bare tiles the caller composes (a cutout on a radius.xs well +
// name + overline key). Grid only owns the column math + gutters. Token-only.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';

export interface GridProps {
  readonly children: React.ReactNode;
  readonly columns?: number;
  // Gutter in points between tiles; defaults to the sm spacing step.
  readonly gap?: number;
  readonly style?: ViewStyle;
}

export function Grid({ children, columns = 2, gap, style }: GridProps): React.JSX.Element {
  const tokens = useTokens();
  const gutter = gap ?? tokens.spacing.sm;
  const items = React.Children.toArray(children);
  const widthPct = `${100 / columns}%` as const;

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gutter / 2 }, style]}>
      {items.map((child, i) => (
        <View key={i} style={{ width: widthPct, paddingHorizontal: gutter / 2, marginBottom: gutter }}>
          {child}
        </View>
      ))}
    </View>
  );
}
