// Token-only Text primitive. Picks a typography scale entry + a semantic color
// token by name — a component NEVER passes a literal color or fontSize. This is
// the only place RN's <Text> is styled with type tokens.
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';

export type TextVariant = 'display' | 'title' | 'body' | 'caption';
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'onAccent';

export interface TextProps extends RNTextProps {
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const tokens = useTokens();
  const scale = tokens.typography[variant];
  const composed: TextStyle = {
    color: tokens.color.text[tone],
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    fontWeight: scale.fontWeight,
    ...(tokens.typography.family !== undefined ? { fontFamily: tokens.typography.family } : {}),
  };
  return <RNText style={[composed, style]} {...rest} />;
}
