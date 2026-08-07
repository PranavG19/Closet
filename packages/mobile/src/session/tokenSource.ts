// The bridge from the auth port to the API client's TokenSource contract: EVERY
// request's bearer is the CURRENT session's access token, read at request time
// (never captured once at construction — a captured token would go stale after the
// autoRefreshToken timer rotates it, and every endpoint would start 401ing).
//
// Signed out => null, which the client turns into "no Authorization header" rather
// than a `Bearer null` that the Edge function would reject as malformed.
import type { AuthPort, TokenSource } from './AuthPort.js';

export function makeTokenSource(port: AuthPort): TokenSource {
  return async () => {
    const session = await port.getSession();
    return session?.accessToken ?? null;
  };
}
