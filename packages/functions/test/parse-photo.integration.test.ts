// Independent oracle for parse-photo (task-13) — Tier-3 backend E2E. A real
// Postgres (full migration chain incl. 0012's resolve_teaser_job) drives the REAL
// parsePhoto handler through a real per-request app_user executor (RLS enforced).
// The HTTP response is NEVER the oracle: every row-count claim is an independent
// SELECT — a superuser count confirms data exists, a B-executor count confirms
// isolation (the 0 is RLS, not an empty table). Providers are deterministic FAKES
// with an OBSERVABLE call counter, so "how many times was the paid provider hit"
// is asserted directly (the double-charge guard). Entitlement is seeded as
// service_role (RLS-exempt), never via the handler — the handler only READS it.
//
// The four Tier-0 mutation targets were shown red-first during construction (see
// the note at the bottom): widening TEASER_JOB_CAP, removing the done short-circuit,
// flipping the entitlement comparison, and dropping commit's delete-partial each
// turn a green oracle here red.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type {
  AIVisionPort,
  AIVisionResult,
  CutoutPort,
  CutoutResult,
} from '@closet/shared';
import { withAuth, type AuthedHandler } from '../src/auth/withAuth.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import { TEASER_JOB_CAP } from '../src/parse/teaser-cap.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

// ---- deterministic fake providers with an observable call counter ------------
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

// The URL a fake minter hands the providers, so a test can tell "the vendor was given
// the minted URL" apart from "the vendor was given a raw storage key".
const FAKE_SIGNED_URL = 'https://storage.test/signed/original?token=sig';

interface CountingPorts extends ParsePorts {
  visionCalls(): number;
  cutoutCalls(): number;
  // Every storage key the minter was asked to sign — this is what proves the path
  // handed toward the vendors was DERIVED from the caller's sub, not from the body.
  mintedKeys(): readonly string[];
  // Every imageUrl the providers actually received.
  providerUrls(): readonly string[];
}

function makeCountingPorts(): CountingPorts {
  let vision = 0;
  let cutout = 0;
  const mintedKeys: string[] = [];
  const providerUrls: string[] = [];
  const visionPort: AIVisionPort = {
    async extractAttributes({ imageUrl }) {
      vision += 1;
      providerUrls.push(imageUrl);
      return FAKE_VISION;
    },
  };
  const cutoutPort: CutoutPort = {
    async removeBackground({ imageUrl }) {
      cutout += 1;
      providerUrls.push(imageUrl);
      return FAKE_CUTOUT;
    },
  };
  return {
    vision: visionPort,
    cutout: cutoutPort,
    async mintSourcePhotoUrl(objectKey: string) {
      mintedKeys.push(objectKey);
      return FAKE_SIGNED_URL;
    },
    visionCalls: () => vision,
    cutoutCalls: () => cutout,
    mintedKeys: () => mintedKeys,
    providerUrls: () => providerUrls,
  };
}

// A provider pair that always throws — drives the req-9 failure path.
const THROWING_PORTS: ParsePorts = {
  vision: {
    async extractAttributes(): Promise<AIVisionResult> {
      throw new Error('vendor 503 — raw message must never be logged or returned');
    },
  },
  cutout: {
    async removeBackground(): Promise<CutoutResult> {
      throw new Error('unreached');
    },
  },
  async mintSourcePhotoUrl() {
    return FAKE_SIGNED_URL;
  },
};

// Invoke a handler as `sub` over the pool through the REAL withAuth (fake verifier:
// the bearer token IS the sub, identical sub->tenant semantics to production).
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

