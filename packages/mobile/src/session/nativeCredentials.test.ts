// The credential adapters, driven through fake native surfaces. The properties that
// matter are BEHAVIOURAL, not shape-based:
//
//   1. A cancellation is a `cancelled` code, whose copy is NULL — she dismissed the
//      sheet on purpose and must see nothing. Surfacing an error there is the real UX
//      bug, so it gets a direct assertion through authErrorMessage.
//   2. A genuine provider failure maps into the CLOSED code set and the provider's
//      text never reaches the message. The oracle is a native error stuffed with
//      realistic PII.
//   3. The Apple nonce dance: Apple gets the SHA-256 HEX, Supabase gets the RAW value.
//      The hash oracle is an INDEPENDENT node:crypto digest — not a value this file
//      computed with the same helper under test.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  makeAppleCredentialProvider,
  makeGoogleCredentialProvider,
  type AppleNativeSurface,
  type GoogleNativeSurface,
} from './nativeCredentials.js';
import { AuthFlowError, authErrorMessage, type AuthErrorCode } from './AuthPort.js';

const RAW_NONCE = 'b7c1f0d2-4e5a-4c3b-9a8d-1f2e3c4b5a60';
const APPLE_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.apple-identity-token.sig';
const GOOGLE_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.google-id-token.sig';

// A native error exactly like the ones the SDKs throw: a `code` plus a message full of
// things that must never reach a screen.
function nativeError(code: string): Error & { code: string } {
  const error = new Error(
    `Apple auth failed for her.real.name@icloud.com on device 8A2F-91C3 via https://internal.apple.example/auth`,
  );
  return Object.assign(error, { code });
}

// Captures what each native call received, so "Apple got the hash" is an observed
// fact rather than a comment.
function appleSurface(
  overrides: Partial<AppleNativeSurface> = {},
): { native: AppleNativeSurface; nonceSentToApple: () => string | null } {
  let nonceSentToApple: string | null = null;
  const native: AppleNativeSurface = {
    isAvailable: async () => true,
    randomNonce: () => RAW_NONCE,
    sha256Hex: async (value) => createHash('sha256').update(value).digest('hex'),
    signIn: async (hashedNonce) => {
      nonceSentToApple = hashedNonce;
      return { identityToken: APPLE_TOKEN };
    },
    ...overrides,
  };
  return { native, nonceSentToApple: () => nonceSentToApple };
}

function googleSurface(overrides: Partial<GoogleNativeSurface> = {}): GoogleNativeSurface {
  return {
    ensurePlayServices: async () => true,
    signIn: async () => ({ type: 'success', data: { idToken: GOOGLE_TOKEN } }),
    ...overrides,
  };
}

