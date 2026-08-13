// The programmatic-navigation seam. It lives under src/ (a cross-cutting concern, like
// src/session) rather than under features/navigation, ON PURPOSE: feature screens must be
// able to navigate (an empty closet's "Add" CTA → the Add flow; "You" → the paywall), and a
// feature importing features/navigation is the cross-feature import eslint bans. Importing a
// src/ seam is the sanctioned direction (every screen already imports src/session this way).
//
// It carries ONLY the current surface key and a navigate(key). NavShell owns the actual
// `active` useState and provides this value; screens consume useNav() to move between surfaces
// without knowing how the shell is wired — the same contract that survives swapping in a real
// nav library later.
import React from 'react';
import type { TabKey } from '../../features/navigation/tabs.js';

export interface NavContextValue {
  readonly current: TabKey;
  readonly navigate: (key: TabKey) => void;
}

const NavContext = React.createContext<NavContextValue | null>(null);

export const NavProvider = NavContext.Provider;

// Throws rather than returning a no-op when used outside a provider: a screen that thinks it
// can navigate but silently can't is the worst failure mode (a dead button that looks alive).
export function useNav(): NavContextValue {
  const value = React.useContext(NavContext);
  if (value === null) {
    throw new Error('useNav must be used within a NavProvider (NavShell provides it).');
  }
  return value;
}
