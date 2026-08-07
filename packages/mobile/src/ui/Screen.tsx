// Token-only Screen primitive: the canvas every screen sits on. Sets the canvas
// background + a default generous padding from the spacing scale. No literal
// color/px — all from useTokens(). Safe-area insets are intentionally deferred:
// they arrive with the real navigation library (see features/navigation), which
// owns the inset context; this primitive stays dependency-light for the scaffold.
import React from 'react';
import { View, ScrollView, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';

export interface ScreenProps {
  readonly children: React.ReactNode;
  // When true, content scrolls (long lists / forms); otherwise a fixed View.
  readonly scroll?: boolean;
  // Padding step from the spacing scale; defaults to `lg` (16). Generous by design.
  readonly padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  readonly style?: ViewStyle;
}

export function Screen({ children, scroll = false, padding = 'lg', style }: ScreenProps): React.JSX.Element {
  const tokens = useTokens();
  const pad =
    padding === 'none'
      ? 0
      : padding === 'sm'
        ? tokens.spacing.sm
        : padding === 'md'
          ? tokens.spacing.md
          : padding === 'xl'
            ? tokens.spacing.xl
            : tokens.spacing.lg;

  const canvas: ViewStyle = { flex: 1, backgroundColor: tokens.color.bg.canvas };
  const inner: ViewStyle = { padding: pad };

  if (scroll) {
    return (
      <View style={canvas}>
        <ScrollView contentContainerStyle={[inner, style]}>{children}</ScrollView>
      </View>
    );
  }
  return <View style={[canvas, inner, style]}>{children}</View>;
}
