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

export function LoadingState({ message }: { readonly message?: string }): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={centered(tokens.spacing.md)}>
      <ActivityIndicator color={tokens.color.accentDecorative.pink} />
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
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function EmptyState({ title, body, actionLabel, onAction }: EmptyStateProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={centered(tokens.spacing.md)}>
      <Text variant="title" tone="primary">
        {title}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button label={actionLabel} onPress={onAction} intent="secondary" />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly body?: string;
  readonly onRetry?: () => void;
}

export function ErrorState({ title, body, onRetry }: ErrorStateProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={centered(tokens.spacing.md)}>
      <Text variant="title" tone="primary">
        {title ?? 'Something went sideways'}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {onRetry !== undefined ? <Button label="Try again" onPress={onRetry} intent="secondary" /> : null}
    </View>
  );
}
