// Independent oracle for task-09a (auth infra: withAuth JWKS verify + the per-request
// app_user executor + respond). docs/05 Tier-3 (real Postgres) + Tier-2 (authz).
//
// The oracle is DB state observed from a vantage the handler does not control — a
// fresh SELECT as a DIFFERENT tenant (0 rows) and a superuser count — never the
// handler's own response. Bad-token cases assert row-count 0, not just the 401.
//
// It exercises the REAL prod path: makePgExecutor over a pg Pool (the same seam the
// Deno shim injects) and jose jwtVerify against a local ES256 JWKS (real signature +
// exp checks; only the remote-fetch glue is swapped for a local key set). withAuth's
// injectable deps let the test supply the verifier + executor factory with no HTTP.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, jwtVerify, type JWK } from 'jose';
import { applyMigrations } from '../../db/test/helpers/applyMigrations.js';
import { makeTenantExecutor, makeSuperuserExecutor } from '../../db/test/helpers/executor.js';
import { startPg, type PgHarness } from '../../db/test/helpers/pgContainer.js';
import { withAuth, type AuthedHandler, type TokenVerifier, type WithAuthDeps } from '../src/auth/withAuth.js';
import { makePgExecutor, type Sql } from '../src/auth/executor.js';
import { jsonResponse } from '../src/auth/respond.js';

// Valid RFC-4122 v4 UUIDs (version nibble 4, variant nibble 8): the JWT `sub` is
// parsed through the strict Zod Uuid in withAuth, which enforces the version/variant
// bits — so the test identities must be conformant v4 (raw-SQL W1 tests could use
// non-conformant hex because Postgres' uuid type does not check those bits).
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Adapt a pg Pool to the driver-free Sql seam makePgExecutor consumes — the exact
// adapter the Deno shim provides in prod.
function poolAsSql(pool: Pool): Sql {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row = unknown>(sql: string, params?: readonly unknown[]) {
          const res = await client.query(sql, params ? [...params] : undefined);
          return { rows: res.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
  };
}

interface SignedKeys {
  privateKey: CryptoKey;
  jwks: JWK;
}

async function makeKeypair(): Promise<SignedKeys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwks = await exportJWK(publicKey);
  jwks.alg = 'ES256';
  return { privateKey, jwks };
}

async function mintToken(
  privateKey: CryptoKey,
  sub: string,
  opts?: { expEpochSeconds?: number },
): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuedAt();
  if (opts?.expEpochSeconds !== undefined) jwt.setExpirationTime(opts.expEpochSeconds);
  else jwt.setExpirationTime('1h');
  return jwt.sign(privateKey);
}

// A verifier over a LOCAL JWKS (the trusted key set). Mirrors makeJwksVerifier's
// contract: verify signature + exp, extract a non-empty string sub.
function localVerifier(trusted: JWK): TokenVerifier {
  const jwks = createLocalJWKSet({ keys: [trusted] });
  return {
    async verify(token: string): Promise<{ sub: string }> {
      const { payload } = await jwtVerify(token, jwks);
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) throw new Error('no sub');
      return { sub };
    },
  };
}

