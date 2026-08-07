// The session gate decision, extracted as a PURE function so the one piece of
// logic that decides what the whole app shows is unit-testable with no renderer.
//
// The `loading` branch exists to kill a specific bug: reading the persisted session
// out of SecureStore is async, so a naive `session === null ? <SignIn/> : <App/>`
// renders the sign-in screen for a frame to an already-signed-in user. `loading`
// dominates — it is checked FIRST — so that flash is unrepresentable.
export type RootView = 'loading' | 'signIn' | 'app';

export interface SessionGateState {
  // True until the initial getSession() has settled. Nothing is known yet.
  readonly loading: boolean;
  readonly hasSession: boolean;
}

export function chooseRootView({ loading, hasSession }: SessionGateState): RootView {
  if (loading) return 'loading';
  if (!hasSession) return 'signIn';
  return 'app';
}
