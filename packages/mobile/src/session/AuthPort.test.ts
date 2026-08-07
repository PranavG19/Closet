// The auth-error mapping. What matters here is a NEGATIVE property: no provider text
// ever becomes user-visible copy. The oracle is the hand-written copy table plus a
// leak assertion against a message stuffed with realistic PII.
import { describe, it, expect } from 'vitest';
import {
  AuthFlowError,
  authErrorMessage,
  authErrorMessageFromThrown,
  type AuthErrorCode,
} from './AuthPort.js';

const ALL_CODES: readonly AuthErrorCode[] = [
  'provider_unavailable',
  'cancelled',
  'rejected',
  'unknown',
];

describe('authErrorMessage', () => {
  it('returns NOTHING for a user cancellation (dismissing the sheet is not an error)', () => {
    expect(authErrorMessage('cancelled')).toBeNull();
  });

  it('returns a non-empty message for every non-cancelled code', () => {
    for (const code of ALL_CODES) {
      if (code === 'cancelled') continue;
      const message = authErrorMessage(code);
      expect(message).not.toBeNull();
      expect((message as string).length).toBeGreaterThan(0);
    }
  });

  it('never surfaces the code itself as copy (the codes are internal)', () => {
    for (const code of ALL_CODES) {
      const message = authErrorMessage(code);
      if (message !== null) expect(message).not.toContain(code);
    }
  });
});

describe('authErrorMessageFromThrown — the PII barrier', () => {
  it('maps an AuthFlowError to its code copy', () => {
    expect(authErrorMessageFromThrown(new AuthFlowError('provider_unavailable'))).toBe(
      authErrorMessage('provider_unavailable'),
    );
  });

  it('does NOT leak the text of an arbitrary thrown Error into the message', () => {
    // A realistic provider error: an email, a device id and an internal URL — exactly
    // what must never reach the screen.
    const leaky = new Error(
      'AuthApiError: user her.real.name@gmail.com device 8A2F-91C3 at https://internal.auth.example/v1/token',
    );
    const message = authErrorMessageFromThrown(leaky);
    expect(message).toBe(authErrorMessage('unknown'));
    expect(message).not.toContain('her.real.name@gmail.com');
    expect(message).not.toContain('8A2F-91C3');
    expect(message).not.toContain('internal.auth.example');
  });

  it('does not leak a raw thrown string either', () => {
    const message = authErrorMessageFromThrown('invalid_grant for her@example.com');
    expect(message).toBe(authErrorMessage('unknown'));
    expect(message).not.toContain('her@example.com');
  });

  it("an AuthFlowError's own message is the code, never provider text", () => {
    // Belt-and-braces: even a careless String(error) at some future call site cannot
    // print a provider payload.
    expect(new AuthFlowError('rejected').message).toBe('rejected');
  });
});
