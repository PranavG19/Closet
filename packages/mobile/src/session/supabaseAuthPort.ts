// The REAL AuthPort adapter, over the already-configured supabase-js client
// (src/api/supabase.ts: SecureStore-backed session storage + autoRefreshToken +
// persistSession). This file does NOT rebuild any of that — persistence and refresh
// are the client's job; this only translates its shapes into the port's.
//
// ---------------------------------------------------------------------------
// NATIVE DEPENDENCY STATUS — READ BEFORE WIRING SIGN-IN
// ---------------------------------------------------------------------------
// Obtaining the Apple / Google identity token is the ONE step that needs a native
// module, and NEITHER is installed in packages/mobile/package.json today. So this
// adapter takes each credential provider as an INJECTED function and, when one is
// absent, throws AuthFlowError('provider_unavailable') — a visible, honest failure.
// It never fabricates a session.
//
//   Apple  — needs `expo-apple-authentication`. At wiring time:
//              const credential = await AppleAuthentication.signInAsync({
//                requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
//              });
//              return { idToken: credential.identityToken };
//            then supabase.auth.signInWithIdToken({ provider: 'apple', token }).
//            Apple is REQUIRED on iOS if any other social login ships
//            (App Store Guideline 4.8), so this one is not optional.
//
//   Google — needs `@react-native-google-signin/google-signin` (native, returns an
//            idToken directly) OR `expo-auth-session` + `expo-web-browser` for the
//            browser-redirect flow. The idToken path is preferred because it reuses
//            the same signInWithIdToken call and needs no deep-link plumbing.
//
// Deliberately NOT used: supabase.auth.signInWithOAuth(). On native it returns a
// URL the app must open in a browser and then catch on a deep link — that needs
// expo-web-browser + a configured scheme + a session-from-URL exchange, i.e. MORE
// native surface than the idToken flow, for a worse (browser-bounce) experience.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../api/supabase.js';
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
  // Injectable so a test can drive the adapter with a fake supabase client.
  readonly client?: SupabaseClient;
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

export function makeSupabaseAuthPort(deps: SupabaseAuthPortDeps = {}): AuthPort {
  const client = deps.client ?? getSupabase();

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
