// Oracle for dbSpendLimiter — the limiter PRODUCTION actually binds
// (parse-photo.ts: makeParsePhoto(makeProviderPorts, dbSpendLimiter)), and the one
// thing the throttle suite structurally cannot reach.
//
// parse-photo-throttle.integration.test.ts injects makeFakeLimiter for every case, so
// it proves the HANDLER's contract and says so honestly. What nothing covered is
// dbSpendLimiter's TRANSLATION into repo vocabulary, which is where production breaks:
//   · the `${windowSeconds} seconds` interval string it builds — a malformed interval
//     literal raises 22007, which errorFromThrown turns into a blanket 500 on EVERY
//     parse, and no type-check compares that string against Postgres;
//   · whether app_user may actually execute consume_rate_token under the CALLER's RLS
//     context (0015 is SECURITY INVOKER and its INSERT policy is auth.uid() = user_id,
//     so a context mismatch is 42501 → 500 on every parse).
// packages/db/test/rate-limit.repo.integration.test.ts tests the repo's own vocabulary,
// not this translation. A wrong translation is a 500 on every single parse, which the
// entire green suite would not catch.
//
// So this drives the REAL makeParsePhoto with the REAL dbSpendLimiter over a real
// per-request app_user executor against the full migration chain. The oracle is an
// INDEPENDENT superuser SELECT of rate_limit_counters plus the provider call counter —
// never the handler's own response.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { AIVisionPort, AIVisionResult, CutoutPort, CutoutResult } from '@closet/shared';
import { withAuth, type AuthedHandler } from '../src/auth/withAuth.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import {
  PARSE_RATE_LIMIT_ENV,
  PARSE_RATE_WINDOW_ENV,
  PARSE_SPEND_BUCKET,
  dbSpendLimiter,
} from '../src/parse/rate-limit.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER = '11110000-0000-4000-8000-000000000011';
const OTHER = '22220000-0000-4000-8000-000000000022';

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

interface CountingPorts extends ParsePorts {
  visionCalls(): number;
}

function makeCountingPorts(): CountingPorts {
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
    async mintSourcePhotoUrl() {
      return 'https://signed.example/original';
    },
    visionCalls: () => vision,
  };
}

function callAs(handler: AuthedHandler, pool: Pool, sub: string, body: unknown): Promise<Response> {
  const wrapped = withAuth(handler, {
    verifier: { verify: async (token: string) => ({ sub: token }) },
    makeExecutor: (verifiedUser: string) => makeTenantExecutor(pool, verifiedUser),
    newCorrelationId: () => 'db-limiter-test',
  });
  return wrapped(
    new Request('https://test.local/parse-photo', {
      method: 'POST',
      headers: { authorization: `Bearer ${sub}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const teaser = (hash: string): Record<string, string> => ({ source_photo_hash: hash, kind: 'teaser' });

// The independent oracle: the counter row as the SUPERUSER sees it (the handler and the
// limiter both run as app_user, so this vantage is one neither can reach).
async function counterRow(
  superuser: QueryExecutor,
  userId: string,
): Promise<{ request_count: number; scope: string } | null> {
  const { rows } = await superuser.query<{ request_count: number; scope: string }>(
    `SELECT request_count, scope FROM public.rate_limit_counters WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

describe('dbSpendLimiter — the REAL limiter production binds, against real Postgres', () => {
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
    delete process.env[PARSE_RATE_LIMIT_ENV];
    delete process.env[PARSE_RATE_WINDOW_ENV];
    await harness?.stop();
  });

  it('admits exactly `limit` requests then 429s — the interval string and the RLS grant both work', async () => {
    const LIMIT = 3;
    process.env[PARSE_RATE_LIMIT_ENV] = String(LIMIT);
    process.env[PARSE_RATE_WINDOW_ENV] = '300';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports, dbSpendLimiter);

    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push((await callAs(handler, pool, USER, teaser(`DB-${i}`))).status);
    }

    // Exactly `limit` admitted, exactly one refused. A 500 anywhere here is the
    // failure mode this file exists for: a bad interval literal (22007) or a missing
    // RLS grant (42501) would make EVERY entry 500.
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    expect(statuses.filter((s) => s === 500)).toHaveLength(0);

    // The money oracle: the refused request cost zero provider calls.
    expect(ports.visionCalls()).toBe(LIMIT);

    // Independent oracle: the counter really was written, under the right scope, by
    // the caller's own app_user context. A refused call still increments (0015's
    // documented behaviour), so LIMIT+1 attempts leave LIMIT+1 counted.
    const row = await counterRow(superuser, USER);
    expect(row?.scope).toBe(PARSE_SPEND_BUCKET);
    expect(row?.request_count).toBe(LIMIT + 1);
  });

  it('the budget is per-user: an exhausted caller does not block another sub', async () => {
    process.env[PARSE_RATE_LIMIT_ENV] = '1';
    process.env[PARSE_RATE_WINDOW_ENV] = '300';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports, dbSpendLimiter);

    // USER is already over budget from the previous case's window.
    expect((await callAs(handler, pool, USER, teaser('DB-BLOCKED'))).status).toBe(429);
    expect((await callAs(handler, pool, OTHER, teaser('DB-OTHER'))).status).toBe(200);

    // Each sub owns its own counter row — proven from the superuser vantage.
    expect((await counterRow(superuser, OTHER))?.request_count).toBe(1);
  });

  it('a refused request writes NO parse job — the guard sits before the first write', async () => {
    process.env[PARSE_RATE_LIMIT_ENV] = '1';
    process.env[PARSE_RATE_WINDOW_ENV] = '300';
    const user = '33330000-0000-4000-8000-000000000033';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports, dbSpendLimiter);

    expect((await callAs(handler, pool, user, teaser('DB-FIRST'))).status).toBe(200);
    expect((await callAs(handler, pool, user, teaser('DB-SECOND'))).status).toBe(429);

    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1`,
      [user],
    );
    expect(rows[0]?.n).toBe('1');
  });
});
