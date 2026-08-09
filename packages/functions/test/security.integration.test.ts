// Tier-2 ADVERSARIAL SECURITY gauntlet (docs/05 Tier-2), driven through the REAL
// Edge handlers + the REAL withAuth against a real Postgres with RLS FORCE. The
// attacker is a FULLY VALID authenticated tenant A that simply NAMES rows it does
// not own (nothing forged), except the authz-fuzzing block, which mints genuinely
// bad tokens (forged key / expired / wrong-issuer / alg:none / missing) and drives
// them through the SAME withAuth + a real jose verifier that rejects like prod.
//
// THE RESPONSE IS NEVER THE ORACLE. Every assertion ends in a fresh independent
// SELECT: the victim tenant under RLS (its own app_user executor must see 0), or a
// superuser cross-owner join (child.user_id <> parent.user_id counts 0), or a
// superuser count that a self-grant / injected row never landed. Bad-token cases
// assert an independent row count is unchanged, not merely a 401 status.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyOptions,
} from 'jose';
import type { AIVisionPort, AIVisionResult, CutoutPort, CutoutResult } from '@closet/shared';
import { withAuth, type AuthedHandler, type TokenVerifier } from '../src/auth/withAuth.js';
import { makePgExecutor, type Sql } from '../src/auth/executor.js';
import { createOutfit } from '../src/outfits/create.js';
import { logWear } from '../src/wear-log/log-wear.js';
import { upsertPalette } from '../src/palette/upsert-palette.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
// Passed EXPLICITLY at every makeParsePhoto call below. These suites measure claim /
// cap / entitlement behaviour, not rate behaviour, so a 429 here would mask what they
// assert — but 'unthrottled' is now a visible choice rather than a silent default.
import { unthrottledSpendLimiter } from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeCaller,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type Caller,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

// v4-conformant UUIDs — withAuth parses the JWT sub through the strict Zod Uuid.
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXPECTED_ISS = 'https://auth.closet.test/';

// ---- deterministic fake parse providers with an observable call counter --------
const FAKE_VISION: AIVisionResult = {
  category: 'top',
  primaryColor: '#aabbcc',
  secondaryColors: ['#112233'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'all-season',
};
const FAKE_CUTOUT: CutoutResult = { imageUrl: 'cutouts/fake.png', hasAlpha: true, width: 800, height: 1200 };

function makeCountingPorts(): ParsePorts & { visionCalls(): number } {
  let vision = 0;
  const visionPort: AIVisionPort = {
    async extractAttributes() {
      vision += 1;
      return FAKE_VISION;
    },
  };
  const cutoutPort: CutoutPort = {
    async removeBackground() {
      return FAKE_CUTOUT;
    },
  };
  return {
    vision: visionPort,
    cutout: cutoutPort,
    // The vendors receive a minted signed URL; the storage key is derived server-side
    // from the verified sub and is never handed to a vendor raw.
    mintSourcePhotoUrl: async (objectKey) => `https://storage.test/signed/${objectKey}?token=sig`,
    visionCalls: () => vision,
  };
}

// Adapt a pg Pool to the driver-free Sql seam makePgExecutor consumes (prod path).
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

// A verifier over a LOCAL JWKS enforcing signature + exp + expected issuer —
// exactly the production makeJwksVerifier contract (issuer is its optional check).
function jwksVerifier(trusted: JWK): TokenVerifier {
  const jwks = createLocalJWKSet({ keys: [trusted] });
  const opts: JWTVerifyOptions = { issuer: EXPECTED_ISS };
  return {
    async verify(token: string): Promise<{ sub: string }> {
      const { payload } = await jwtVerify(token, jwks, opts);
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) throw new Error('no sub');
      return { sub };
    },
  };
}

interface Keys {
  privateKey: CryptoKey;
  jwks: JWK;
}

async function makeKeypair(): Promise<Keys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwks = await exportJWK(publicKey);
  jwks.alg = 'ES256';
  return { privateKey, jwks };
}

async function mintToken(
  privateKey: CryptoKey,
  sub: string,
  opts?: { iss?: string; expEpochSeconds?: number },
): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuedAt();
  jwt.setIssuer(opts?.iss ?? EXPECTED_ISS);
  if (opts?.expEpochSeconds !== undefined) jwt.setExpirationTime(opts.expEpochSeconds);
  else jwt.setExpirationTime('1h');
  return jwt.sign(privateKey);
}

