// The PURE style-resolution for the Text primitive, kept out of the JSX so it can be tested
// without React or a renderer (this repo has no @testing-library/react-native or jsdom — the
// established pattern is to extract the decision into a pure module and test THAT; see
// features/wardrobe/wardrobeFilters.ts).
//
// This is where "which variant renders in the serif face" and "which tone a variant defaults to"
// live — both are keyed by TextVariant, so the silent-failure mode is: add a variant and forget
// to place it in one of these maps. resolveTextStyle() closes that by resolving EVERY field from
// the token scale, and the test asserts the maps stay total over the variant union.
import type { TextStyle } from 'react-native';
import type { Tokens } from '../tokens/index.js';

export type TextVariant = 'display' | 'title' | 'body' | 'caption' | 'overline' | 'note';
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'onAccent';

// Per-variant default tone. Only overline differs from the primary default: the brief pins
// section eyebrows / metadata keys to the tertiary tone. Every other variant keeps 'primary'.
const DEFAULT_TONE: Partial<Record<TextVariant, TextTone>> = {
  overline: 'tertiary',
};

// The two serif variants (display headline + note advisory line). All others use the sans.
const SERIF_VARIANTS: ReadonlySet<TextVariant> = new Set<TextVariant>(['display', 'note']);

export function isSerifVariant(variant: TextVariant): boolean {
  return SERIF_VARIANTS.has(variant);
}

// The tone a variant falls back to when the caller passes none.
export function defaultTone(variant: TextVariant): TextTone {
  return DEFAULT_TONE[variant] ?? 'primary';
}

// The composed style for a variant + resolved tone. Pulls fontSize/lineHeight/fontWeight and the
// optional letterSpacing/textTransform/fontStyle straight from the token scale, picks the serif
// vs sans family, and resolves the color from the tone. `undefined` optional fields are a no-op
// in RN styles, so an unconditional spread keeps the result flat and predictable.
export function resolveTextStyle(
  tokens: Tokens,
  variant: TextVariant,
  tone: TextTone | undefined,
): TextStyle {
  const scale = tokens.typography[variant];
  const resolvedTone = tone ?? defaultTone(variant);
  return {
    color: tokens.color.text[resolvedTone],
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    fontWeight: scale.fontWeight,
    fontFamily: isSerifVariant(variant) ? tokens.typography.serifFamily : tokens.typography.family,
    letterSpacing: scale.letterSpacing,
    textTransform: scale.textTransform,
    fontStyle: scale.fontStyle,
  };
}
