// The nav shell — a minimal bottom-tab container over the main surfaces. It is
// deliberately dependency-light and does NOT import any feature screen (a
// cross-feature import is lint-banned): the App entry in src/ composes the feature
// screens into `screens` and passes them here. A real nav library (expo-router /
// @react-navigation) slots in behind this same shape later; the tab registry
// (tabs.ts) is the contract that survives that swap.
import React, { useState } from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTokens } from '../../src/tokens/index.js';
import { Text } from '../../src/ui/index.js';
import { TABS, type TabKey, type IoniconName } from './tabs.js';

// The active tab shows the FILLED glyph, inactive shows the outline — so the selected state
// is carried by the icon shape, not only by colour (a11y: meaning never by hue alone). Every
// Ionicons outline has a solid sibling at the same stem, so dropping `-outline` is safe.
function activeIcon(name: IoniconName): string {
  return name.replace('-outline', '');
}

export type TabScreens = Readonly<Record<TabKey, React.ReactNode>>;

export interface NavShellProps {
  readonly screens: TabScreens;
  readonly initialTab?: TabKey;
}

export function NavShell({ screens, initialTab = 'wardrobe' }: NavShellProps): React.JSX.Element {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<TabKey>(initialTab);

  const container: ViewStyle = { flex: 1, backgroundColor: tokens.color.bg.canvas };
  // The bar's own padding sits ABOVE the home-indicator region, then the measured
  // bottom inset is added below it — so the taps land on the labels rather than on
  // the system swipe-up gesture. `insets.bottom` is 0 on a device with a physical
  // home button, which correctly collapses this back to the original spacing.
  const bar: ViewStyle = {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tokens.color.border.hairline,
    backgroundColor: tokens.color.bg.surface,
    paddingTop: tokens.spacing.sm,
    paddingBottom: tokens.spacing.sm + insets.bottom,
  };
  const tabButton: ViewStyle = {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacing.xs,
  };
  // The soft active pill sits behind the icon — the iOS-18 "selected segment" look, a
  // warm sunken capsule. It carries the active state alongside the filled icon + accent
  // colour, so selection is legible three ways.
  const iconPill = (selected: boolean): ViewStyle => ({
    width: 44,
    height: 30,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: selected ? tokens.color.bg.sunken : 'transparent',
  });

  return (
    <View style={container}>
      <View style={{ flex: 1 }}>{screens[active]}</View>
      <View style={bar} accessibilityRole="tablist">
        {TABS.map((tab) => {
          const selected = tab.key === active;
          const color = selected ? tokens.color.accent.pink : tokens.color.text.tertiary;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={() => setActive(tab.key)}
              style={tabButton}
            >
              <View style={iconPill(selected)}>
                <Ionicons
                  // Filled when active, outline when not — the shape carries selection too.
                  name={(selected ? activeIcon(tab.icon) : tab.icon) as React.ComponentProps<typeof Ionicons>['name']}
                  size={22}
                  color={color}
                />
              </View>
              {/* One line, never wrapped: iOS HIG prefers a truncated tab label to one that
                  wraps mid-word. With icons the labels never truncate at 1/7 width. */}
              <Text variant="caption" tone={selected ? 'primary' : 'tertiary'} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
