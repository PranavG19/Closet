// Independent oracle for the parse-photo provider-spend throttle. Same shape as
// parse-photo.integration.test.ts: a real Postgres with the FULL migration chain
// drives the REAL parsePhoto handler through real per-request app_user executors
// (RLS enforced). The HTTP status is NOT the oracle — the money claim is asserted on
// an OBSERVABLE provider call counter (must be 0 on a throttled request) and every
// row claim is an INDEPENDENT superuser SELECT, never the handler's response body.
//
// The limiter itself is injected as an in-memory fake with the SAME
// SpendLimiter/ProvideSpendLimiter seam the DB-backed repo will satisfy. What this
// file proves is the HANDLER's contract — ordering (nothing paid, no cap consumed,
// no stranded row before the guard), the 429 envelope, sub-only keying, and that the
// budget is per-user. The atomicity of the counting itself is the sibling DB task's
// oracle, not this one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { AIVisionPort, AIVisionResult, CutoutPort, CutoutResult } from '@closet/shared';
import { withAuth, type AuthedHandler } from '../src/auth/withAuth.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import {
  DEFAULT_PARSE_RATE_LIMIT,
  DEFAULT_PARSE_RATE_WINDOW_SECONDS,
  PARSE_RATE_LIMIT_ENV,
  PARSE_RATE_WINDOW_ENV,
  PARSE_SPEND_BUCKET,
  parseRateLimitConfig,
  type ConsumeSpendTokenInput,
  type ProvideSpendLimiter,
  type RateLimitDecision,
} from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER_A = 'aa000000-0000-4000-8000-000000000001';
const USER_B = 'bb000000-0000-4000-8000-000000000002';

