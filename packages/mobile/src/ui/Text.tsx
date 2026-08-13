// Token-only Text primitive. Picks a typography scale entry + a semantic color
// token by name — a component NEVER passes a literal color or fontSize. This is
// the only place RN's <Text> is styled with type tokens. The pure variant/tone/family
// resolution lives in textStyle.ts so it can be unit-tested without a renderer.
import React from 'react';
import { Text as RNText, PixelRatio, type TextProps as RNTextProps } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { resolveTextStyle, type TextVariant, type TextTone } from './textStyle.js';

export type { TextVariant, TextTone };

export interface TextProps extends RNTextProps {
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
}

export function Text({
  variant = 'body',
  tone,
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const tokens = useTokens();
  const composed = resolveTextStyle(tokens, variant, tone);
  // Scale the token's fixed numeric lineHeight by the OS font-scale multiplier. RN scales
  // fontSize with Dynamic Type (allowFontScaling defaults true) but leaves a numeric lineHeight
  // CONSTANT, so at large accessibility sizes the glyphs overrun a line box that never grew and
  // clip/overlap. Multiplying the lineHeight here keeps the box proportional. Done in Text (not
  // textStyle.ts) on purpose: textStyle.ts is imported by textStyle.test.ts in the Node lane,
  // where a `react-native` import (PixelRatio) breaks rolldown — the same constraint tokens.ts
  // documents. getFontScale() is 1 at the default size, so this is a no-op until she scales up.
  const scaled =
    typeof composed.lineHeight === 'number'
      ? { ...composed, lineHeight: composed.lineHeight * PixelRatio.getFontScale() }
      : composed;
  return <RNText style={[scaled, style]} {...rest} />;
}
