// Token-only Button primitive. Three intents map to token colors — `accent` is the
// filled primary (uses the leading accent per screen), `secondary` is a hairline
// outline, `ghost` is text-only. Accents PUNCTUATE (docs/03: never large fills for
// decoration) — the filled variant is reserved for the one primary action.
import React from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';

export type ButtonIntent = 'accent' | 'secondary' | 'ghost' | 'link';
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

  // `link` is the quiet, confident primary action (brief law 3): a left-aligned uppercase
  // overline label sitting on a 2px accent rule — no filled box, no radius. It is its own
  // shape, so it branches out of the filled-box base below.
  if (intent === 'link') {
    const linkBase: ViewStyle = {
      minHeight: 44, // hit target ≥ 44pt even though the visible rule is shorter (docs/03)
      alignSelf: 'flex-start', // left-aligned, never stretched (brief law 4)
      justifyContent: 'center',
      paddingBottom: tokens.spacing.xs, // 4pt gap between label and its rule
      borderBottomWidth: 2,
      borderBottomColor: accentColor,
      opacity: disabled ? 0.5 : 1,
    };
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [linkBase, pressed ? { opacity: 0.85 } : null, style]}
      >
        {/* overline label at primary tone so it reads as an action, darker than a plain eyebrow */}
        <Text variant="overline" tone="primary">
          {label}
        </Text>
      </Pressable>
    );
  }

  // `ghost` is the quiet SECONDARY/dismiss action (Cancel, Keep, "Why this?"). It used to render
  // as `Text variant="body" tone="primary"` on transparent — visually IDENTICAL to body copy, so
  // a sighted user had no affordance (a screen reader still got role=button). It now wears the
  // same uppercase tracked OVERLINE the rest of the app's controls use (SIGN OUT, RENAME…), which
  // is the app's universal "this is tappable" signal, but at SECONDARY tone and with NO accent
  // rule — so it reads as a control yet stays subordinate to the `link` primary (primary tone +
  // 2px accent underline) and the `accent` fill. Its own branch, like `link`.
  if (intent === 'ghost') {
    const ghostBase: ViewStyle = {
      minHeight: 44, // hit target ≥ 44pt (docs/03) even though the label is short
      alignSelf: 'flex-start',
      justifyContent: 'center',
      opacity: disabled ? 0.5 : 1,
    };
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [ghostBase, pressed ? { opacity: 0.85 } : null, style]}
      >
        <Text variant="overline" tone="secondary">
          {label}
        </Text>
      </Pressable>
    );
  }

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
      : // secondary: a filled TONAL button (warm sunken fill, no border) — softer and more
        // tactile than an outline, matching the iOS-18 filled-gray secondary. Label is primary.
        { backgroundColor: tokens.color.bg.sunken };

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
