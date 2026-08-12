// Token-only Button primitive. Three intents map to token colors — `accent` is the
// filled primary (uses the leading accent per screen), `secondary` is a hairline
// outline, `ghost` is text-only. Accents PUNCTUATE (docs/03: never large fills for
// decoration) — the filled variant is reserved for the one primary action.
import React from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';

export type ButtonIntent = 'accent' | 'secondary' | 'ghost';
export type ButtonAccent = 'pink' | 'red' | 'blue';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly intent?: ButtonIntent;
  // Which accent the filled variant uses; defaults to the signature pink.
  readonly accent?: ButtonAccent;
  readonly disabled?: boolean;
  readonly style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  intent = 'accent',
  accent = 'pink',
  disabled = false,
  style,
}: ButtonProps): React.JSX.Element {
  const tokens = useTokens();
  const accentColor = tokens.color.accent[accent];

  const base: ViewStyle = {
    minHeight: 44, // hit target ≥ 44pt (docs/03 accessibility)
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.5 : 1,
  };

  const variant: ViewStyle =
    intent === 'accent'
      ? { backgroundColor: accentColor }
      : intent === 'secondary'
        ? // A filled TONAL button (warm sunken fill, no border) — softer and more tactile than
          // an outline, matching the iOS-18 filled-gray secondary. The label is text.primary.
          { backgroundColor: tokens.color.bg.sunken }
        : { backgroundColor: 'transparent' };

  const tone = intent === 'accent' ? 'onAccent' : 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // A subtle press-down dim — soft tactile feedback, no token change.
      style={({ pressed }) => [base, variant, pressed ? { opacity: 0.85 } : null, style]}
    >
      <Text variant="body" tone={tone}>
        {label}
      </Text>
    </Pressable>
  );
}
