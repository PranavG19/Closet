// withAuth — the identity + tenant-context seam every user-JWT Edge Function is
// wrapped in. It (1) verifies the caller's JWT against the asymmetric JWKS (no
// shared secret — the private key never leaves the auth provider), (2) derives the
// tenant `userId` SOLELY from the verified `sub` claim (never from the request
// body — that is the whole point), and (3) builds a per-request QueryExecutor that
// runs every statement as the least-privilege `app_user` role with
// `request.jwt.claim.sub` set to that verified sub, so RLS confines every row to
// the caller. A handler receives only `{ userId, exec, correlationId }` and can
// physically not act as another tenant: it has no pool, no role, no way to set the
// claim, and no body-sourced identity.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';
import { Uuid, parseBoundary } from '@closet/shared';
import type { QueryExecutor } from '@closet/db';
import { requireEnv } from './env.js';
import { logger } from './logger.js';
import { makePgExecutor, type Sql } from './executor.js';

export interface AuthContext {
  // The verified JWT sub, parsed as a uuid. The ONLY source of tenant identity.
  readonly userId: string;
  // Per-request executor already carrying (app_user role + this sub) tenant context.
  readonly exec: QueryExecutor;
  // Opaque id threaded through structured logs for one request.
  readonly correlationId: string;
  // The caller's own VERIFIED bearer token, carried so a handler can act as the
  // caller against Supabase Storage's HTTP API — where authority comes from the JWT
  // and `auth.uid()` is what the Storage RLS policies bind (migration 0013). The
  // alternative was a service_role key, which BYPASSES those policies and would let
  // a path-composition bug write into another tenant's prefix; carrying the user's
  // token keeps the write fail-closed under the real control. It is NOT an identity
  // source — tenant identity is `userId` (the verified sub) and nothing else. Never
  // log it and never forward it anywhere but Supabase.
  readonly accessToken: string;
}

export type AuthedHandler = (req: Request, ctx: AuthContext) => Promise<Response>;

// Verify a bearer token and return its subject. A verifier is injected so a test
// can supply a local keypair-backed JWKS; production builds one from JWKS_URL.
export interface TokenVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

export interface WithAuthDeps {
  readonly verifier: TokenVerifier;
  // Builds the per-request executor for a verified sub.
  readonly makeExecutor: (userId: string) => QueryExecutor;
  readonly newCorrelationId: () => string;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

// Production verifier: asymmetric JWKS, cached and rotated by jose.
//
// The signature is NOT sufficient on its own. The JWKS is per-PROJECT, so every token
// type the project signs — including one minted for a different audience or service —
// validates against the same keys; and jose only checks `exp` if the claim is PRESENT,
// so a token with no `exp` at all verifies forever and a stolen one never goes stale
// (which would also defeat the spend limiter, whose threat model is exactly "an
// entitled user with a stolen token", rate-limit.ts). This verifier used to pass NO
// options and accepted all three. So the claim set is REQUIRED, not optional:
// issuer + audience pin the token to our own auth server and our own audience, and
// `requiredClaims: ['exp']` makes a token without an expiry unrepresentable rather
// than eternal. requireEnv on both so a deploy that forgot them fails loudly at
// startup instead of degrading back to accept-anything.
export function makeJwksVerifier(): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(requireEnv('JWKS_URL')));
  const claims: JWTVerifyOptions = {
    issuer: requireEnv('JWT_ISSUER'),
    audience: requireEnv('JWT_AUDIENCE'),
    requiredClaims: ['exp'],
  };
  return {
    async verify(token: string): Promise<{ sub: string }> {
      const { payload } = await jwtVerify(token, jwks, claims);
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new Error('token has no sub');
      }
      return { sub };
    },
  };
}

function newRandomId(): string {
  return (globalThis as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}

// Production defaults, resolved lazily so a test that injects deps never touches
// env or opens a pool. `sql` is the thin pg-Pool binding (executor.ts).
export function defaultDeps(sql: Sql): WithAuthDeps {
  return {
    verifier: makeJwksVerifier(),
    makeExecutor: (userId: string) => makePgExecutor(sql, userId),
    newCorrelationId: newRandomId,
  };
}

// Wrap an AuthedHandler into a plain (Request) -> Response fetch handler. Rejects
// with 401 before the handler runs if the token is missing or fails verification;
// the handler never sees an unauthenticated request. A parsed-but-non-uuid sub is
// a 401 (a well-formed token whose subject is not a tenant id is not a valid
// caller), not a 500.
export function withAuth(handler: AuthedHandler, deps: WithAuthDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const correlationId = deps.newCorrelationId();
    const token = bearerToken(req);
    if (!token) {
      return unauthorized();
    }
    let userId: string;
    try {
      const { sub } = await deps.verifier.verify(token);
      userId = parseBoundary(Uuid, sub, 'jwt.sub');
    } catch (thrown) {
      // Fail closed, but not silently. A JWKS outage or a key rotation throws here on
      // EVERY request to all 11 authed routes — indistinguishable from ordinary expired
      // tokens if the only signal is the 401 rate, so the app is entirely down while
      // looking like normal traffic. The error's NAME separates the operator page
      // (JWKSNoMatchingKey / JWKSTimeout / a fetch failure) from routine rejection
      // (JWTExpired / JWSSignatureVerificationFailed). The name only — never the
      // message, which can carry the token or the claim values (PII rule).
      logger.warn({
        correlationId,
        event: 'auth.verify_failed',
        reason: thrown instanceof Error ? thrown.name : 'unknown',
      });
      return unauthorized();
    }
    const exec = deps.makeExecutor(userId);
    // `token` is the same string that just passed verification above.
    return handler(req, { userId, exec, correlationId, accessToken: token });
  };
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required.' } }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
