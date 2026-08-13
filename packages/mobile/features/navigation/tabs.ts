// The surface registry. `TabKey` is the full set of navigable surfaces — the App.tsx `screens`
// map and NavContext's navigate() both key by it, so EVERY surface keeps a key even when it is
// not a labelled tab. `TABS` (below) is only the LABELLED bottom-bar destinations.
//
// The bar was seven tabs, which overflowed iOS HIG's five-max (the "Account" label clipped off
// the right edge on a real device) and read cluttered for a calm, premium app. It is now FOUR
// destinations + a center Add action:
//   - `add`     → a center create FAB, not a labelled tab (it's the app's core verb, an action,
//                 not a browse destination). Reached via the FAB and the empty-closet CTA.
//   - `laundry` → folded into Closet's "In the wash" availability filter (LaundryScreen is
//                 literally useWardrobe({availability:'dirty'})); reached contextually from
//                 the Closet filter, so no capability is lost and a whole tab is removed.
//   - `profile` → the paywall. A permanent paywall tab is the dark-pattern the product rules
//                 out; reached instead from the "Upgrade" row in You when not entitled, and
//                 contextual upsell. Account deletion (Apple 5.1.1(v)) stays reachable in You,
//                 which remains a real tab.
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
  | 'sparkles-outline'
  | 'layers-outline'
  | 'person-outline';

export interface TabDef {
  readonly key: TabKey;
  readonly label: string;
  readonly icon: IoniconName;
}

// The four LABELLED destinations, in bar order. The center Add FAB is rendered by NavShell
// between the second and third of these, so it visually straddles the bar centre without
// consuming one of the four label slots.
export const TABS: readonly TabDef[] = [
  { key: 'wardrobe', label: 'Closet', icon: 'shirt-outline' },
  // Today (suggestions) — the daily-return surface, the reason she opens the app. Sits to the
  // LEFT of the center Add FAB.
  { key: 'suggestions', label: 'Today', icon: 'sparkles-outline' },
  { key: 'outfits', label: 'Outfits', icon: 'layers-outline' },
  // Identity + data-rights + membership. Labelled "You" (warmer, and the screen's own masthead
  // already reads "You"). Stays a top-level tab because Apple Review Guideline 5.1.1(v) requires
  // account deletion to be reachable in-app and a reviewer must be able to FIND it unguided.
  { key: 'account', label: 'You', icon: 'person-outline' },
];
