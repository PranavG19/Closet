// The nav shell — a minimal bottom-tab container over the main surfaces. It is
// deliberately dependency-light and does NOT import any feature screen (a
// cross-feature import is lint-banned): the App entry in src/ composes the feature
// screens into `screens` and passes them here. A real nav library (expo-router /
// @react-navigation) slots in behind this same shape later; the tab registry
// (tabs.ts) is the contract that survives that swap.
import React, { useState } from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { Text } from '../../src/ui/index.js';
import { TABS, type TabKey } from './tabs.js';

export type TabScreens = Readonly<Record<TabKey, React.ReactNode>>;

export interface NavShellProps {
  readonly screens: TabScreens;
  readonly initialTab?: TabKey;
}

export function NavShell({ screens, initialTab = 'wardrobe' }: NavShellProps): React.JSX.Element {
  const tokens = useTokens();
  const [active, setActive] = useState<TabKey>(initialTab);

  const container: ViewStyle = { flex: 1, backgroundColor: tokens.color.bg.canvas };
  const bar: ViewStyle = {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tokens.color.border.hairline,
    backgroundColor: tokens.color.bg.surface,
    paddingVertical: tokens.spacing.sm,
  };
  const tabButton: ViewStyle = {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <View style={container}>
      <View style={{ flex: 1 }}>{screens[active]}</View>
      <View style={bar} accessibilityRole="tablist">
        {TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActive(tab.key)}
              style={tabButton}
            >
              <Text variant="caption" tone={selected ? 'primary' : 'tertiary'}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