// Asserts the thrown value is an AuthFlowError carrying `code` — and, critically, that
// nothing renderable from it contains the provider's text.
async function expectCode(run: () => Promise<unknown>, code: AuthErrorCode): Promise<void> {
  const thrown: unknown = await run().then(
    () => null,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(AuthFlowError);
  expect((thrown as AuthFlowError).code).toBe(code);
  // The AuthFlowError's own message is the code, so even String(error) is safe.
  expect((thrown as AuthFlowError).message).toBe(code);
}

describe('makeAppleCredentialProvider — the nonce dance', () => {
  it('sends Apple the SHA-256 HEX of the nonce and Supabase the RAW nonce', async () => {
    const { native, nonceSentToApple } = appleSurface();
    const credential = await makeAppleCredentialProvider(native)();

    // Independent oracle: node's own SHA-256, computed here, not by the code under test.
    const expectedHash = createHash('sha256').update(RAW_NONCE).digest('hex');
    expect(nonceSentToApple()).toBe(expectedHash);
    // The raw value is what gotrue re-hashes to compare against the token claim.
    expect(credential.nonce).toBe(RAW_NONCE);
    expect(credential.idToken).toBe(APPLE_TOKEN);
    // The exact inversion that breaks only on a device: raw to Apple, hash to Supabase.
    expect(nonceSentToApple()).not.toBe(RAW_NONCE);
    expect(credential.nonce).not.toBe(expectedHash);
  });

  it('sends Apple a lowercase hex digest (gotrue compares against Go %x)', async () => {
    const { native, nonceSentToApple } = appleSurface({
      // A platform that hands back UPPERCASE hex must not break the comparison.
      sha256Hex: async (value) => createHash('sha256').update(value).digest('hex').toUpperCase(),
    });
    await makeAppleCredentialProvider(native)();
    const sent = nonceSentToApple() as string;
    expect(sent).toBe(sent.toLowerCase());
    expect(sent).toBe(createHash('sha256').update(RAW_NONCE).digest('hex'));
  });

  it('uses a fresh nonce per attempt (a replayed nonce defeats the whole mechanism)', async () => {
    let counter = 0;
    const { native, nonceSentToApple } = appleSurface({
      randomNonce: () => `nonce-${(counter += 1)}`,
    });
    const provider = makeAppleCredentialProvider(native);
    const first = await provider();
    const firstHash = nonceSentToApple();
    const second = await provider();
    expect(first.nonce).not.toBe(second.nonce);
    expect(nonceSentToApple()).not.toBe(firstHash);
  });
});

describe('makeAppleCredentialProvider — cancellation is NOT an error', () => {
  it('maps ERR_REQUEST_CANCELED to a code that renders NOTHING', async () => {
    const { native } = appleSurface({
      signIn: async () => {
        throw nativeError('ERR_REQUEST_CANCELED');
      },
    });
    await expectCode(makeAppleCredentialProvider(native), 'cancelled');
    // The property that actually matters to her: no message on the screen.
    expect(authErrorMessage('cancelled')).toBeNull();
  });

  it('does NOT treat a genuine failure as a cancellation', async () => {
    const { native } = appleSurface({
      signIn: async () => {
        throw nativeError('ERR_REQUEST_FAILED');
      },
    });
    await expectCode(makeAppleCredentialProvider(native), 'rejected');
    // A real failure must say something, unlike a cancel.
    expect(authErrorMessage('rejected')).not.toBeNull();
  });

  it('treats a thrown value with no code as a failure, not a cancellation', async () => {
    const { native } = appleSurface({
      signIn: async () => {
        throw new Error('boom her@example.com');
      },
    });
    await expectCode(makeAppleCredentialProvider(native), 'rejected');
  });
});

describe('makeAppleCredentialProvider — failures stay inside the closed set', () => {
  it('reports provider_unavailable when Apple auth is not available (Android / old iOS)', async () => {
    const { native, nonceSentToApple } = appleSurface({ isAvailable: async () => false });
    await expectCode(makeAppleCredentialProvider(native), 'provider_unavailable');
    // It bailed before prompting, so no sheet was ever shown.
    expect(nonceSentToApple()).toBeNull();
  });

  it('rejects a credential with a null identityToken instead of sending null onward', async () => {
    const { native } = appleSurface({ signIn: async () => ({ identityToken: null }) });
    await expectCode(makeAppleCredentialProvider(native), 'rejected');
  });

  it('never lets the native error text become a renderable message', async () => {
    const { native } = appleSurface({
      signIn: async () => {
        throw nativeError('ERR_REQUEST_FAILED');
      },
    });
    const thrown: unknown = await makeAppleCredentialProvider(native)().then(
      () => null,
      (error: unknown) => error,
    );
    const message = authErrorMessage((thrown as AuthFlowError).code) as string;
    expect(message).not.toContain('her.real.name@icloud.com');
    expect(message).not.toContain('8A2F-91C3');
    expect(message).not.toContain('internal.apple.example');
  });
});

describe('makeGoogleCredentialProvider', () => {
  it('returns the idToken on success, with no nonce (v16 cannot set one)', async () => {
    const credential = await makeGoogleCredentialProvider(googleSurface())();
    expect(credential.idToken).toBe(GOOGLE_TOKEN);
    // gotrue requires request-nonce and token-nonce to both exist or both be absent.
    expect(credential.nonce).toBeUndefined();
  });

  it('treats the RETURNED cancelled response as a cancellation, not a failure', async () => {
    // v16's signIn RESOLVES with { type: 'cancelled' } — it does not throw. An adapter
    // that only caught throws would show her an error for tapping away.
    const native = googleSurface({ signIn: async () => ({ type: 'cancelled', data: null }) });
    await expectCode(makeGoogleCredentialProvider(native), 'cancelled');
    expect(authErrorMessage('cancelled')).toBeNull();
  });

  it('reports provider_unavailable when Play Services are missing', async () => {
    const native = googleSurface({
      ensurePlayServices: async () => {
        throw nativeError('PLAY_SERVICES_NOT_AVAILABLE');
      },
    });
    await expectCode(makeGoogleCredentialProvider(native), 'provider_unavailable');
  });

  it('rejects a success response whose idToken is null (missing webClientId)', async () => {
    const native = googleSurface({
      signIn: async () => ({ type: 'success', data: { idToken: null } }),
    });
    await expectCode(makeGoogleCredentialProvider(native), 'rejected');
  });

  it('maps a thrown native error to rejected without leaking its text', async () => {
    const native = googleSurface({
      signIn: async () => {
        throw nativeError('ERR_SOMETHING');
      },
    });
    await expectCode(makeGoogleCredentialProvider(native), 'rejected');
  });
});