const FAKE_VISION: AIVisionResult = {
  category: 'top',
  primaryColor: '#aabbcc',
  secondaryColors: ['#112233'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'all-season',
};
const FAKE_CUTOUT: CutoutResult = {
  imageUrl: 'cutouts/fake.png',
  hasAlpha: true,
  width: 800,
  height: 1200,
};

// The MONEY instrument: every paid call increments a counter the test can read.
interface CountingPorts extends ParsePorts {
  visionCalls(): number;
  cutoutCalls(): number;
}

function makeCountingPorts(): CountingPorts {
  let vision = 0;
  let cutout = 0;
  const visionPort: AIVisionPort = {
    async extractAttributes() {
      vision += 1;
      return FAKE_VISION;
    },
  };
  const cutoutPort: CutoutPort = {
    async removeBackground() {
      cutout += 1;
      return FAKE_CUTOUT;
    },
  };
  return {
    vision: visionPort,
    cutout: cutoutPort,
    // The handler mints a signed URL for the SERVER-DERIVED object key and hands the
    // vendors that, never a raw key. Unmetered here: this file's oracle is the throttle,
    // and the minter's own prefix guard is proven in supabase-storage.reader.test.ts.
    async mintSourcePhotoUrl() {
      return 'https://signed.example/original';
    },
    visionCalls: () => vision,
    cutoutCalls: () => cutout,
  };
}

// In-memory limiter over the real seam. It records the inputs the handler passed so
// the "keyed on the verified sub, never a body field" claim is asserted on the
// ACTUAL argument, not inferred from behaviour.
interface FakeLimiter {
  readonly provide: ProvideSpendLimiter;
  readonly calls: ConsumeSpendTokenInput[];
  spent(userId: string): number;
}

function makeFakeLimiter(): FakeLimiter {
  const spend = new Map<string, number>();
  const calls: ConsumeSpendTokenInput[] = [];
  const provide: ProvideSpendLimiter = () => ({
    async consume(input): Promise<RateLimitDecision> {
      calls.push(input);
      const key = `${input.userId}:${input.bucket}`;
      const used = spend.get(key) ?? 0;
      if (used >= input.limit) {
        return { allowed: false, retryAfterSeconds: input.windowSeconds };
      }
      spend.set(key, used + 1);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });
  return { provide, calls, spent: (userId) => spend.get(`${userId}:${PARSE_SPEND_BUCKET}`) ?? 0 };
}

function callAs(handler: AuthedHandler, pool: Pool, sub: string, body: unknown): Promise<Response> {
  const wrapped = withAuth(handler, {
    verifier: { verify: async (token: string) => ({ sub: token }) },
    makeExecutor: (verifiedUser: string) => makeTenantExecutor(pool, verifiedUser),
    newCorrelationId: () => 'test-correlation',
  });
  return wrapped(
    new Request('https://test.local/parse-photo', {
      method: 'POST',
      headers: { authorization: `Bearer ${sub}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function superuserJobCount(superuser: QueryExecutor, userId: string): Promise<number> {
  const { rows } = await superuser.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.n ?? '0');
}

async function superuserTeaserCount(superuser: QueryExecutor, userId: string): Promise<number> {
  const { rows } = await superuser.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1 AND kind = 'teaser'`,
    [userId],
  );
  return Number(rows[0]?.n ?? '0');
}

async function superuserStatusCounts(
  superuser: QueryExecutor,
  userId: string,
): Promise<Record<string, number>> {
  const { rows } = await superuser.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1 GROUP BY status`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

// The request carries NO source_photo_path: the server derives the storage key from
// the verified sub, so a client cannot name one (CreateParseJobRequest is .strict()).
const teaser = (hash: string): Record<string, string> => ({
  source_photo_hash: hash,
  kind: 'teaser',
});

// ---- Config: fail CLOSED to the default (no env can disable the limiter) -------
describe('parse rate-limit config — a missing or garbage env NEVER disables the limiter', () => {
  const DEFAULTS = { limit: DEFAULT_PARSE_RATE_LIMIT, windowSeconds: DEFAULT_PARSE_RATE_WINDOW_SECONDS };

  it('unset env → the enforced defaults', () => {
    expect(parseRateLimitConfig(() => undefined)).toEqual(DEFAULTS);
  });

  it('a valid positive integer overrides', () => {
    const readEnv = (key: string): string | undefined =>
      key === PARSE_RATE_LIMIT_ENV ? '3' : key === PARSE_RATE_WINDOW_ENV ? '30' : undefined;
    expect(parseRateLimitConfig(readEnv)).toEqual({ limit: 3, windowSeconds: 30 });
  });

  it.each(['', '   ', '0', '-1', 'off', 'unlimited', 'Infinity', 'NaN', '12.5', '1e999'])(
    'a disabling/garbage value %j falls back to the default, never to unlimited',
    (raw) => {
      expect(parseRateLimitConfig(() => raw)).toEqual(DEFAULTS);
    },
  );
});

describe('parse-photo provider-spend throttle — money oracle', () => {
  let harness: PgHarness;
  let pool: Pool;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // (a) N+1st request in a window is refused, and (b) it costs ZERO provider calls.
  it('the N+1st request in a window → 429 with a retry hint, and the paid provider is called ZERO extra times', async () => {
    const LIMIT = 3;
    const WINDOW = 300;
    const ports = makeCountingPorts();
    const limiter = makeFakeLimiter();
    const readEnv = (key: string): string | undefined =>
      key === PARSE_RATE_LIMIT_ENV ? String(LIMIT) : key === PARSE_RATE_WINDOW_ENV ? String(WINDOW) : undefined;
    process.env[PARSE_RATE_LIMIT_ENV] = String(LIMIT);
    process.env[PARSE_RATE_WINDOW_ENV] = String(WINDOW);
    expect(parseRateLimitConfig(readEnv)).toEqual({ limit: LIMIT, windowSeconds: WINDOW });

    const handler = makeParsePhoto(() => ports, limiter.provide);

    for (let i = 0; i < LIMIT; i += 1) {
      const ok = await callAs(handler, pool, USER_A, teaser(`OK-${i}`));
      expect(ok.status).toBe(200);
    }
    // N distinct photos each legitimately hit the provider exactly once.
    expect(ports.visionCalls()).toBe(LIMIT);
    expect(ports.cutoutCalls()).toBe(LIMIT);
    const callsBefore = ports.visionCalls();
    const cutoutBefore = ports.cutoutCalls();

    const throttled = await callAs(handler, pool, USER_A, teaser('OVER-LIMIT'));

    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({
      error: { code: 'parse_rate_limited', message: expect.any(String) },
    });
    // The retry hint is present and positive.
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);

    // ---- THE MONEY ORACLE: the throttled request cost ZERO provider dollars ----
    expect(ports.visionCalls() - callsBefore).toBe(0);
    expect(ports.cutoutCalls() - cutoutBefore).toBe(0);
    expect(ports.visionCalls()).toBe(LIMIT);
    expect(ports.cutoutCalls()).toBe(LIMIT);

    // (c) No stranded row and no cap consumed — INDEPENDENT superuser SELECTs, not
    // the response body. Exactly the N successful jobs exist, all 'done'; the
    // refused photo left nothing behind and did not burn a teaser slot.
    expect(await superuserJobCount(superuser, USER_A)).toBe(LIMIT);
    expect(await superuserTeaserCount(superuser, USER_A)).toBe(LIMIT);
    expect(await superuserStatusCounts(superuser, USER_A)).toEqual({ done: LIMIT });
    const overLimitRow = await superuser.query<{ id: string }>(
      `SELECT id FROM public.parse_jobs WHERE user_id = $1 AND source_photo_hash = 'OVER-LIMIT'`,
      [USER_A],
    );
    expect(overLimitRow.rows).toHaveLength(0);

    delete process.env[PARSE_RATE_LIMIT_ENV];
    delete process.env[PARSE_RATE_WINDOW_ENV];
  });

  // The throttle must not eat the teaser budget: after being throttled, the user
  // still has all cap slots. Proven by re-running with a fresh (unthrottled) budget
  // and confirming the previously-refused photo now succeeds.
  it('a throttled photo is not lost: with budget restored the SAME photo parses, so the cap was never consumed', async () => {
    const user = 'cc000000-0000-4000-8000-000000000003';
    const ports = makeCountingPorts();
    const blocked = makeParsePhoto(() => ports, () => ({
      async consume(input) {
        return { allowed: false, retryAfterSeconds: input.windowSeconds };
      },
    }));

    const refused = await callAs(blocked, pool, user, teaser('RECOVER-1'));
    expect(refused.status).toBe(429);
    expect(ports.visionCalls()).toBe(0);
    expect(await superuserJobCount(superuser, user)).toBe(0);
    expect(await superuserTeaserCount(superuser, user)).toBe(0);

    const allowed = makeParsePhoto(() => ports, makeFakeLimiter().provide);
    const retried = await callAs(allowed, pool, user, teaser('RECOVER-1'));
    expect(retried.status).toBe(200);
    expect(ports.visionCalls()).toBe(1);
    expect(await superuserTeaserCount(superuser, user)).toBe(1);
  });

  // (d) Cross-user isolation: exhausting A's budget leaves B's untouched.
  it('cross-user isolation: A exhausted → B still parses, and the limiter is keyed on the verified sub only', async () => {
    const LIMIT = 2;
    const ports = makeCountingPorts();
    const limiter = makeFakeLimiter();
    process.env[PARSE_RATE_LIMIT_ENV] = String(LIMIT);
    const handler = makeParsePhoto(() => ports, limiter.provide);

    for (let i = 0; i < LIMIT; i += 1) {
      expect((await callAs(handler, pool, USER_B, teaser(`B-OK-${i}`))).status).toBe(200);
    }
    expect((await callAs(handler, pool, USER_B, teaser('B-OVER'))).status).toBe(429);

    // A different sub has its own budget — a full bucket for B never blocks C.
    const userC = 'dd000000-0000-4000-8000-000000000004';
    const cRes = await callAs(handler, pool, userC, teaser('C-OK'));
    expect(cRes.status).toBe(200);
    expect(limiter.spent(userC)).toBe(1);
    expect(limiter.spent(USER_B)).toBe(LIMIT);
    // B's refusal wrote nothing; C's success is isolated to C.
    expect(await superuserJobCount(superuser, USER_B)).toBe(LIMIT);
    expect(await superuserJobCount(superuser, userC)).toBe(1);

    // Identity: EVERY consume() saw the verified sub, never a body-supplied id. A
    // smuggled user_id is rejected by .strict() before the limiter is even reached.
    const smuggled = await callAs(handler, pool, userC, { ...teaser('C-SMUGGLE'), user_id: USER_B });
    expect(smuggled.status).toBe(400);
    const subs = new Set(limiter.calls.map((c) => c.userId));
    expect([...subs].sort()).toEqual([USER_B, userC].sort());
    expect(limiter.calls.every((c) => c.bucket === PARSE_SPEND_BUCKET)).toBe(true);

    delete process.env[PARSE_RATE_LIMIT_ENV];
  });

  // Ordering proof against the entitlement gate: a 402 must not burn budget, since
  // it can never reach a provider.
  it('an unentitled kind=full request is refused BEFORE the throttle, so a denied caller burns no budget', async () => {
    const user = 'ee000000-0000-4000-8000-000000000005';
    const ports = makeCountingPorts();
    const limiter = makeFakeLimiter();
    const handler = makeParsePhoto(() => ports, limiter.provide);

    const denied = await callAs(handler, pool, user, {
      source_photo_hash: 'FULL-DENIED',
      kind: 'full',
    });
    expect(denied.status).toBe(402);
    expect(ports.visionCalls()).toBe(0);
    expect(limiter.spent(user)).toBe(0);
    expect(limiter.calls.some((c) => c.userId === user)).toBe(false);
    expect(await superuserJobCount(superuser, user)).toBe(0);
  });

  // Fail-closed on a limiter fault: a throwing limiter must NOT fall through to the
  // paid providers. This is the mutation that matters most — "on limiter error,
  // allow" would be an unthrottled paid endpoint on any DB hiccup.
  it('a limiter that throws → 500 and ZERO provider calls (fail closed, not fail open)', async () => {
    const user = 'ff000000-0000-4000-8000-000000000006';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports, () => ({
      async consume() {
        throw new Error('limiter unavailable — raw message must never reach the wire');
      },
    }));

    const res = await callAs(handler, pool, user, teaser('LIMITER-DOWN'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).not.toContain('limiter unavailable');
    expect(ports.visionCalls()).toBe(0);
    expect(ports.cutoutCalls()).toBe(0);
    expect(await superuserJobCount(superuser, user)).toBe(0);
  });
});
