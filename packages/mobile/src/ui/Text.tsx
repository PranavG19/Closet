// Token-only Text primitive. Picks a typography scale entry + a semantic color
// token by name — a component NEVER passes a literal color or fontSize. This is
// the only place RN's <Text> is styled with type tokens. The pure variant/tone/family
// resolution lives in textStyle.ts so it can be unit-tested without a renderer.
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
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
  return <RNText style={[composed, style]} {...rest} />;
}