async function superuserParseJobCount(superuser: QueryExecutor, userId: string): Promise<number> {
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

async function superuserItemCount(superuser: QueryExecutor, jobId: string): Promise<number> {
  const { rows } = await superuser.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE parse_job_id = $1`,
    [jobId],
  );
  return Number(rows[0]?.n ?? '0');
}

interface ParseBody {
  job: { id: string; user_id: string; status: string };
  items: { id: string; user_id: string }[];
}

describe('parse-photo endpoint — claim/commit/cap/entitlement oracle', () => {
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

  it('teaser happy path: providers called once, one item written, status=done, rows owned by A', async () => {
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    const res = await callAs(handler, pool, USER_A, {
      source_photo_hash: 'HAPPY-1',
      kind: 'teaser',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ParseBody;
    expect(body.job.status).toBe('done');
    expect(body.job.user_id).toBe(USER_A);
    expect(body.items).toHaveLength(1);
    expect(ports.visionCalls()).toBe(1);
    expect(ports.cutoutCalls()).toBe(1);

    // Independent SELECT: the row really exists and is owned by A.
    expect(await superuserItemCount(superuser, body.job.id)).toBe(1);
    const owner = await superuser.query<{ user_id: string }>(
      `SELECT user_id FROM public.wardrobe_items WHERE parse_job_id = $1`,
      [body.job.id],
    );
    expect(owner.rows.every((r) => r.user_id === USER_A)).toBe(true);
  });

  // ---- Oracle 3: entitlement-gated (money gate, surviving-mutant-free) -------
  it('entitlement gate: kind=full with no entitlement → 402, provider counter 0, zero rows; seeded entitlement → done', async () => {
    const user = 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);

    const denied = await callAs(handler, pool, user, {
      source_photo_hash: 'FULL-DENIED',
      kind: 'full',
    });
    expect(denied.status).toBe(402);
    expect(await denied.json()).toEqual({
      error: { code: 'entitlement_required', message: expect.any(String) },
    });
    // No provider call, no job, no item — the gate is FIRST.
    expect(ports.visionCalls()).toBe(0);
    expect(ports.cutoutCalls()).toBe(0);
    expect(await superuserParseJobCount(superuser, user)).toBe(0);

    // Seed entitlement as service_role (superuser bypasses RLS) — never via handler.
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, entitlement_active, updated_at)
       VALUES ($1, true, now())`,
      [user],
    );

    const allowed = await callAs(handler, pool, user, {
      source_photo_hash: 'FULL-ALLOWED',
      kind: 'full',
    });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as ParseBody;
    expect(body.job.status).toBe('done');
    expect(ports.visionCalls()).toBe(1);
    expect(await superuserItemCount(superuser, body.job.id)).toBe(1);
  });

  // ---- Oracle: already-done short-circuit (no double-charge on replay) -------
  it('already-done short-circuit: re-submit the same photo → 200, NO extra provider call, item count unchanged', async () => {
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    const first = await callAs(handler, pool, USER_A, {
      source_photo_hash: 'REPLAY-1',
      kind: 'teaser',
    });
    const firstBody = (await first.json()) as ParseBody;
    expect(ports.visionCalls()).toBe(1);
    const jobId = firstBody.job.id;
    const countAfterFirst = await superuserItemCount(superuser, jobId);

    const replay = await callAs(handler, pool, USER_A, {
      source_photo_hash: 'REPLAY-1',
      kind: 'teaser',
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as ParseBody;
    expect(replayBody.job.id).toBe(jobId);
    // The double-charge guard: the provider counter did NOT move on replay.
    expect(ports.visionCalls()).toBe(1);
    expect(ports.cutoutCalls()).toBe(1);
    expect(await superuserItemCount(superuser, jobId)).toBe(countAfterFirst);
  });

  // ---- Oracle 1: no-dup-on-resume (differential row count = exactly N) -------
  it('no-dup-on-resume: done → crash back to failed + partial injected → resume → exactly N items, status=done', async () => {
    const user = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);

    const first = await callAs(handler, pool, user, {
      source_photo_hash: 'RESUME-1',
      kind: 'teaser',
    });
    const jobId = ((await first.json()) as ParseBody).job.id;
    const N = await superuserItemCount(superuser, jobId); // handler emits exactly 1
    expect(N).toBe(1);

    // Simulate a crash: force the job back to 'failed' with the lease cleared
    // (claimed_at NULL == lease expired, so the resume can re-claim), and inject a
    // stray partial item as if a prior crashed run left one behind.
    await superuser.query(`UPDATE public.parse_jobs SET status='failed', claimed_at=NULL WHERE id=$1`, [jobId]);
    await superuser.query(
      `INSERT INTO public.wardrobe_items (user_id, category, parse_job_id) VALUES ($1, 'accessory', $2)`,
      [user, jobId],
    );
    expect(await superuserItemCount(superuser, jobId)).toBe(N + 1);

    const resume = await callAs(handler, pool, user, {
      source_photo_hash: 'RESUME-1',
      kind: 'teaser',
    });
    expect(resume.status).toBe(200);
    const resumeBody = (await resume.json()) as ParseBody;
    expect(resumeBody.job.status).toBe('done');
    // commit's delete-partial + the per-photo idempotency key: exactly N, not 2N,
    // and the injected partial is gone.
    expect(await superuserItemCount(superuser, jobId)).toBe(N);
  });

  // ---- Oracle 2: one-winner concurrency (NO double-charge) ------------------
  // The real money invariant is "the paid provider is hit at most ONCE and exactly
  // ONE item is committed, no matter how the two callers interleave" — NOT a fixed
  // [200,409] status pair. Two safe interleavings both satisfy it: (a) the loser
  // loses the atomic claim → 409; (b) the winner completes the whole pipeline
  // (claim→providers→commit→done) before the loser's resolveJob runs, so the loser
  // lands on the already-`done` job and hits the idempotent-replay short-circuit →
  // 200 with NO provider call. With instant fake providers (b) is common, so the
  // valid status set is {[200,409], [200,200]}; asserting [200,409] alone is a
  // flaky over-constraint. visionCalls===1 is the true double-charge guard and
  // holds in BOTH — verified stable across 30 interleavings before this was relaxed.
  it('one-winner concurrency: two parses race the same job → provider called ONCE, one item (no double-charge)', async () => {
    const user = '11111111-1111-4111-8111-111111111111';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    const body = { source_photo_hash: 'RACE-1', kind: 'teaser' as const };

    const [r1, r2] = await Promise.all([
      callAs(handler, pool, user, body),
      callAs(handler, pool, user, body),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // Both callers succeed OR one loses the claim — never a 5xx, never both failing.
    expect([[200, 200], [200, 409]]).toContainEqual(statuses);
    // THE money guard: the paid provider was invoked exactly once across the race —
    // whether the loser 409'd on the claim or replayed the done job, it never charged.
    expect(ports.visionCalls()).toBe(1);
    expect(ports.cutoutCalls()).toBe(1);

    // Independent SELECT: exactly one job, exactly one committed item — no dup garment.
    const jobs = await superuser.query<{ id: string }>(
      `SELECT id FROM public.parse_jobs WHERE user_id = $1`,
      [user],
    );
    expect(jobs.rows).toHaveLength(1);
    expect(await superuserItemCount(superuser, jobs.rows[0]!.id)).toBe(1);
  });

  // ---- Oracle 4: teaser cap holds (atomic, under concurrency) ---------------
  it('teaser cap: at the cap a new teaser → 402 teaser_cap_reached, no provider call, count unchanged', async () => {
    const user = '22222222-2222-4222-8222-222222222222';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    // Pin the business-critical value to a LITERAL (docs/05 Tier-0 mutation target
    // 10 -> 1000). Seeding the literal count — not the constant — is what kills the
    // widen mutant: seed 10, and if the handler's cap is anything > 10 the 11th
    // teaser would succeed (200) instead of 402. If product legitimately changes
    // the cap, this line fails loudly to force the seed literal to move with it.
    const EXPECTED_CAP = 10;
    expect(TEASER_JOB_CAP).toBe(EXPECTED_CAP);
    // Seed exactly EXPECTED_CAP distinct teaser jobs directly via the executor
    // (fixture control — bypasses the handler + providers).
    const execUser = makeTenantExecutor(pool, user);
    for (let i = 0; i < EXPECTED_CAP; i += 1) {
      await execUser.query(
        `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
         VALUES ($1, $2, $3, 'teaser')`,
        [user, `SEED-${i}`, `s/${i}.jpg`],
      );
    }
    expect(await superuserTeaserCount(superuser, user)).toBe(EXPECTED_CAP);

    const capped = await callAs(handler, pool, user, {
      source_photo_hash: 'CAP-NEW',
      kind: 'teaser',
    });
    expect(capped.status).toBe(402);
    expect(await capped.json()).toEqual({
      error: { code: 'teaser_cap_reached', message: expect.any(String) },
    });
    expect(ports.visionCalls()).toBe(0);
    expect(await superuserTeaserCount(superuser, user)).toBe(TEASER_JOB_CAP);
  });

  it('teaser cap under concurrency: 1 slot free, two NEW photos race → final teaser count never exceeds the cap', async () => {
    const user = '33333333-3333-4333-8333-333333333333';
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    const execUser = makeTenantExecutor(pool, user);
    // Seed cap-1 so exactly ONE slot remains.
    for (let i = 0; i < TEASER_JOB_CAP - 1; i += 1) {
      await execUser.query(
        `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
         VALUES ($1, $2, $3, 'teaser')`,
        [user, `BSEED-${i}`, `b/${i}.jpg`],
      );
    }
    expect(await superuserTeaserCount(superuser, user)).toBe(TEASER_JOB_CAP - 1);

    // Two DISTINCT new teaser photos race at the boundary. The repo's per-user
    // advisory-locked resolve serializes count-then-insert, so at most one lands.
    const [r1, r2] = await Promise.all([
      callAs(handler, pool, user, { source_photo_hash: 'BRACE-X', kind: 'teaser' }),
      callAs(handler, pool, user, { source_photo_hash: 'BRACE-Y', kind: 'teaser' }),
    ]);
    const okCount = [r1, r2].filter((r) => r.status === 200).length;
    const cappedCount = [r1, r2].filter((r) => r.status === 402).length;
    // The hard guarantee: the cap is never exceeded, exactly one slipped through.
    expect(await superuserTeaserCount(superuser, user)).toBe(TEASER_JOB_CAP);
    expect(okCount).toBe(1);
    expect(cappedCount).toBe(1);
  });

  // ---- Provider failure path -------------------------------------------------
  it('provider failure → 502 parse_provider_failed, job=failed with fixed non-PII reason, no raw message on the wire', async () => {
    const user = '44444444-4444-4444-8444-444444444444';
    const handler = makeParsePhoto(() => THROWING_PORTS);
    const res = await callAs(handler, pool, user, {
      source_photo_hash: 'FAIL-1',
      kind: 'teaser',
    });
    expect(res.status).toBe(502);
    const errBody = (await res.json()) as { error: { code: string; message: string } };
    expect(errBody.error.code).toBe('parse_provider_failed');
    // The raw vendor message never reaches the wire (PII rule).
    expect(errBody.error.message).not.toContain('vendor 503');

    const job = await superuser.query<{ status: string; error_reason: string | null }>(
      `SELECT status, error_reason FROM public.parse_jobs WHERE user_id=$1 AND source_photo_hash='FAIL-1'`,
      [user],
    );
    expect(job.rows[0]?.status).toBe('failed');
    expect(job.rows[0]?.error_reason).toBe('provider_failed');
    // No partial garbage survived (providers threw before any commit).
    const jobId = (
      await superuser.query<{ id: string }>(
        `SELECT id FROM public.parse_jobs WHERE user_id=$1 AND source_photo_hash='FAIL-1'`,
        [user],
      )
    ).rows[0]!.id;
    expect(await superuserItemCount(superuser, jobId)).toBe(0);
  });

  // ---- Oracle 5: control — RLS is live + identity from JWT, not body ---------
  it('control: superuser sees A rows while B-executor sees 0 (RLS isolation), and a body-smuggled user_id is inert', async () => {
    const ports = makeCountingPorts();
    const handler = makeParsePhoto(() => ports);
    const res = await callAs(handler, pool, USER_A, {
      source_photo_hash: 'ISO-1',
      kind: 'teaser',
    });
    const jobId = ((await res.json()) as ParseBody).job.id;

    // Superuser (RLS-exempt) proves the rows exist...
    expect(await superuserItemCount(superuser, jobId)).toBe(1);
    // ...while B (sub=B) sees NONE of A's items — the 0 is isolation, not empty.
    const execB = makeTenantExecutor(pool, USER_B);
    const bView = await execB.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE parse_job_id = $1`,
      [jobId],
    );
    expect(Number(bView.rows[0]?.n)).toBe(0);

    // Identity from JWT, not body: A submits a body smuggling user_id:B. .strict()
    // rejects the unknown key → 400, and NO row owned by B is ever written.
    const smuggle = await callAs(handler, pool, USER_A, {
      source_photo_hash: 'SMUGGLE-1',
      kind: 'teaser',
      user_id: USER_B,
    });
    expect(smuggle.status).toBe(400);
    expect(await superuserParseJobCount(superuser, USER_B)).toBe(0);
  });

  // ================================================================================
  // Oracle 6: the SOURCE PHOTO PATH is server-derived — cross-tenant read + SSRF.
  //
  // The vulnerability this closes: source_photo_path used to be a free z.string() on
  // the request, stored verbatim, and handed to BOTH paid providers as the URL THEIR
  // servers fetch. Storage RLS (migration 0013) does not cover that fetch — it governs
  // storage.objects access by app_user/authenticated, not a vendor pulling a URL we
  // gave it. So A could name B's prefix and receive B's photo described back as garment
  // attributes with the cutout persisted into A's own wardrobe; any absolute URL
  // (including a cloud metadata endpoint) became an SSRF + unbounded-spend sink.
  //
  // The money oracle in every case below is the PROVIDER CALL COUNT, and every row
  // claim is an independent SELECT — never the handler's own response body.
  // ================================================================================
  describe('source photo path is derived from the verified sub, never the body', () => {
    it('A naming B’s prefix is REJECTED (400) with zero job rows and ZERO provider calls', async () => {
      const attacker = '55555555-5555-4555-8555-555555555555';
      const victim = '66666666-6666-4666-8666-666666666666';
      const ports = makeCountingPorts();
      const handler = makeParsePhoto(() => ports);

      const attack = await callAs(handler, pool, attacker, {
        source_photo_hash: 'XTENANT-1',
        kind: 'teaser',
        // The original attack payload, verbatim: the victim's own prefix.
        source_photo_path: `${victim}/job/photo.jpg`,
      });

      expect(attack.status).toBe(400);
      // THE money oracle: no paid provider was invoked, so no vendor ever fetched
      // anything, and nothing was billed on an attacker-chosen object.
      expect(ports.visionCalls()).toBe(0);
      expect(ports.cutoutCalls()).toBe(0);
      // ...and no URL was even minted toward storage.
      expect(ports.mintedKeys()).toEqual([]);

      // Independent SELECTs (not the response): no job row for EITHER party, so the
      // rejection happened before resolveJob — nothing to resume or re-claim later.
      expect(await superuserParseJobCount(superuser, attacker)).toBe(0);
      expect(await superuserParseJobCount(superuser, victim)).toBe(0);
      // And no garment was written anywhere for the attacker.
      const items = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.wardrobe_items WHERE user_id = ANY($1::uuid[])`,
        [[attacker, victim]],
      );
      expect(items.rows[0]?.n).toBe('0');
    });

    // A scheme-bearing value, a traversal, a leading slash, a backslash and an
    // over-long string are each refused. These ride on source_photo_hash because that
    // is the ONLY caller-supplied component of the derived key — if a hash could carry
    // a separator or a scheme the caller would steer the path again.
    it.each([
      ['a scheme (SSRF)', 'https://evil/x.jpg'],
      ['a metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
      ['a .. traversal', '../../66666666-6666-4666-8666-666666666666/job'],
      ['a leading slash', '/etc/passwd'],
      ['a backslash', 'a\\b'],
      ['an over-long string', 'x'.repeat(600)],
    ])('%s in source_photo_hash → 400, zero jobs, zero provider calls', async (_label, hash) => {
      const user = '77777777-7777-4777-8777-777777777777';
      const ports = makeCountingPorts();
      const handler = makeParsePhoto(() => ports);

      const res = await callAs(handler, pool, user, { source_photo_hash: hash, kind: 'teaser' });

      expect(res.status).toBe(400);
      expect(ports.visionCalls()).toBe(0);
      expect(ports.cutoutCalls()).toBe(0);
      expect(ports.mintedKeys()).toEqual([]);
      expect(await superuserParseJobCount(superuser, user)).toBe(0);
    });

    it('happy path: the DERIVED path’s first segment is the caller’s user id, and the vendors get the minted URL', async () => {
      // A hand-written literal user id and hash, with the expected key written out
      // INDEPENDENTLY below — never computed from sourcePhotoObjectKey. A
      // {hash}/{user_id} inversion inside the helper would pass a helper-computed
      // expectation and fails here.
      const user = '88888888-8888-4888-8888-888888888888';
      const hash = 'DERIVED-1';
      const EXPECTED_KEY = '88888888-8888-4888-8888-888888888888/DERIVED-1/original';

      const ports = makeCountingPorts();
      const handler = makeParsePhoto(() => ports);
      const res = await callAs(handler, pool, user, { source_photo_hash: hash, kind: 'teaser' });
      expect(res.status).toBe(200);

      // Independent SELECT: the PERSISTED path is the derived key, owner-first.
      const stored = await superuser.query<{ source_photo_path: string }>(
        `SELECT source_photo_path FROM public.parse_jobs WHERE user_id = $1 AND source_photo_hash = $2`,
        [user, hash],
      );
      expect(stored.rows[0]?.source_photo_path).toBe(EXPECTED_KEY);
      // This is exactly what (storage.foldername(name))[1] evaluates to under 0013.
      expect(stored.rows[0]?.source_photo_path.split('/')[0]).toBe(user);

      // The minter was asked to sign that same derived key...
      expect(ports.mintedKeys()).toEqual([EXPECTED_KEY]);
      // ...and BOTH vendors received the MINTED URL, never a raw storage key. A raw
      // key reaching a vendor is the bug class this whole oracle exists for.
      expect(ports.providerUrls()).toEqual([FAKE_SIGNED_URL, FAKE_SIGNED_URL]);
      for (const url of ports.providerUrls()) {
        expect(url).not.toBe(EXPECTED_KEY);
        expect(url).not.toContain(user);
      }
    });

    it('two callers submitting the SAME photo hash get disjoint derived paths (no shared object)', async () => {
      const userOne = '99999999-9999-4999-8999-999999999999';
      const userTwo = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
      const hash = 'SAMEHASH-1';
      const ports = makeCountingPorts();
      const handler = makeParsePhoto(() => ports);

      expect((await callAs(handler, pool, userOne, { source_photo_hash: hash, kind: 'teaser' })).status).toBe(200);
      expect((await callAs(handler, pool, userTwo, { source_photo_hash: hash, kind: 'teaser' })).status).toBe(200);

      // Independent SELECT across both tenants: same hash, DIFFERENT owner-first keys.
      const paths = await superuser.query<{ user_id: string; source_photo_path: string }>(
        `SELECT user_id, source_photo_path FROM public.parse_jobs
         WHERE source_photo_hash = $1 ORDER BY user_id`,
        [hash],
      );
      expect(paths.rows).toHaveLength(2);
      for (const row of paths.rows) {
        expect(row.source_photo_path.split('/')[0]).toBe(row.user_id);
      }
      expect(paths.rows[0]!.source_photo_path).not.toBe(paths.rows[1]!.source_photo_path);
    });
  });
});

// ---- Red-first mutation evidence (demonstrated during construction, reverted) --
// The four Tier-0 mutants were each shown to turn a green oracle red, then reverted:
//   1. TEASER_JOB_CAP 10 -> 1000 (teaser-cap.ts): the "cap holds → 402" oracle goes
//      green-expected-402 but gets 200 → RED. Killed by oracle 4.
//   2. remove the `job.status === 'done'` short-circuit (parse-photo.ts): the
//      already-done replay re-claims + re-calls the provider → visionCalls()===2 →
//      RED. Killed by the replay oracle's provider-counter assertion.
//   3. flip `entitlement_active !== true` to `=== true` (parse-photo.ts): the
//      no-entitlement case falls through to a 200 with provider calls → RED. Killed
//      by oracle 3 (402 + counter 0 + zero rows).
//   4. drop the delete-partial in commit's CTE (packages/db parse-jobs.repo — owned
//      by task-09b; probed transiently, reverted, never committed here): resume
//      leaves N + injected-partial + N = RED against "exactly N". Killed by oracle 1
//      here and by parse-jobs-methods.integration.test.ts in @closet/db.
