// The Apple / Google credential adapters — the step that turns a tap into a
// provider-issued id token for `supabase.auth.signInWithIdToken`.
//
// THIS FILE HAS NO NATIVE IMPORTS ON PURPOSE. Each adapter takes the native calls
// it needs as a narrow structural surface, so all of the decision logic here
// (cancellation vs failure, missing token, the Apple nonce dance) is unit-testable
// in node with fakes. The real SDKs are bound in ONE place: nativeProviders.ts,
// which is imported only by src/App.tsx.
//
// THE APPLE NONCE DANCE — verified end-to-end against primary sources, because a
// wrong nonce fails ONLY on a device:
//   1. We mint a RAW nonce on-device.
//   2. Apple receives the SHA-256 HEX of it. expo-apple-authentication forwards
//      `options.nonce` verbatim (`request.nonce = options.nonce` in
//      ios/AppleAuthenticationRequest.swift — no CryptoKit, no digest), and Apple
//      copies the value unchanged into the identity token's `nonce` claim.
//   3. Supabase (gotrue) receives the RAW nonce and does
//      `sha256(params.Nonce)` hex-encoded == idToken.Nonce (internal/api/token_oidc.go).
//   So: hash to Apple, raw to Supabase. Sending the raw value to Apple would make
//   gotrue compare sha256(raw) against raw and fail every time.
//
// Google gets NO nonce, deliberately: `SignInParams` in
// @react-native-google-signin/google-signin@16 exposes `loginHint` only — `nonce` is
// a paid-tier / One-Tap option. gotrue requires the request nonce and the token's
// nonce claim to be BOTH present or BOTH absent, so omitting it on both sides is the
// consistent choice; adding one only to our request would fail the presence check.
import { AuthFlowError, type NativeCredential, type NativeCredentialProvider } from './AuthPort.js';

// expo-apple-authentication rejects with this `code` when she dismisses the sheet.
// Matching on `.code` (never `.message`) keeps provider text out of the app.
const APPLE_CANCELLED_CODE = 'ERR_REQUEST_CANCELED';

// Reads a `code` off an unknown thrown value without touching its message.
function thrownCode(thrown: unknown): string | null {
  if (typeof thrown !== 'object' || thrown === null) return null;
  const code = (thrown as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

// The slice of expo-apple-authentication + expo-crypto the Apple adapter needs.
export interface AppleNativeSurface {
  // False on Android and on iOS < 13 — that is `provider_unavailable`, not a failure.
  readonly isAvailable: () => Promise<boolean>;
  // Receives the ALREADY-HASHED nonce (see the header) and returns the credential.
  readonly signIn: (hashedNonce: string) => Promise<{ readonly identityToken: string | null }>;
  readonly sha256Hex: (value: string) => Promise<string>;
  readonly randomNonce: () => string;
}

export function makeAppleCredentialProvider(native: AppleNativeSurface): NativeCredentialProvider {
  return async function appleCredential(): Promise<NativeCredential> {
    if (!(await native.isAvailable())) throw new AuthFlowError('provider_unavailable');

    const rawNonce = native.randomNonce();
    // gotrue compares against a lowercase hex digest (Go's `%x`). expo-crypto's HEX
    // encoding is already lowercase on every platform; normalising costs nothing and
    // removes the one casing mismatch that would only ever show up on a device.
    const hashedNonce = (await native.sha256Hex(rawNonce)).toLowerCase();

    let identityToken: string | null;
    try {
      ({ identityToken } = await native.signIn(hashedNonce));
    } catch (thrown: unknown) {
      // Cancellation is NOT an error: authErrorMessage('cancelled') renders nothing.
      // Everything else is a real failure and must not be disguised as a cancel.
      if (thrownCode(thrown) === APPLE_CANCELLED_CODE) throw new AuthFlowError('cancelled');
      throw new AuthFlowError('rejected');
    }

    // Apple returns a credential with no identityToken when the request could not be
    // completed. There is nothing to exchange, so this is a failure, not a cancel.
    if (identityToken === null) throw new AuthFlowError('rejected');

    // The RAW nonce travels to Supabase; Apple already got the hash.
    return { idToken: identityToken, nonce: rawNonce };
  };
}

// The slice of @react-native-google-signin/google-signin the Google adapter needs.
export interface GoogleNativeSurface {
  // Android-only Play Services preflight; resolves on iOS.
  readonly ensurePlayServices: () => Promise<unknown>;
  // v16 returns a DISCRIMINATED UNION and does not throw on cancel.
  readonly signIn: () => Promise<
    { readonly type: string; readonly data: { readonly idToken: string | null } | null }
  >;
}

export function makeGoogleCredentialProvider(
  native: GoogleNativeSurface,
): NativeCredentialProvider {
  return async function googleCredential(): Promise<NativeCredential> {
    try {
      await native.ensurePlayServices();
    } catch {
      // No / outdated Play Services: the button genuinely cannot work on this device.
      throw new AuthFlowError('provider_unavailable');
    }

    let response;
    try {
      response = await native.signIn();
    } catch {
      throw new AuthFlowError('rejected');
    }

    // Cancel arrives as a RETURN VALUE here (`{ type: 'cancelled', data: null }`),
    // not a throw — the trap this adapter exists to absorb.
    if (response.type === 'cancelled') throw new AuthFlowError('cancelled');

    const idToken = response.data?.idToken ?? null;
    // `idToken` is null unless a valid webClientId was configured. Without it there is
    // nothing to exchange, so fail loudly rather than sending `null` to Supabase.
    if (response.type !== 'success' || idToken === null) throw new AuthFlowError('rejected');

    return { idToken };
  };
}
