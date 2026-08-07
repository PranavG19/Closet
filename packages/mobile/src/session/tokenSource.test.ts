// The TokenSource wiring: does the bearer the API client attaches actually come from
// the CURRENT session? Driven through a fake AuthPort (no supabase, no SecureStore),
// which is precisely what the port seam buys.
import { describe, it, expect } from 'vitest';
import { makeTokenSource } from './tokenSource.js';
import type { AuthPort, AuthSessionSnapshot } from './AuthPort.js';

const USER = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';

function snapshot(accessToken: string): AuthSessionSnapshot {
  return { accessToken, user: { userId: USER, email: 'her@example.com' } };
}

// A fake port whose getSession() returns whatever the test's mutable cell holds, and
// which counts reads — so "re-read per request" is an observable fact, not a comment.
function fakePort(initial: AuthSessionSnapshot | null): {
  port: AuthPort;
  set: (next: AuthSessionSnapshot | null) => void;
  reads: () => number;
} {
  let current = initial;
  let reads = 0;
  const port: AuthPort = {
    getSession: async () => {
      reads += 1;
      return current;
    },
    subscribe: () => () => {},
    signInWithApple: async () => {},
    signInWithGoogle: async () => {},
    signOut: async () => {},
  };
  return { port, set: (next) => (current = next), reads: () => reads };
}

describe('makeTokenSource', () => {
  it('returns the current session access token', async () => {
    const { port } = fakePort(snapshot('jwt-real-session'));
    // Oracle: the literal token I put into the fake session.
    await expect(makeTokenSource(port)()).resolves.toBe('jwt-real-session');
  });

  it('returns null when signed out (so no Authorization header is sent)', async () => {
    const { port } = fakePort(null);
    await expect(makeTokenSource(port)()).resolves.toBeNull();
  });

  it('re-reads on EVERY call, so a refreshed token is picked up (not captured once)', async () => {
    const { port, set, reads } = fakePort(snapshot('jwt-before-refresh'));
    const getToken = makeTokenSource(port);
    await expect(getToken()).resolves.toBe('jwt-before-refresh');
    // autoRefreshToken rotates the token behind the app's back.
    set(snapshot('jwt-after-refresh'));
    await expect(getToken()).resolves.toBe('jwt-after-refresh');
    expect(reads()).toBe(2);
  });

  it('flips to null after sign-out without rebuilding the token source', async () => {
    const { port, set } = fakePort(snapshot('jwt-live'));
    const getToken = makeTokenSource(port);
    await expect(getToken()).resolves.toBe('jwt-live');
    set(null);
    await expect(getToken()).resolves.toBeNull();
  });
});
