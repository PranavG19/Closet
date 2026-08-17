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

// Monotonic clock for durations. `performance.now()` (not Date.now) so a wall-clock
// adjustment mid-request can never yield a negative durationMs — the same choice
// parse-photo.ts made for its providerMs timing.
function nowMs(): number {
  return (globalThis as { performance: { now(): number } }).performance.now();
}

// The route label for a request log line, derived from the URL's LAST path segment.
// Supabase deploys one directory = one function = one URL, so the final segment IS the
// deployed function name (wardrobe-list, palette-read, …) — no per-shim route argument to
// thread through ~20 entrypoints. A URL with no usable segment falls back to 'unknown'
// rather than throwing (a log line must never break a request).
function routeLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const segment = path.slice(path.lastIndexOf('/') + 1);
    return segment.length > 0 ? segment : 'unknown';
  } catch {
    return 'unknown';
  }
}

// One structured request line per invocation, emitted from the wrapper every user-JWT
// handler passes through — so "a handler with no log" is unrepresentable rather than a
// thing to remember per handler. Level tracks the status class (5xx→error, 4xx→warn,
// else info). Fields are the fixed logger vocabulary (correlationId/event/route/status/
// durationMs) — never the body, never an error object, so no PII path exists.
function logRequest(correlationId: string, route: string, status: number, startedAt: number): void {
  const durationMs = Math.round(nowMs() - startedAt);
  const fields = { correlationId, event: 'request', route, status, durationMs };
  if (status >= 500) logger.error(fields);
  else if (status >= 400) logger.warn(fields);
  else logger.info(fields);
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
    const route = routeLabel(req.url);
    const startedAt = nowMs();
    // One exit point so EVERY response — 401, handler success, handler-returned 4xx/5xx,
    // and an unexpected throw — is timed, logged once, and carries the correlation id.
    const finish = (response: Response): Response => {
      logRequest(correlationId, route, response.status, startedAt);
      // Echo the correlation id so a mobile error log can be tied to this server line.
      response.headers.set('x-correlation-id', correlationId);
      return response;
    };

    const token = bearerToken(req);
    if (!token) {
      return finish(unauthorized());
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
      return finish(unauthorized());
    }
    const exec = deps.makeExecutor(userId);
    try {
      // `token` is the same string that just passed verification above.
      const response = await handler(req, { userId, exec, correlationId, accessToken: token });
      return finish(response);
    } catch {
      // A handler that throws instead of returning an error response would otherwise be an
      // invisible 500. Log it as a request_error line (fixed fields — the thrown value is
      // deliberately NOT bound or logged, so no PII path exists) and return the same safe
      // 500 shape respond.ts uses.
      logger.error({ correlationId, event: 'request_error', route, durationMs: Math.round(nowMs() - startedAt) });
      const response = internalError();
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }
  };
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required.' } }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function internalError(): Response {
  return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
