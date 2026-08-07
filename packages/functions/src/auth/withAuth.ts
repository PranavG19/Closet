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
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Uuid, parseBoundary } from '@closet/shared';
import type { QueryExecutor } from '@closet/db';
import { requireEnv } from './env.js';
import { makePgExecutor, type Sql } from './executor.js';

export interface AuthContext {
  // The verified JWT sub, parsed as a uuid. The ONLY source of tenant identity.
  readonly userId: string;
  // Per-request executor already carrying (app_user role + this sub) tenant context.
  readonly exec: QueryExecutor;
  // Opaque id threaded through structured logs for one request.
  readonly correlationId: string;
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

// Production verifier: asymmetric JWKS, cached and rotated by jose. Requires
// JWKS_URL; the expected issuer/audience are optional additional checks.
export function makeJwksVerifier(): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(requireEnv('JWKS_URL')));
  return {
    async verify(token: string): Promise<{ sub: string }> {
      const { payload } = await jwtVerify(token, jwks);
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
    } catch {
      return unauthorized();
    }
    const exec = deps.makeExecutor(userId);
    return handler(req, { userId, exec, correlationId });
  };
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required.' } }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
