// The session-gate decision table. The oracle is the EXHAUSTIVE enumeration of the
// input space written out by hand below — not the function's own output — so a
// reordered branch (the flash bug) turns this red.
import { describe, it, expect } from 'vitest';
import { chooseRootView, type RootView, type SessionGateState } from './gate.js';

// All four (loading × hasSession) combinations with the answer stated independently.
const CASES: readonly (SessionGateState & { readonly expected: RootView })[] = [
  // loading dominates: while the persisted session is still being read, NOTHING is
  // known, so neither the sign-in screen nor the app may be shown.
  { loading: true, hasSession: false, expected: 'loading' },
  { loading: true, hasSession: true, expected: 'loading' },
  { loading: false, hasSession: false, expected: 'signIn' },
  { loading: false, hasSession: true, expected: 'app' },
];

describe('chooseRootView — the session gate', () => {
  for (const { loading, hasSession, expected } of CASES) {
    it(`loading=${String(loading)} hasSession=${String(hasSession)} -> ${expected}`, () => {
      expect(chooseRootView({ loading, hasSession })).toBe(expected);
    });
  }

  it('never shows the app without a session (the whole point of the gate)', () => {
    for (const { loading, hasSession } of CASES) {
      if (!hasSession) expect(chooseRootView({ loading, hasSession })).not.toBe('app');
    }
  });

  it('never flashes signIn while still loading, even with no session yet', () => {
    // This is the specific regression: `session === null ? signIn : app` without the
    // loading branch would return 'signIn' here and flash it at a signed-in user.
    expect(chooseRootView({ loading: true, hasSession: false })).toBe('loading');
  });
});
