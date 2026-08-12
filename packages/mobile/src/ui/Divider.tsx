// A 1px hairline rule — the redesign's default separator (brief law 2: "hairline dividers"
// replace the everything-is-a-card look). Token-only.
import React from 'react';
import { View } from 'react-native';
import { useTokens } from '../tokens/index.js';

export interface DividerProps {
  // Left/right inset in points, so a rule can align to content rather than bleed edge-to-edge.
  readonly inset?: number;
}

export function Divider({ inset = 0 }: DividerProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: tokens.color.border.hairline,
        marginHorizontal: inset,
      }}
    />
  );
}
