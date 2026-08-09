// Token-only Card primitive: a soft-radius, soft-shadow surface. Used for item
// cards, suggestion cards, sheets. Colors/radius/shadow from useTokens() only.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';

export interface CardProps {
  readonly children: React.ReactNode;
  // `surface` (default) = white card; `sunken` = the well cutouts sit on so
  // garments feel lifted off the page (the signature wardrobe backdrop).
  readonly variant?: 'surface' | 'sunken';
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
  readonly style?: ViewStyle;
}

export function Card({ children, variant = 'surface', padding = 'md', style }: CardProps): React.JSX.Element {
  const tokens = useTokens();
  // Every prop value except 'none' IS a spacing-scale key, so this is a lookup, not a
  // decision. Written as a ladder it silently fell through to `md` for any key not
  // spelled out — so adding a step to the scale would quietly do nothing here.
  const pad = padding === 'none' ? 0 : tokens.spacing[padding];

  const base: ViewStyle = {
    backgroundColor: variant === 'sunken' ? tokens.color.bg.sunken : tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.hairline,
    padding: pad,
  };

  // Soft elevation only on the raised surface, never the sunken well.
  const elevation: ViewStyle =
    variant === 'surface'
      ? {
          shadowColor: tokens.shadow.shadowColor,
          shadowOpacity: tokens.shadow.shadowOpacity,
          shadowRadius: tokens.shadow.shadowRadius,
          shadowOffset: tokens.shadow.shadowOffset,
          elevation: tokens.shadow.elevation,
        }
      : {};

  return <View style={[base, elevation, style]}>{children}</View>;
}
