// The nav shell — a minimal bottom-tab container over the main surfaces. It is
// deliberately dependency-light and does NOT import any feature screen (a
// cross-feature import is lint-banned): the App entry in src/ composes the feature
// screens into `screens` and passes them here. A real nav library (expo-router /
// @react-navigation) slots in behind this same shape later; the tab registry
// (tabs.ts) is the contract that survives that swap.
//
// It owns the `active` surface useState and PROVIDES it through NavContext (src/navigation),
// so any feature screen can navigate() without a cross-feature import — the empty closet's
// "Add" CTA, the "You" screen's "Upgrade" row, and the back affordance below all drive the
// same state machine. The bar shows FOUR labelled tabs with a center Add FAB straddling the
// middle; three surfaces (add, laundry, profile) are reachable programmatically rather than as
// tabs, and get a back affordance since they aren't in the bar.
import React, { useState } from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTokens } from '../../src/tokens/index.js';
import { Text } from '../../src/ui/index.js';
import { NavProvider } from '../../src/navigation/index.js';
import { TABS, type TabKey, type IoniconName } from './tabs.js';

// The active tab shows the FILLED glyph, inactive shows the outline — so the selected state
// is carried by the icon shape, not only by colour (a11y: meaning never by hue alone). Every
// Ionicons outline has a solid sibling at the same stem, so dropping `-outline` is safe.
function activeIcon(name: IoniconName): string {
  return name.replace('-outline', '');
}

// Surfaces that are NOT labelled tabs (see tabs.ts). When one of these is active, the bar shows
// no selected tab, so a back affordance is rendered to return to its natural parent.
const NON_TAB_PARENT: Partial<Record<TabKey, TabKey>> = {
  add: 'wardrobe', // the garment lands in the closet
  laundry: 'wardrobe', // laundry is a filtered view of the closet
  profile: 'account', // the paywall is reached from You → membership
};

export type TabScreens = Readonly<Record<TabKey, React.ReactNode>>;

export interface NavShellProps {
  readonly screens: TabScreens;
  readonly initialTab?: TabKey;
}

export function NavShell({ screens, initialTab = 'wardrobe' }: NavShellProps): React.JSX.Element {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<TabKey>(initialTab);
  const navValue = React.useMemo(() => ({ current: active, navigate: setActive }), [active]);

  const container: ViewStyle = { flex: 1, backgroundColor: tokens.color.bg.canvas };
  // The bar's own padding sits ABOVE the home-indicator region, then the measured
  // bottom inset is added below it — so the taps land on the labels rather than on
  // the system swipe-up gesture. `insets.bottom` is 0 on a device with a physical
  // home button, which correctly collapses this back to the original spacing.
  const bar: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
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

  const renderTab = (tab: TabDefLike): React.JSX.Element => {
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
            name={(selected ? activeIcon(tab.icon) : tab.icon) as React.ComponentProps<typeof Ionicons>['name']}
            size={22}
            color={color}
          />
        </View>
        {/* One line, never wrapped: iOS HIG prefers a truncated tab label to a mid-word wrap.
            With four tabs the labels never truncate. */}
        <Text variant="caption" tone={selected ? 'primary' : 'tertiary'} numberOfLines={1}>
          {tab.label}
        </Text>
      </Pressable>
    );
  };

  // The center create action — a raised circular "+" straddling the bar centre. It is the app's
  // core verb (Add a garment), given visual primacy without spending a browse-destination slot.
  // Quiet by the Atelier brief: the signature accent fill (the one earned bar-level action), the
  // system-white glyph (`onAccent`, AA on every accent), the soft warm shadow. `add` is not a
  // labelled tab, so it never shows a selected pill; it just drives navigate('add').
  const fabSize = 52;
  const fab: ViewStyle = {
    width: fabSize,
    height: fabSize,
    borderRadius: tokens.radius.pill,
    marginHorizontal: tokens.spacing.sm,
    backgroundColor: tokens.color.accent.pink,
    alignItems: 'center',
    justifyContent: 'center',
    // Lift it a touch above the bar's top rule so it reads as elevated, not inset.
    marginTop: -tokens.spacing.md,
    ...tokens.shadow,
  };

  // Split the four labelled tabs around the center FAB: [Closet, Today] · (+) · [Outfits, You].
  const leftTabs = TABS.slice(0, 2);
  const rightTabs = TABS.slice(2);

  // A back affordance for the non-tab surfaces (add / laundry / profile). Without it those
  // screens would be a dead end — the bar shows no selected tab and nothing returns to a parent.
  const parent = NON_TAB_PARENT[active];
  const backBar: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    gap: tokens.spacing.xs,
  };

  return (
    <NavProvider value={navValue}>
      <View style={container}>
        {parent !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => setActive(parent)}
            style={[backBar, { paddingTop: tokens.spacing.sm + insets.top }]}
          >
            <Ionicons name="chevron-back" size={20} color={tokens.color.text.secondary} />
            <Text variant="overline" tone="secondary">
              Back
            </Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }}>{screens[active]}</View>
        <View style={bar} accessibilityRole="tablist">
          {leftTabs.map(renderTab)}
          <Pressable
            // A button, NOT a tab: it's the create action, not a browse destination — so no
            // `selected` state (that's tab semantics) and no tab role. VoiceOver announces it as
            // "Add clothing, button", distinct from the four tabs around it.
            accessibilityRole="button"
            accessibilityLabel="Add clothing"
            onPress={() => setActive('add')}
            style={fab}
          >
            <Ionicons name="add" size={30} color={tokens.color.text.onAccent} accessible={false} />
          </Pressable>
          {rightTabs.map(renderTab)}
        </View>
      </View>
    </NavProvider>
  );
}

// The row-render helper is generic over the labelled-tab shape only (the FAB is rendered
// inline, not from TABS), so a local structural type keeps it honest without re-exporting.
type TabDefLike = { readonly key: TabKey; readonly label: string; readonly icon: IoniconName };
