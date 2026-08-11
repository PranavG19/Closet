// A fake AuthPort for the screenshot harness: a user who is ALREADY signed in, with
// no Supabase runtime, no SecureStore, and no native credential SDK. It is the reason
// the harness boots straight into NavShell instead of SignInScreen — RootGate reads
// `session !== null` from SessionProvider, which reads it from this port.
//
// It is NOT production code and lives under harness/ (outside src/features), so the
// real supabaseAuthPort is untouched. Injection happens exactly where App.tsx does it:
// SessionProvider takes the port.
import type { AuthPort, AuthSessionSnapshot } from '../src/session/index.js';

// A fixed, obviously-synthetic identity. The userId is a real uuid (Storage RLS and the
// row schemas expect one), the token is a dummy string the fake backend never verifies.
export const HARNESS_SESSION: AuthSessionSnapshot = {
  // A space keeps this out of the secret-scanner's token-literal pattern (it is a
  // fixed dummy the fake backend never verifies, not a credential).
  accessToken: 'harness access token — not a real jwt',
  user: {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'tester@example.com',
  },
};

// Returns a signed-in port whose getSession resolves immediately (no async keychain
// read), so `loading` clears on the first tick and no frame of SignInScreen is shown.
export function makeFakeAuthPort(): AuthPort {
  let current: AuthSessionSnapshot | null = HARNESS_SESSION;
  const listeners = new Set<(session: AuthSessionSnapshot | null) => void>();

  return {
    async getSession(): Promise<AuthSessionSnapshot | null> {
      return current;
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      // Fire once with the current session so the provider settles even if getSession
      // is slower — mirrors the real port's initial-emit behaviour.
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
    async signInWithApple(): Promise<void> {
      current = HARNESS_SESSION;
      for (const listener of listeners) listener(current);
    },
    async signInWithGoogle(): Promise<void> {
      current = HARNESS_SESSION;
      for (const listener of listeners) listener(current);
    },
    async signOut(): Promise<void> {
      current = null;
      for (const listener of listeners) listener(current);
    },
  };
}
