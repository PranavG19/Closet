// Oracle for the PRODUCTION token verifier — makeJwksVerifier itself, not a
// hand-rolled stand-in.
//
// WHY THIS FILE EXISTS. Both existing JWKS suites build their own jose verifier and
// assert against THAT (auth.integration.test.ts:73, security.integration.test.ts:106).
// A test verifier is trivially stronger than the shipped one, and it was: production
// called `jwtVerify(token, jwks)` with no options, so a token minted for another
// issuer/audience by any key in the project JWKS was accepted, and a token with NO
// `exp` claim verified forever. Neither suite could see it — one never varies the
// issuer, the other passed `{ issuer }` to its own verifier and called that "exactly
// the production contract".
//
// So this drives the REAL makeJwksVerifier: a throwaway loopback HTTP server serves a
// local ES256 JWKS, JWKS_URL points at it, and createRemoteJWKSet does its real fetch.
// The only thing not exercised is Supabase's key rotation. A verifier weaker than these
// assertions cannot pass, which is the property the other two suites lacked.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { makeJwksVerifier } from './withAuth.js';

const SUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISSUER = 'https://auth.closet.test/';
const AUDIENCE = 'authenticated';

let trustedKey: CryptoKey;
let untrustedKey: CryptoKey;
let server: Server;

// Env is process-global and makeJwksVerifier reads it at construction, so each case
// sets what it needs and restores it. Only these three keys are touched.
function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Mint a token, defaulting every claim to the accepted shape so a case only states
// the ONE thing it varies. `exp: null` omits the claim entirely (the permanent
// credential); `undefined` means "use the default 1h".
async function mint(
  key: CryptoKey,
  claims?: { sub?: string; iss?: string; aud?: string; exp?: string | number | null },
): Promise<string> {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(claims?.sub ?? SUB)
    .setIssuer(claims?.iss ?? ISSUER)
    .setAudience(claims?.aud ?? AUDIENCE)
    .setIssuedAt();
  const exp = claims?.exp === undefined ? '1h' : claims.exp;
  if (exp !== null) jwt.setExpirationTime(exp);
  return jwt.sign(key);
}

describe('makeJwksVerifier — the production verifier against a real JWKS fetch', () => {
  beforeAll(async () => {
    const trusted = await generateKeyPair('ES256', { extractable: true });
    const untrusted = await generateKeyPair('ES256', { extractable: true });
    trustedKey = trusted.privateKey;
    untrustedKey = untrusted.privateKey;

    const jwk: JWK = await exportJWK(trusted.publicKey);
    jwk.alg = 'ES256';
    jwk.kid = 'test-key';
    const body = JSON.stringify({ keys: [jwk] });

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    setEnv({
      JWKS_URL: `http://127.0.0.1:${port}/jwks`,
      JWT_ISSUER: ISSUER,
      JWT_AUDIENCE: AUDIENCE,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setEnv({ JWKS_URL: undefined, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined });
  });

  it('accepts a well-formed token from the trusted key and returns its sub', async () => {
    const verifier = makeJwksVerifier();
    await expect(verifier.verify(await mint(trustedKey))).resolves.toEqual({ sub: SUB });
  });

  it('rejects a token signed by a key that is NOT in the JWKS', async () => {
    const verifier = makeJwksVerifier();
    await expect(verifier.verify(await mint(untrustedKey))).rejects.toBeTruthy();
  });

  it('rejects an expired token', async () => {
    const verifier = makeJwksVerifier();
    await expect(verifier.verify(await mint(trustedKey, { exp: 1 }))).rejects.toBeTruthy();
  });

  // The permanent credential. A token with no `exp` has no expiry check to fail, so
  // a stolen one never goes stale — which also defeats the spend limiter, whose stated
  // threat model is "an entitled user with a stolen token" (rate-limit.ts:3).
  it('rejects a token with NO exp claim — a token that never expires is not a session', async () => {
    const verifier = makeJwksVerifier();
    await expect(verifier.verify(await mint(trustedKey, { exp: null }))).rejects.toBeTruthy();
  });

  // The JWKS is per-PROJECT, not per-audience: any other token type signed by the same
  // key set (a token minted for a different service, a differently-audienced one)
  // would otherwise be accepted here as a user session on the strength of its sub.
  it('rejects a token from another issuer even though the signing key is trusted', async () => {
    const verifier = makeJwksVerifier();
    await expect(
      verifier.verify(await mint(trustedKey, { iss: 'https://attacker.example/' })),
    ).rejects.toBeTruthy();
  });

  it('rejects a token minted for another audience', async () => {
    const verifier = makeJwksVerifier();
    await expect(
      verifier.verify(await mint(trustedKey, { aud: 'some-other-service' })),
    ).rejects.toBeTruthy();
  });

  it('rejects a token whose sub is absent', async () => {
    const verifier = makeJwksVerifier();
    const noSub = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(trustedKey);
    await expect(verifier.verify(noSub)).rejects.toBeTruthy();
  });

  // The issuer/audience are what make the checks above real, so a deploy that forgot
  // them must fail at startup rather than silently degrade to accept-anything — the
  // exact state this file was written to close.
  it('throws at construction when JWT_ISSUER or JWT_AUDIENCE is missing', () => {
    const issuer = process.env['JWT_ISSUER'];
    const audience = process.env['JWT_AUDIENCE'];
    try {
      setEnv({ JWT_ISSUER: undefined });
      expect(() => makeJwksVerifier()).toThrow(/missing required env: JWT_ISSUER/);
      setEnv({ JWT_ISSUER: issuer, JWT_AUDIENCE: undefined });
      expect(() => makeJwksVerifier()).toThrow(/missing required env: JWT_AUDIENCE/);
    } finally {
      setEnv({ JWT_ISSUER: issuer, JWT_AUDIENCE: audience });
    }
  });
});
