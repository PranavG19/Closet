// The screenshot harness composition root. It MIRRORS src/App.tsx's provider order
// exactly — SafeAreaProvider → QueryClient → ThemeProvider → SessionProvider →
// ApiProvider → BillingProvider → PhotoIntakeProvider → RootGate — but injects four
// fakes so the app boots with a default user already signed in and canned backend
// data, on a simulator, WITHOUT a deployed Supabase project or provider keys.
//
// It does NOT import-and-mutate App.tsx; it re-composes the same structure. The
// production root stays byte-for-byte unchanged. This file lives under harness/
// (outside src/features), so it is not part of the shipped app.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/tokens/index.js';
import { ApiProvider, ApiClient, type AppConfig } from '../src/api/index.js';
import {
  SessionProvider,
  useSession,
  chooseRootView,
  makeTokenSource,
  type AuthPort,
} from '../src/session/index.js';
import { BillingProvider } from '../src/billing/index.js';
import { PhotoIntakeProvider } from '../src/photo/index.js';
import { LoadingState } from '../src/ui/index.js';
import { NavShell, type TabScreens } from '../features/navigation/index.js';
import { WardrobeScreen } from '../features/wardrobe/index.js';
import { AddGarmentScreen } from '../features/onboarding/index.js';
import { SuggestionsScreen } from '../features/suggestions/index.js';
import { OutfitsScreen } from '../features/outfits/index.js';
import { LaundryScreen } from '../features/laundry/index.js';
import { PaywallScreen } from '../features/monetization/index.js';
import { SignInScreen, AccountScreen } from '../features/auth/index.js';
import { makeFakeAuthPort } from './fakeAuthPort.js';
import { makeFakeBackend } from './fakeBackend.js';
import { makeFakeBillingPort, makeFakePhotoIntakePort } from './fakePorts.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Dummy config: the fake fetchFn never dials these, but the ApiClient composes a URL
// from functionsBaseUrl, and .invalid is the RFC 2606 TLD guaranteed never to resolve.
const HARNESS_CONFIG: AppConfig = {
  supabaseUrl: 'https://harness.supabase.invalid',
  supabaseAnonKey: 'harness-anon-key-not-a-real-credential',
  functionsBaseUrl: 'https://harness.supabase.invalid/functions/v1',
};

const screens: TabScreens = {
  wardrobe: <WardrobeScreen />,
  add: <AddGarmentScreen />,
  suggestions: <SuggestionsScreen />,
  outfits: <OutfitsScreen />,
  laundry: <LaundryScreen />,
  profile: <PaywallScreen />,
  account: <AccountScreen />,
};

function RootGate(): React.JSX.Element {
  const { loading, session } = useSession();
  const view = chooseRootView({ loading, hasSession: session !== null });
  if (view === 'loading') return <LoadingState message="One moment…" />;
  if (view === 'signIn') return <SignInScreen />;
  return <NavShell screens={screens} />;
}

export function HarnessApp(): React.JSX.Element {
  const port = React.useMemo<AuthPort>(() => makeFakeAuthPort(), []);
  // The bearer is still read through the port's token source (mirrors App.tsx), but the
  // fetchFn is the fake backend, so the (dummy) token is never verified anywhere.
  const client = React.useMemo(
    () =>
      new ApiClient({
        getToken: makeTokenSource(port),
        fetchFn: makeFakeBackend({ entitlementActive: true }),
        config: HARNESS_CONFIG,
      }),
    [port],
  );
  const billing = React.useMemo(() => makeFakeBillingPort(), []);
  const photoIntake = React.useMemo(() => makeFakePhotoIntakePort(), []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SessionProvider port={port}>
            <ApiProvider client={client}>
              <BillingProvider port={billing}>
                <PhotoIntakeProvider port={photoIntake}>
                  <RootGate />
                </PhotoIntakeProvider>
              </BillingProvider>
            </ApiProvider>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default HarnessApp;
