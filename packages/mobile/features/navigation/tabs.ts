// The main-surface tab registry. Structural: the set of top-level surfaces and
// their order. A real nav library (expo-router / @react-navigation) slots in later
// and consumes THIS list; screens do not change. Kept as data so the shell renders
// from it without a switch per tab.
export type TabKey = 'wardrobe' | 'suggestions' | 'outfits' | 'laundry' | 'profile' | 'account';

export interface TabDef {
  readonly key: TabKey;
  readonly label: string;
}

export const TABS: readonly TabDef[] = [
  { key: 'wardrobe', label: 'Closet' },
  { key: 'suggestions', label: 'Today' },
  { key: 'outfits', label: 'Outfits' },
  { key: 'laundry', label: 'Laundry' },
  // The paywall/membership surface. Relabelled from "Profile" so it is not confused
  // with the identity + data-rights tab below it.
  { key: 'profile', label: 'Membership' },
  // The identity + data-rights surface. It is a TOP-LEVEL tab, not buried in a
  // submenu, because Apple Review Guideline 5.1.1(v) requires account deletion to be
  // reachable in-app and a reviewer has to be able to FIND it without guidance.
  { key: 'account', label: 'Account' },
];
