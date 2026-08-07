// SessionProvider + useSession() — the single seam through which the tree learns
// who is signed in. Lives under src/ (not features/auth) because BOTH features/auth
// and features/monetization consume it, and a cross-feature import is lint-banned.
//
// Two things it guarantees:
//  1. `loading` starts TRUE and only clears after the initial getSession() settles,
//     so an already-signed-in user never sees a frame of the sign-in screen;
//  2. it subscribes to the port's auth-state stream, so a sign-in or sign-out
//     re-renders the gate with no imperative navigation call anywhere.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthPort, AuthSessionSnapshot, AuthUserIdentity } from './AuthPort.js';

export interface SessionContextValue {
  readonly session: AuthSessionSnapshot | null;
  readonly user: AuthUserIdentity | null;
  readonly loading: boolean;
  signInWithApple(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly children: React.ReactNode;
  // The port is REQUIRED, not defaulted to the real adapter: constructing the real
  // one imports the supabase client (and SecureStore), so a defaulted provider
  // would drag the native module into every test that renders any subtree.
  readonly port: AuthPort;
}

export function SessionProvider({ children, port }: SessionProviderProps): React.JSX.Element {
  const [session, setSession] = useState<AuthSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Subscribe BEFORE the initial read so a sign-in completing mid-read is not
    // dropped in the gap between the two.
    const unsubscribe = port.subscribe((next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    void port
      .getSession()
      .then((initial) => {
        if (!active) return;
        setSession(initial);
      })
      // A failed read (corrupt/absent keychain entry) means "not signed in", not a
      // crash — and the provider's text is never surfaced.
      .catch(() => {
        if (active) setSession(null);
      })
      // Finally, not then: `loading` MUST clear on both paths or the app hangs on
      // the splash forever.
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [port]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signInWithApple: () => port.signInWithApple(),
      signInWithGoogle: () => port.signInWithGoogle(),
      signOut: () => port.signOut(),
    }),
    [session, loading, port],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used within <SessionProvider>.');
  }
  return value;
}
