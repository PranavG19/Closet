// The REAL AuthPort adapter, over the already-configured supabase-js client
// (src/api/supabase.ts: SecureStore-backed session storage + autoRefreshToken +
// persistSession). This file does NOT rebuild any of that — persistence and refresh
// are the client's job; this only translates its shapes into the port's.
//
// ---------------------------------------------------------------------------
// NATIVE DEPENDENCY STATUS — WIRED
// ---------------------------------------------------------------------------
// Obtaining the Apple / Google identity token is the ONE step that needs a native
// module. Both are now installed (`expo-apple-authentication` + `expo-crypto` for the
// nonce, `@react-native-google-signin/google-signin`) and bound to this adapter in
// src/session/nativeProviders.ts, which src/App.tsx passes in.
//
// The providers remain INJECTED rather than imported here: this file must stay free of
// native imports so it is unit-testable, and an unconfigured provider (e.g. no Google
// client ID in the build) is simply absent, which surfaces as
// AuthFlowError('provider_unavailable') — a visible, honest failure. It never
// fabricates a session. See nativeCredentials.ts for the Apple nonce dance.
//
// Deliberately NOT used: supabase.auth.signInWithOAuth(). On native it returns a
// URL the app must open in a browser and then catch on a deep link — that needs
// expo-web-browser + a configured scheme + a session-from-URL exchange, i.e. MORE
// native surface than the idToken flow, for a worse (browser-bounce) experience.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  AuthFlowError,
  type AuthPort,
  type AuthSessionSnapshot,
  type NativeCredentialProvider,
} from './AuthPort.js';

// Maps a supabase Session onto the port's snapshot. Only the token + the id + the
// email cross this line; the provider's `user_metadata` blob is dropped on purpose.
function toSnapshot(session: Session | null): AuthSessionSnapshot | null {
  if (session === null) return null;
  return {
    accessToken: session.access_token,
    user: { userId: session.user.id, email: session.user.email ?? null },
  };
}

export interface SupabaseAuthPortDeps {
  // REQUIRED, and injected rather than imported: a static `getSupabase()` import here
  // would pull react-native into this module's graph, and the unit runner cannot parse
  // react-native's Flow source — the whole adapter would become untestable. App.tsx
  // passes the real client; tests pass a fake.
  readonly client: SupabaseClient;
  // Absent => that button reports `provider_unavailable` (see the header).
  readonly appleCredential?: NativeCredentialProvider;
  readonly googleCredential?: NativeCredentialProvider;
}

async function signInWithProvider(
  client: SupabaseClient,
  provider: 'apple' | 'google',
  credentialProvider: NativeCredentialProvider | undefined,
): Promise<void> {
  if (credentialProvider === undefined) throw new AuthFlowError('provider_unavailable');

  // The native SDK throws when she dismisses the sheet. That is a cancellation, not
  // a failure — and the provider's text never travels past this catch.
  let credential;
  try {
    credential = await credentialProvider();
  } catch {
    throw new AuthFlowError('cancelled');
  }

  const { error } = await client.auth.signInWithIdToken({
    provider,
    token: credential.idToken,
    ...(credential.nonce !== undefined ? { nonce: credential.nonce } : {}),
  });
  // `error.message` is intentionally discarded: it can echo the submitted email or
  // an internal reason. The code is the whole contract the UI gets.
  if (error !== null) throw new AuthFlowError('rejected');
}

export function makeSupabaseAuthPort(deps: SupabaseAuthPortDeps): AuthPort {
  const { client } = deps;

  return {
    async getSession(): Promise<AuthSessionSnapshot | null> {
      // supabase-js reads SecureStore here and refreshes an expired token before
      // returning — which is exactly why the TokenSource calls this per request.
      const { data } = await client.auth.getSession();
      return toSnapshot(data.session);
    },

    subscribe(listener): () => void {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toSnapshot(session));
      });
      return () => data.subscription.unsubscribe();
    },

    signInWithApple(): Promise<void> {
      return signInWithProvider(client, 'apple', deps.appleCredential);
    },

    signInWithGoogle(): Promise<void> {
      return signInWithProvider(client, 'google', deps.googleCredential);
    },

    async signOut(): Promise<void> {
      // Clears the SecureStore-persisted session. The onAuthStateChange listener
      // fires with null, so the gate swaps to SignInScreen without a manual reset.
      await client.auth.signOut();
    },
  };
}
