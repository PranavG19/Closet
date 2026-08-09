// App entry — the composition root. This is the ONE place feature screens are
// wired into the nav shell (the shell itself may not import features; cross-feature
// imports are lint-banned, but the App root under src/ is not a feature and is the
// sanctioned composer).
//
// Provider order: SafeAreaProvider (device insets) → QueryClient (data) →
// ThemeProvider (tokens) → SessionProvider (identity) → ApiProvider (typed client,
// bearer sourced FROM the session) → the session gate → NavShell.
//
// SafeAreaProvider is OUTERMOST because the gate below it can render a Screen (the
// loading state and SignInScreen both do) before NavShell ever mounts, and
// useSafeAreaInsets returns zeros outside the provider — which is exactly the
// silent no-op that made every heading collide with the Dynamic Island.
//
// SessionProvider must sit ABOVE ApiProvider: the client's
// TokenSource reads from the auth port, and the gate below it guarantees no screen
// mounts (and so no endpoint is called) before a session exists.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './tokens/index.js';
import { ApiProvider, ApiClient } from './api/index.js';
import { getSupabase } from './api/supabase.js';
import {
  SessionProvider,
  useSession,
  chooseRootView,
  makeSupabaseAuthPort,
  makeNativeCredentialProviders,
  makeTokenSource,
  type AuthPort,
} from './session/index.js';
import { LoadingState } from './ui/index.js';
import { NavShell, type TabScreens } from '../features/navigation/index.js';
import { WardrobeScreen } from '../features/wardrobe/index.js';
import { SuggestionsScreen } from '../features/suggestions/index.js';
import { OutfitsScreen } from '../features/outfits/index.js';
import { LaundryScreen } from '../features/laundry/index.js';
import { PaywallScreen } from '../features/monetization/index.js';
import { SignInScreen, AccountScreen } from '../features/auth/index.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const screens: TabScreens = {
  wardrobe: <WardrobeScreen />,
  suggestions: <SuggestionsScreen />,
  outfits: <OutfitsScreen />,
  laundry: <LaundryScreen />,
  profile: <PaywallScreen />,
  account: <AccountScreen />,
};

// The gate. `loading` is checked FIRST (see src/session/gate.ts) so an
// already-signed-in user never sees a frame of SignInScreen while the persisted
// session is read out of SecureStore.
function RootGate(): React.JSX.Element {
  const { loading, session } = useSession();
  const view = chooseRootView({ loading, hasSession: session !== null });
  if (view === 'loading') return <LoadingState message="One moment…" />;
  if (view === 'signIn') return <SignInScreen />;
  return <NavShell screens={screens} />;
}

// Takes NO props: Expo's registerRootComponent mounts it with its own InitialProps,
// so an app-specific prop bag here is a type conflict. Injection for tests happens at
// the level below — SessionProvider takes the port and ApiProvider takes the client.
export function App(): React.JSX.Element {
  // One port and one client for the app's lifetime. Built with useMemo (not at module
  // scope) so constructing them — which reads config and touches SecureStore — happens
  // inside the React tree where an error boundary can catch it.
  const port = React.useMemo<AuthPort>(
    // The credential providers are the native half of sign-in; passing them here is
    // what makes the two buttons work (without them the port reports
    // `provider_unavailable`). Google is omitted when its client ID is unset, so an
    // unconfigured build says so instead of failing inside the SDK.
    () => makeSupabaseAuthPort({ client: getSupabase(), ...makeNativeCredentialProviders() }),
    [],
  );
  // THE BEARER WIRING: every request's Authorization header is the CURRENT session's
  // access_token, re-read per request through the port (so a token rotated by
  // autoRefreshToken is picked up instead of a stale captured one).
  const client = React.useMemo(
    () => new ApiClient({ getToken: makeTokenSource(port) }),
    [port],
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SessionProvider port={port}>
            <ApiProvider client={client}>
              <RootGate />
            </ApiProvider>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