describe('task-09a auth infra — JWKS verify + per-request app_user executor', () => {
  let harness: PgHarness;
  let pool: Pool;
  let trusted: SignedKeys;
  let forged: SignedKeys;
  let deps: WithAuthDeps;
  let handlerInvocations: number;

  // A trivial authed handler: insert one wardrobe item as the caller, echo the
  // count of the caller's own items. It reads identity ONLY from ctx.userId. A
  // body user_id is deliberately ignored (criterion 5).
  const insertHandler: AuthedHandler = async (_req, { userId, exec }) => {
    handlerInvocations += 1;
    await exec.query(
      `INSERT INTO public.wardrobe_items (user_id, category, cutout_path) VALUES ($1,'top','p')`,
      [userId],
    );
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    return jsonResponse(200, { userId, ownCount: rows[0]?.n ?? '0' });
  };

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    trusted = await makeKeypair();
    forged = await makeKeypair();
    const sql = poolAsSql(pool);
    deps = {
      verifier: localVerifier(trusted.jwks),
      makeExecutor: (userId: string) => makePgExecutor(sql, userId),
      newCorrelationId: () => 'test-correlation-id',
    };
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function makeRequest(token: string | null, body?: unknown): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    return new Request('http://edge/wardrobe', {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('valid token → identity from sub, executor scoped as app_user (row isolated)', async () => {
    handlerInvocations = 0;
    const token = await mintToken(trusted.privateKey, USER_A);
    const res = await withAuth(insertHandler, deps)(makeRequest(token, {}));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { userId: string; ownCount: string };
    // Identity is the verified sub.
    expect(payload.userId).toBe(USER_A);
    expect(handlerInvocations).toBe(1);

    // Independent oracle: a DIFFERENT tenant sees 0 of A's rows (RLS scoped by the
    // executor's app_user role + sub — not the handler's word).
    const execB = makeTenantExecutor(pool, USER_B);
    const seenByB = await execB.query('SELECT id FROM public.wardrobe_items');
    expect(seenByB.rows.length).toBe(0);

    // A sees exactly its own row via an independent tenant executor.
    const execA = makeTenantExecutor(pool, USER_A);
    const seenByA = await execA.query('SELECT id FROM public.wardrobe_items');
    expect(seenByA.rows.length).toBe(1);
  });

  it('forged token (signed by a key NOT in the JWKS) → 401, handler never runs, 0 rows', async () => {
    handlerInvocations = 0;
    const superuser = makeSuperuserExecutor(pool);
    const before = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    const token = await mintToken(forged.privateKey, USER_B);
    const res = await withAuth(insertHandler, deps)(makeRequest(token, {}));
    expect(res.status).toBe(401);
    expect(handlerInvocations).toBe(0);
    // Row-count oracle: the forged request wrote nothing (response 401 is not the
    // sole oracle — the DB state confirms it).
    const after = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('expired token → 401', async () => {
    handlerInvocations = 0;
    const expired = await mintToken(trusted.privateKey, USER_A, { expEpochSeconds: 1 }); // 1970
    const res = await withAuth(insertHandler, deps)(makeRequest(expired, {}));
    expect(res.status).toBe(401);
    expect(handlerInvocations).toBe(0);
  });

  it('missing bearer → 401; malformed bearer → 401', async () => {
    handlerInvocations = 0;
    const noHeader = await withAuth(insertHandler, deps)(makeRequest(null, {}));
    expect(noHeader.status).toBe(401);
    const malformed = await withAuth(insertHandler, deps)(
      new Request('http://edge/wardrobe', {
        method: 'POST',
        headers: { authorization: 'Basic abc' },
      }),
    );
    expect(malformed.status).toBe(401);
    expect(handlerInvocations).toBe(0);
  });

  it('body-supplied identity is inert — handler uses the verified sub, not the body', async () => {
    handlerInvocations = 0;
    const token = await mintToken(trusted.privateKey, USER_A);
    // The body claims to be USER_B; the handler must use USER_A (the verified sub).
    const res = await withAuth(insertHandler, deps)(makeRequest(token, { user_id: USER_B }));
    const payload = (await res.json()) as { userId: string };
    expect(payload.userId).toBe(USER_A);
    // And no row landed under USER_B via this call: B's independent count is
    // unchanged (still 0 from B's own perspective).
    const execB = makeTenantExecutor(pool, USER_B);
    const seenByB = await execB.query('SELECT id FROM public.wardrobe_items');
    expect(seenByB.rows.length).toBe(0);
  });

  it('executor is transactional — a mid-statement error rolls back and releases the connection', async () => {
    const token = await mintToken(trusted.privateKey, USER_A);
    const sql = poolAsSql(pool);
    const exec = makePgExecutor(sql, USER_A);

    const superuser = makeSuperuserExecutor(pool);
    const before = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );

    // A statement that inserts a row and THEN errors (division by zero) in the same
    // statement. If the executor did not wrap it in BEGIN/ROLLBACK, the insert would
    // persist. It must NOT.
    await expect(
      exec.query(
        `WITH ins AS (
           INSERT INTO public.wardrobe_items (user_id, category, cutout_path)
           VALUES ($1,'top','rollback-probe') RETURNING id
         )
         SELECT 1 / (SELECT count(*)::int - 1 FROM ins) AS boom`,
        [USER_A],
      ),
    ).rejects.toThrow();

    const after = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items`,
    );
    // Rolled back: no partial row persisted.
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);

    // Connection released: many failing calls do not exhaust the pool — a
    // subsequent valid query still succeeds (a leaked connection would hang/deadlock).
    for (let i = 0; i < 15; i += 1) {
      await exec.query(`SELECT 1 / 0 AS boom`).catch(() => undefined);
    }
    const stillWorks = await withAuth(insertHandler, deps)(makeRequest(token, {}));
    expect(stillWorks.status).toBe(200);
  });
});
