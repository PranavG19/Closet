// The auth PORT — the seam between "what the app needs from identity" and "which
// SDK provides it". Everything above this line (SessionProvider, SignInScreen, the
// API client's TokenSource) depends ONLY on this interface, so all of it compiles
// and unit-tests with a fake port and NO native module present.
//
// Why a port and not a direct supabase.auth call: the real adapter transitively
// imports expo-secure-store (the session store) and, for the sign-in buttons, the
// native Apple/Google credential SDKs. A unit test cannot load those, so the
// decision logic would be untestable if it talked to supabase directly.
//
// This port covers auth ONLY. Table access is never here (repos-only: the typed
// Edge client is the sole data path; supabase.from() is banned in mobile).
import type { TokenSource } from '../api/client.js';

// The signed-in identity as the UI is allowed to know it. Deliberately minimal:
// the user id (the JWT `sub` — the same value every endpoint derives server-side)
// and the email if the provider released one. NO provider profile blob, no photo
// URL, no name — nothing the app does not need.
export interface AuthUserIdentity {
  readonly userId: string;
  readonly email: string | null;
}

// A live session: the bearer the API client attaches, plus who it belongs to.
export interface AuthSessionSnapshot {
  readonly accessToken: string;
  readonly user: AuthUserIdentity;
}

// The CLOSED set of auth failure reasons the UI may render. A raw provider /
// Supabase message NEVER reaches a screen: it can carry an email, a device id, or
// an internal URL (PII rule), and it is not written in this product's voice. The
// adapter maps whatever it caught onto one of these codes and drops the text.
export type AuthErrorCode = 'provider_unavailable' | 'cancelled' | 'rejected' | 'unknown';

export class AuthFlowError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    // The `message` is the code itself, not provider text — so even an accidental
    // `String(error)` at a call site cannot leak a provider payload.
    super(code);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

// Code -> the copy a screen shows. `cancelled` returns null: she tapped away on
// purpose, which is not an error and must not be dressed as one.
export function authErrorMessage(code: AuthErrorCode): string | null {
  switch (code) {
    case 'cancelled':
      return null;
    case 'provider_unavailable':
      return "That sign-in option isn't available in this build. Try the other one.";
    case 'rejected':
      return "We couldn't finish signing you in. Please try again.";
    case 'unknown':
      return 'Something went sideways. Please try again.';
  }
}

// Narrows an unknown thrown value to a renderable message without ever reading a
// non-AuthFlowError's text.
export function authErrorMessageFromThrown(thrown: unknown): string | null {
  if (thrown instanceof AuthFlowError) return authErrorMessage(thrown.code);
  return authErrorMessage('unknown');
}

// A native OAuth credential: the provider-issued id token the Supabase
// `signInWithIdToken` flow exchanges for a session, plus the nonce Apple requires
// when one was used to request the credential.
export interface NativeCredential {
  readonly idToken: string;
  readonly nonce?: string;
}

// Obtaining a NativeCredential is the ONLY part of sign-in that needs a native
// module (see supabaseAuthPort.ts for which one per provider). It is injected, so
// the adapter itself has no native import and a build without the dep fails
// LOUDLY with `provider_unavailable` rather than pretending to sign in.
export type NativeCredentialProvider = () => Promise<NativeCredential>;

export interface AuthPort {
  // The persisted session, if any. Called once at startup so the app can decide
  // between the sign-in screen and the app WITHOUT flashing the wrong one.
  getSession(): Promise<AuthSessionSnapshot | null>;
  // Push updates on sign-in / sign-out / token refresh. Returns an unsubscribe.
  subscribe(listener: (session: AuthSessionSnapshot | null) => void): () => void;
  signInWithApple(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

// Re-exported for convenience at the wiring site (makeTokenSource returns one).
export type { TokenSource };
