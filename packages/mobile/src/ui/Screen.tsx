// Token-only Screen primitive: the canvas every screen sits on. Sets the canvas
// background + a default generous padding from the spacing scale. No literal
// color/px — all from useTokens().
//
// THE TOP INSET IS APPLIED ON THE OUTER CANVAS, NOT ON THE CONTENT PADDING. That
// distinction is the whole fix for a scrolling screen: padding on a ScrollView's
// contentContainerStyle SCROLLS AWAY, so content ends up under the clock and the
// Dynamic Island as soon as she scrolls. Padding on the canvas that CONTAINS the
// ScrollView is a frame boundary the content cannot cross at any scroll offset.
//
// The inset is measured at runtime (useSafeAreaInsets) and never a constant: 59pt
// on an iPhone 16 Pro, 47pt on an SE-class device, 24pt on Android. A hardcoded
// number is the same bug wearing a different device's clothes.
import React from 'react';
import { View, ScrollView, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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

  // The inset lives here and the content padding lives on `inner`, so the two are
  // never flattened into one style object — a `padding` shorthand landing after a
  // `paddingTop` longhand in a RN style array would silently erase the inset.
  const canvas: ViewStyle = {
    flex: 1,
    backgroundColor: tokens.color.bg.canvas,
    paddingTop: insets.top,
  };
  const inner: ViewStyle = { padding: pad };

  if (scroll) {
    return (
      <View style={canvas}>
        <ScrollView contentContainerStyle={[inner, style]}>{children}</ScrollView>
      </View>
    );
  }
  return (
    <View style={canvas}>
      <View style={[{ flex: 1 }, inner, style]}>{children}</View>
    </View>
  );
}