// An UNSIGNED alg:none token, hand-assembled — the classic downgrade attack. A
// JWKS-backed verifier must refuse it (no signature to check against the key).
function algNoneToken(sub: string): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  const payload = b64({ sub, iss: EXPECTED_ISS });
  return `${header}.${payload}.`;
}

async function seedItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
    [userId],
  );
  return rows[0]!.id;
}

describe('Tier-2 security gauntlet — cross-tenant, injected identity, money, authz, never-uploads', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // ================================================================= 1. Cross-tenant WRITE
  // A (valid token) names B's parent ids in a child-table write. Composite FKs make
  // it unrepresentable → the handler surfaces 400; a fresh SELECT as B shows nothing
  // new; the superuser cross-owner join stays 0.

  it('cross-tenant WRITE (outfit_items) — A naming B item_id → 400, B unchanged, cross-owner join = 0', async () => {
    const bItem = await seedItem(execB, USER_B);
    const bMembersBefore = await execB.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE item_id = $1`,
      [bItem],
    );

    const res = await callerA.call(createOutfit, { body: { name: 'steal', items: [{ item_id: bItem }] } });
    expect(res.status).toBe(400);

    // Independent SELECT as the victim B: no member row now references its item.
    const bMembersAfter = await execB.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE item_id = $1`,
      [bItem],
    );
    expect(bMembersAfter.rows[0]?.n).toBe(bMembersBefore.rows[0]?.n);
    // No orphan outfit landed for A either (the whole atomic statement rolled back).
    const aOutfits = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1 AND name = 'steal'`,
      [USER_A],
    );
    expect(aOutfits.rows[0]?.n).toBe('0');
    // Superuser cross-owner join: no outfit_items row references a wardrobe item of
    // a different tenant.
    const crossJoin = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.outfit_items oi JOIN public.wardrobe_items w ON oi.item_id = w.id
       WHERE oi.user_id <> w.user_id`,
    );
    expect(crossJoin.rows[0]?.n).toBe('0');
  });

  it('cross-tenant WRITE (wear_log) — A naming B item_id → 400, B wear history unchanged, cross-owner join = 0', async () => {
    const bItem = await seedItem(execB, USER_B);
    const res = await callerA.call(logWear, { body: { item_id: bItem, client_id: 'A-steals-B' } });
    expect(res.status).toBe(400);

    // Independent SELECT as B: no wear row exists for that client_id / that item.
    const bWear = await execB.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE item_id = $1`,
      [bItem],
    );
    expect(bWear.rows[0]?.n).toBe('0');
    const anyClient = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE client_id = 'A-steals-B'`,
    );
    expect(anyClient.rows[0]?.n).toBe('0');
    const crossJoin = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.wear_log wl JOIN public.wardrobe_items w ON wl.item_id = w.id
       WHERE wl.user_id <> w.user_id`,
    );
    expect(crossJoin.rows[0]?.n).toBe('0');
  });

  // ================================================================= 2. Server-injected identity
  // A user_id:B smuggled into a mutation body is inert: request schemas are .strict()
  // so the unknown key is a 400; and identity comes ONLY from the JWT sub, so a clean
  // create writes a row owned by A. Proven per handler, ending in a superuser owner check.

  it('injected identity — user_id:B in create-outfit / wear-log / palette bodies is inert (400), zero B rows', async () => {
    const aItem = await seedItem(execA, USER_A);
    const smuggleOutfit = await callerA.call(createOutfit, {
      body: { name: 'x', items: [{ item_id: aItem }], user_id: USER_B },
    });
    expect(smuggleOutfit.status).toBe(400);

    const smuggleWear = await callerA.call(logWear, {
      body: { item_id: aItem, client_id: 'smuggle-w', user_id: USER_B },
    });
    expect(smuggleWear.status).toBe(400);

    const smugglePalette = await callerA.call(upsertPalette, { body: { hues: { warm: true }, user_id: USER_B } });
    expect(smugglePalette.status).toBe(400);

    // Independent SELECT: NOTHING owned by B was created by any smuggle attempt.
    for (const table of ['outfits', 'wear_log', 'palette_profile']) {
      const bRows = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
        [USER_B],
      );
      expect(bRows.rows[0]?.n).toBe('0');
    }
  });

  it('injected identity — a CLEAN create writes a row owned by the JWT sub (A), never the body', async () => {
    const aItem = await seedItem(execA, USER_A);
    const res = await callerA.call(createOutfit, { body: { name: 'mine', items: [{ item_id: aItem }] } });
    expect(res.status).toBe(200);
    const outfitId = ((await res.json()) as { outfit: { id: string } }).outfit.id;
    // Superuser owner check: the created outfit + its member are owned by A.
    const owner = await superuser.query<{ user_id: string }>(
      `SELECT user_id FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(owner.rows[0]?.user_id).toBe(USER_A);
    const memberOwner = await superuser.query<{ user_id: string }>(
      `SELECT user_id FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberOwner.rows.every((r) => r.user_id === USER_A)).toBe(true);
  });

  // ================================================================= 3. Money-table penetration
  // Granting yourself premium is UNREPRESENTABLE: app_user has no INSERT/UPDATE policy
  // or grant on subscriptions → 42501. webhook_events is opaque (no policy/grant) →
  // app_user can neither read nor write it. Every probe ends in an independent SELECT.

  it('money penetration — app_user INSERT/UPDATE on subscriptions is refused (42501), entitlement unchanged', async () => {
    // A false-entitlement row seeded by the sole legitimate writer (service_role ==
    // superuser here). A must never be able to flip it true.
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, entitlement_active) VALUES ($1,false)
       ON CONFLICT (user_id) DO UPDATE SET entitlement_active = false`,
      [USER_A],
    );

    // Self-INSERT of a premium row (a user with no existing row).
    await expect(
      execB.query(`INSERT INTO public.subscriptions (user_id, entitlement_active) VALUES ($1,true)`, [USER_B]),
    ).rejects.toMatchObject({ code: '42501' });

    // Self-UPDATE flipping the existing row to premium.
    await expect(
      execA.query(`UPDATE public.subscriptions SET entitlement_active = true WHERE user_id = $1`, [USER_A]),
    ).rejects.toMatchObject({ code: '42501' });

    // Independent SELECT (superuser): A is still NOT entitled, B has no row.
    const aRow = await superuser.query<{ entitlement_active: boolean }>(
      `SELECT entitlement_active FROM public.subscriptions WHERE user_id = $1`,
      [USER_A],
    );
    expect(aRow.rows[0]?.entitlement_active).toBe(false);
    const bRow = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscriptions WHERE user_id = $1`,
      [USER_B],
    );
    expect(bRow.rows[0]?.n).toBe('0');
  });

  it('money penetration — app_user cannot READ or WRITE webhook_events (the ordering ledger)', async () => {
    await superuser.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt-sec-seed') ON CONFLICT DO NOTHING`);
    await expect(execA.query(`SELECT event_id FROM public.webhook_events`)).rejects.toMatchObject({ code: '42501' });
    await expect(
      execA.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt-sec-hack')`),
    ).rejects.toMatchObject({ code: '42501' });
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = 'evt-sec-hack'`,
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  // ================================================================= 4. Authz fuzzing
  // Malformed / expired / wrong-issuer / alg:none / missing tokens through the REAL
  // withAuth + a real jose verifier must 401 and write ZERO rows. The oracle is an
  // independent superuser count of A's outfits, not "the factory was never called".

  it('authz fuzzing — bad tokens all 401 and write ZERO rows (independent count unchanged)', async () => {
    const trusted = await makeKeypair();
    const forged = await makeKeypair();
    const sql = poolAsSql(pool);
    const deps = {
      verifier: jwksVerifier(trusted.jwks),
      makeExecutor: (userId: string) => makePgExecutor(sql, userId),
      newCorrelationId: () => 'sec-fuzz',
    };
    // A handler that WOULD write if it ever ran — so "zero rows" is a real oracle.
    const writingHandler: AuthedHandler = async (_req, { userId, exec }) => {
      await exec.query(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'authz-fuzz-should-never-exist')`, [
        userId,
      ]);
      return new Response('{}', { status: 200 });
    };
    const wrapped = withAuth(writingHandler, deps);
    const req = (auth: string | null): Request =>
      new Request('https://test.local/fn', {
        method: 'POST',
        headers: auth === null ? {} : { authorization: auth },
      });

    const forgedTok = await mintToken(forged.privateKey, USER_A); // valid shape, untrusted key
    const expiredTok = await mintToken(trusted.privateKey, USER_A, { expEpochSeconds: 1 }); // 1970
    const wrongIssTok = await mintToken(trusted.privateKey, USER_A, { iss: 'https://evil.example/' });
    const noneTok = algNoneToken(USER_A);

    const attempts: { label: string; header: string | null }[] = [
      { label: 'missing bearer', header: null },
      { label: 'malformed (not-a-jwt)', header: 'Bearer not-a-jwt' },
      { label: 'wrong scheme', header: 'Basic abc' },
      { label: 'forged key', header: `Bearer ${forgedTok}` },
      { label: 'expired', header: `Bearer ${expiredTok}` },
      { label: 'wrong issuer', header: `Bearer ${wrongIssTok}` },
      { label: 'alg:none', header: `Bearer ${noneTok}` },
    ];

    const before = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE name = 'authz-fuzz-should-never-exist'`,
    );
    for (const a of attempts) {
      const res = await wrapped(req(a.header));
      expect(res.status, a.label).toBe(401);
    }
    // Independent oracle: not one write survived any of the 7 bad tokens.
    const after = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE name = 'authz-fuzz-should-never-exist'`,
    );
    expect(after.rows[0]?.n).toBe('0');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('boundary fuzzing — malformed bodies through a valid token → 400, zero rows', async () => {
    const badBodies: unknown[] = [
      { items: 'nope' }, // items not an array
      { name: 123, items: [] }, // name wrong type
      { items: [{ item_id: 'not-a-uuid' }] }, // member id not a uuid
      { id: 'not-a-uuid', items: [] }, // outfit id not a uuid
    ];
    const before = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`,
      [USER_A],
    );
    for (const body of badBodies) {
      const res = await callerA.call(createOutfit, { body });
      expect(res.status).toBe(400);
    }
    const after = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`,
      [USER_A],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  // ================================================================= 5. Never-uploads seam
  // Backend assertion of the privacy invariant (docs/05 Tier-2): an unapproved photo
  // has NO representable server entry. parse-photo REQUIRES source_photo_hash
  // (CreateParseJobRequest is .strict()); a request lacking the hash is a 400 boundary
  // reject — no job row, no provider call. There is no handler that accepts a raw
  // camera-roll photo without a prior hash.
  //
  // `source_photo_path` is NOT a request field at all: the storage path is derived from
  // the verified sub, because parse-photo hands the original to GPT-4o / Photoroom as a
  // URL THEIR servers fetch — outside migration 0013's Storage RLS. A caller-named path
  // would be a cross-tenant photo read and an SSRF sink, so sending it is now itself a
  // .strict() rejection (asserted below and, end-to-end with the provider-count oracle,
  // in parse-photo.integration.test.ts).

  it('never-uploads seam — parse-photo without source_photo_hash → 400, no job row, provider never called', async () => {
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports, unthrottledSpendLimiter);
    const caller = makeCaller(pool, USER_A);

    // Missing source_photo_hash entirely.
    const noHash = await caller.call(handler, { body: { kind: 'teaser' } });
    expect(noHash.status).toBe(400);

    // Present but wrong-typed hash — still a boundary reject (parse-don't-cast).
    const badHash = await caller.call(handler, {
      body: { source_photo_hash: 123, kind: 'teaser' },
    });
    expect(badHash.status).toBe(400);

    // Extra raw-photo-ish key rejected by .strict() — no smuggling a camera-roll blob.
    const extraKey = await caller.call(handler, {
      body: { source_photo_hash: 'H', kind: 'teaser', raw_photo: 'BASE64BLOB' },
    });
    expect(extraKey.status).toBe(400);

    // A caller-named storage path is rejected too — it is not a field the client may
    // set, so naming another tenant's prefix is unrepresentable rather than filtered.
    const namedPath = await caller.call(handler, {
      body: { source_photo_hash: 'H2', kind: 'teaser', source_photo_path: `${USER_B}/job/photo.jpg` },
    });
    expect(namedPath.status).toBe(400);

    // Independent oracle: no parse job landed for A from any of these, and the paid
    // provider was never invoked (no unapproved photo ever reaches processing).
    const jobs = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1`,
      [USER_A],
    );
    expect(jobs.rows[0]?.n).toBe('0');
    expect(ports.visionCalls()).toBe(0);
  });
});
