// The main-surface tab registry. Structural: the set of top-level surfaces and
// their order. A real nav library (expo-router / @react-navigation) slots in later
// and consumes THIS list; screens do not change. Kept as data so the shell renders
// from it without a switch per tab.
export type TabKey = 'wardrobe' | 'suggestions' | 'outfits' | 'laundry' | 'profile';

export interface TabDef {
  readonly key: TabKey;
  readonly label: string;
}

export const TABS: readonly TabDef[] = [
  { key: 'wardrobe', label: 'Closet' },
  { key: 'suggestions', label: 'Today' },
  { key: 'outfits', label: 'Outfits' },
  { key: 'laundry', label: 'Laundry' },
  { key: 'profile', label: 'Profile' },
];
