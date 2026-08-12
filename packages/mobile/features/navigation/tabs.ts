// The main-surface tab registry. Structural: the set of top-level surfaces and
// their order. A real nav library (expo-router / @react-navigation) slots in later
// and consumes THIS list; screens do not change. Kept as data so the shell renders
// from it without a switch per tab.
export type TabKey =
  | 'wardrobe'
  | 'add'
  | 'suggestions'
  | 'outfits'
  | 'laundry'
  | 'profile'
  | 'account';

// An Ionicons glyph name. Each tab carries its OUTLINE name; the shell derives the FILLED
// variant for the active tab by stripping `-outline` (Ionicons pairs every outline with a
// solid of the same stem). The filled-vs-outline shift is what carries the active state to
// assistive tech / colour-blind users — meaning is never by hue alone (docs/03).
export type IoniconName =
  | 'shirt-outline'
  | 'add-circle-outline'
  | 'sparkles-outline'
  | 'layers-outline'
  | 'water-outline'
  | 'star-outline'
  | 'person-outline';

export interface TabDef {
  readonly key: TabKey;
  readonly label: string;
  readonly icon: IoniconName;
}

export const TABS: readonly TabDef[] = [
  { key: 'wardrobe', label: 'Closet', icon: 'shirt-outline' },
  // Add-garment (F1). Sits SECOND, next to the closet it fills, because it is the flow every
  // other surface depends on having run — an empty closet makes Today, Outfits and Laundry all
  // empty too. With icons the label can now be short + always legible at 1/7 width.
  { key: 'add', label: 'Add', icon: 'add-circle-outline' },
  { key: 'suggestions', label: 'Today', icon: 'sparkles-outline' },
  { key: 'outfits', label: 'Outfits', icon: 'layers-outline' },
  { key: 'laundry', label: 'Laundry', icon: 'water-outline' },
  // The paywall/membership surface. KEY stays `profile` (the contract App.tsx keys its screen
  // map by); label "Plan" for width.
  { key: 'profile', label: 'Plan', icon: 'star-outline' },
  // The identity + data-rights surface. It is a TOP-LEVEL tab, not buried in a
  // submenu, because Apple Review Guideline 5.1.1(v) requires account deletion to be
  // reachable in-app and a reviewer has to be able to FIND it without guidance.
  { key: 'account', label: 'Account', icon: 'person-outline' },
];
