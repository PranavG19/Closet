// App entry — the composition root. This is the ONE place feature screens are
// wired into the nav shell (the shell itself may not import features; cross-feature
// imports are lint-banned, but the App root under src/ is not a feature and is the
// sanctioned composer). Order of providers: QueryClient (data) → ThemeProvider
// (tokens) → ApiProvider (typed client) → NavShell.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './tokens/index.js';
import { ApiProvider } from './api/index.js';
import { NavShell, type TabScreens } from '../features/navigation/index.js';
import { WardrobeScreen } from '../features/wardrobe/index.js';
import { SuggestionsScreen } from '../features/suggestions/index.js';
import { OutfitsScreen } from '../features/outfits/index.js';
import { LaundryScreen } from '../features/laundry/index.js';
import { PaywallScreen } from '../features/monetization/index.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// The profile tab hosts the paywall/membership surface in the scaffold; a real
// profile screen composes it later.
const screens: TabScreens = {
  wardrobe: <WardrobeScreen />,
  suggestions: <SuggestionsScreen />,
  outfits: <OutfitsScreen />,
  laundry: <LaundryScreen />,
  profile: <PaywallScreen />,
};

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ApiProvider>
          <NavShell screens={screens} />
        </ApiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
