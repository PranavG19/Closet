// A left-aligned section masthead: an overline eyebrow + an optional serif heading, with an
// optional right-aligned quiet `link` action sharing the heading's baseline row (asymmetric,
// brief law 4). Replaces the ad-hoc centered title stacks. Token-only.
import React from 'react';
import { View } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text, type TextVariant } from './Text.js';
import { Button } from './Button.js';

export interface SectionHeaderProps {
  readonly eyebrow?: string;
  readonly title?: string;
  // display (28 serif, one per screen) or title (22 sans) — defaults to title so a section
  // header does not accidentally claim the screen's single display headline.
  readonly titleVariant?: Extract<TextVariant, 'display' | 'title'>;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export function SectionHeader({
  eyebrow,
  title,
  titleVariant = 'title',
  action,
}: SectionHeaderProps): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens.spacing.xs }}>
      {eyebrow !== undefined ? <Text variant="overline">{eyebrow}</Text> : null}
      {/* title + action share a baseline row: title left, action pinned right */}
      {title !== undefined || action !== undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {title !== undefined ? (
            <Text variant={titleVariant} tone="primary">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action !== undefined ? (
            <Button label={action.label} onPress={action.onPress} intent="link" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
