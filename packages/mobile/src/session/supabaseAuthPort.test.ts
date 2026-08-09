// The wiring test: does a credential produced by the REAL adapters actually reach
// supabase's signInWithIdToken with the right provider, token and nonce? Driven with a
// fake supabase client (injected via SupabaseAuthPortDeps.client) and fake native
// surfaces — no SecureStore, no native module, no network.
//
// This is the seam the previous state failed at: makeSupabaseAuthPort() was called with
// no credential providers, so both buttons threw provider_unavailable.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { makeSupabaseAuthPort } from './supabaseAuthPort.js';
import {
  makeAppleCredentialProvider,
  makeGoogleCredentialProvider,
} from './nativeCredentials.js';
import { AuthFlowError, authErrorMessageFromThrown } from './AuthPort.js';

const RAW_NONCE = 'd41d8cd9-1111-4222-8333-444455556666';
const APPLE_TOKEN = 'apple.identity.token';
const GOOGLE_TOKEN = 'google.id.token';

interface IdTokenCall {
  readonly provider: string;
  readonly token: string;
  readonly nonce?: string;
}

// Only the auth methods the adapter touches. The `as unknown as SupabaseClient` cast is
// confined to this test double (matching src/api/*.test.ts's fetch fakes) — production
// code never casts across this boundary.
function fakeClient(signInError: { message: string } | null = null): {
  client: SupabaseClient;
  calls: IdTokenCall[];
} {
  const calls: IdTokenCall[] = [];
  const client = {
    auth: {
      signInWithIdToken: async (credentials: IdTokenCall) => {
        calls.push(credentials);
        return { data: {}, error: signInError };
      },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function appleProvider(overrides: { cancel?: boolean } = {}) {
  return makeAppleCredentialProvider({
    isAvailable: async () => true,
    randomNonce: () => RAW_NONCE,
    sha256Hex: async (value) => createHash('sha256').update(value).digest('hex'),
    signIn: async () => {
      if (overrides.cancel === true) {
        throw Object.assign(new Error('user tapped away her@icloud.com'), {
          code: 'ERR_REQUEST_CANCELED',
        });
      }
      return { identityToken: APPLE_TOKEN };
    },
  });
}

const googleProvider = makeGoogleCredentialProvider({
  ensurePlayServices: async () => true,
  signIn: async () => ({ type: 'success', data: { idToken: GOOGLE_TOKEN } }),
});

describe('makeSupabaseAuthPort — a real credential reaches signInWithIdToken', () => {
  it('passes the Apple identityToken and the RAW nonce through to supabase', async () => {
    const { client, calls } = fakeClient();
    const port = makeSupabaseAuthPort({ client, appleCredential: appleProvider() });

    await port.signInWithApple();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.provider).toBe('apple');
    expect(calls[0]?.token).toBe(APPLE_TOKEN);
    // gotrue re-hashes THIS value and compares it to the token's nonce claim, so the
    // raw nonce — not the digest Apple received — is what must arrive here.
    expect(calls[0]?.nonce).toBe(RAW_NONCE);
    expect(calls[0]?.nonce).not.toBe(createHash('sha256').update(RAW_NONCE).digest('hex'));
  });

  it('passes the Google idToken through with NO nonce key at all', async () => {
    const { client, calls } = fakeClient();
    const port = makeSupabaseAuthPort({ client, googleCredential: googleProvider });

    await port.signInWithGoogle();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.provider).toBe('google');
    expect(calls[0]?.token).toBe(GOOGLE_TOKEN);
    // Present-but-undefined would still fail gotrue's both-or-neither check if it were
    // serialised, so the key must be absent entirely.
    expect(Object.hasOwn(calls[0] as object, 'nonce')).toBe(false);
  });

  it('a cancelled Apple sign-in never calls supabase and renders NO message', async () => {
    const { client, calls } = fakeClient();
    const port = makeSupabaseAuthPort({ client, appleCredential: appleProvider({ cancel: true }) });

    const thrown: unknown = await port.signInWithApple().then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(AuthFlowError);
    expect((thrown as AuthFlowError).code).toBe('cancelled');
    // Nothing was exchanged...
    expect(calls).toHaveLength(0);
    // ...and this is what SignInScreen puts in state: nothing.
    expect(authErrorMessageFromThrown(thrown)).toBeNull();
  });

  it('maps a supabase rejection to `rejected` without leaking its message', async () => {
    const { client } = fakeClient({
      message: 'AuthApiError: bad id_token for her.real.name@icloud.com at https://x.supabase.co',
    });
    const port = makeSupabaseAuthPort({ client, appleCredential: appleProvider() });

    const thrown: unknown = await port.signInWithApple().then(
      () => null,
      (error: unknown) => error,
    );

    expect((thrown as AuthFlowError).code).toBe('rejected');
    const message = authErrorMessageFromThrown(thrown) as string;
    expect(message).not.toContain('her.real.name@icloud.com');
    expect(message).not.toContain('supabase.co');
  });

  it('still reports provider_unavailable when a provider was NOT injected', async () => {
    const { client, calls } = fakeClient();
    // The pre-fix state, kept as a regression guard: an unconfigured Google build must
    // say so rather than fail somewhere deeper.
    const port = makeSupabaseAuthPort({ client, appleCredential: appleProvider() });

    const thrown: unknown = await port.signInWithGoogle().then(
      () => null,
      (error: unknown) => error,
    );

    expect((thrown as AuthFlowError).code).toBe('provider_unavailable');
    expect(calls).toHaveLength(0);
  });
});
