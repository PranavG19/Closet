// THE ONLY file in the app that imports the native sign-in SDKs. Everything else
// depends on the injected `NativeCredentialProvider` shape, which is why the adapters
// in nativeCredentials.ts are unit-testable without a device.
//
// Google needs client IDs to mint an idToken at all, and those are per-platform
// values from the Google Cloud console. They are read from EXPO_PUBLIC_* (the same
// mechanism src/api/config.ts documents: Metro inlines these at bundle time, so this
// is a compile-time constant, not the Deno-style runtime lookup the process.env rule
// forbids). When the web client ID is ABSENT the Google provider is omitted, so the
// button reports `provider_unavailable` instead of failing deep inside the SDK with a
// null idToken — a build that was never configured says so.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import type { NativeCredentialProvider } from './AuthPort.js';
import {
  makeAppleCredentialProvider,
  makeGoogleCredentialProvider,
} from './nativeCredentials.js';

const appleCredential: NativeCredentialProvider = makeAppleCredentialProvider({
  isAvailable: () => AppleAuthentication.isAvailableAsync(),
  // The hash goes to Apple; nativeCredentials.ts keeps the raw value for Supabase.
  signIn: (hashedNonce) =>
    AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    }),
  sha256Hex: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
      encoding: Crypto.CryptoEncoding.HEX,
    }),
  randomNonce: () => Crypto.randomUUID(),
});

// FULL_NAME is deliberately not requested: the app stores no name (see AuthPort's
// AuthUserIdentity — user id + email only).

function googleWebClientId(): string | undefined {
  const value = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  return value === undefined || value.length === 0 ? undefined : value;
}

function configuredGoogleCredential(): NativeCredentialProvider | undefined {
  const webClientId = googleWebClientId();
  if (webClientId === undefined) return undefined;

  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  // webClientId is what makes the returned `idToken` non-null — without it the SDK
  // signs in and hands back a credential we cannot exchange with Supabase.
  GoogleSignin.configure({
    webClientId,
    ...(iosClientId !== undefined && iosClientId.length > 0 ? { iosClientId } : {}),
  });

  return makeGoogleCredentialProvider({
    ensurePlayServices: () => GoogleSignin.hasPlayServices(),
    signIn: () => GoogleSignin.signIn(),
  });
}

// Built once at the composition root. Apple is always present (iOS availability is
// checked inside the adapter and degrades to `provider_unavailable` on Android).
export function makeNativeCredentialProviders(): {
  readonly appleCredential: NativeCredentialProvider;
  readonly googleCredential?: NativeCredentialProvider;
} {
  const googleCredential = configuredGoogleCredential();
  return {
    appleCredential,
    ...(googleCredential !== undefined ? { googleCredential } : {}),
  };
}
