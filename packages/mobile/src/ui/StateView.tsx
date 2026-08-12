// Calm loading / empty / error treatments (docs/03: "every state is designed" —
// never a bare spinner-or-crash). Token-only. Each takes a short message + an
// optional action so a screen wires one line per state.
import React from 'react';
import { View, ActivityIndicator, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';
import { Button } from './Button.js';

const centered = (gap: number): ViewStyle => ({
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap,
});

// Empty/error content is now a bare, LEFT-aligned authored section (brief law 2: "not
// everything is a card") — an overline eyebrow, a title, supporting body, and a quiet `link`
// action. It floats on the canvas, vertically centred but left-aligned, rather than boxed.
const authoredBlock = (gap: number): ViewStyle => ({
  flex: 1,
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap,
});

export function LoadingState({ message }: { readonly message?: string }): React.JSX.Element {
  const tokens = useTokens();
  return (
    // A polite live region announcing the loading state to VoiceOver/TalkBack when this
    // view appears (WCAG 4.1.3 Status Messages) — without it, a screen that swaps to a
    // spinner reads as a silent, empty screen. accessibilityLabel gives the container a
    // spoken name even when no message prop is passed.
    <View
      style={centered(tokens.spacing.md)}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Loading'}
    >
      {/* The primary accent (now AA-legal), not the faint decorative tone — a calm, present
          brand moment on the warm canvas rather than a washed-out spinner. Decorative to a
          screen reader — the container above already announces the loading state. */}
      <ActivityIndicator color={tokens.color.accent.pink} accessible={false} />
      {message !== undefined ? (
        <Text variant="body" tone="secondary">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  // Optional uppercase eyebrow above the title (e.g. "YOUR CLOSET", "NOTHING SAVED YET").
  readonly eyebrow?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function EmptyState({ title, body, eyebrow, actionLabel, onAction }: EmptyStateProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    // Polite live region so the empty state is announced when it appears (WCAG 4.1.3).
    <View
      style={[authoredBlock(tokens.spacing.md), { paddingHorizontal: tokens.spacing.xl }]}
      accessibilityLiveRegion="polite"
    >
      {eyebrow !== undefined ? <Text variant="overline">{eyebrow}</Text> : null}
      <Text variant="display" tone="primary">
        {title}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="secondary">
          {body}
        </Text>
      ) : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button label={actionLabel} onPress={onAction} intent="link" />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly body?: string;
  readonly eyebrow?: string;
  readonly onRetry?: () => void;
}

export function ErrorState({ title, body, eyebrow, onRetry }: ErrorStateProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    // An error is urgent: role="alert" (assertive) so VoiceOver/TalkBack interrupts and
    // announces the failure the moment this view replaces the content, rather than leaving
    // the user on a silently-swapped screen (WCAG 4.1.3 Status Messages).
    <View
      style={[authoredBlock(tokens.spacing.md), { paddingHorizontal: tokens.spacing.xl }]}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
    >
      {eyebrow !== undefined ? <Text variant="overline">{eyebrow}</Text> : null}
      <Text variant="display" tone="primary">
        {title ?? 'Something went sideways'}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="secondary">
          {body}
        </Text>
      ) : null}
      {onRetry !== undefined ? <Button label="Try again" onPress={onRetry} intent="link" /> : null}
    </View>
  );
}
