// Tier-1 METAMORPHIC (docs/05) — provider-agnostic relations over the REAL parsePhoto
// orchestration + real Postgres (full migration chain, RLS FORCE). A metamorphic test
// asserts a RELATION between the outputs of RELATED inputs that must hold regardless of
// the true garment label; the relation is a property of the parse contract, not of the
// author's guess at an answer. THE HTTP RESPONSE IS NEVER THE ORACLE — every assertion
// ends in a fresh independent SELECT: the victim tenant under RLS (makeTenantExecutor →
// SET LOCAL ROLE app_user) or a superuser cross-owner read that confirms rows exist /
// do not exist. Providers are deterministic FAKES we fully control so we can inject the
// transform behavior (fixed extraction, adapter-level parse-don't-cast, rejection).
//
// Relations proven here:
//   1. Attribute stability under re-submit — the same source_photo_hash twice yields the
//      SAME category + primaryColor bucket + the SAME committed item set (done-short-
//      circuit = no drift). Uses the real resolveJob/claim/commit path.
//   2. Cap/gate invariance — teaser vs full parse of the SAME fixed extraction produces
//      IDENTICAL per-item attributes; kind changes WHICH/how-many photos are allowed
//      (entitlement + cap), never the extraction result.
//   5. Fail-safe — a low-confidence / schema-rejected vision payload does NOT become a
//      confident wrong garment; the handler surfaces the failure (502) and commits
//      nothing, proven by a zero-row independent SELECT.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  AIVisionResultSchema,
  parseBoundary,
  type AIVisionPort,
  type AIVisionResult,
  type CutoutPort,
  type CutoutResult,
} from '@closet/shared';
import { withAuth, type AuthedHandler } from '../src/auth/withAuth.js';
import { makeParsePhoto, type ParsePorts } from '../src/parse/parse-photo.js';
import {
  applyMigrations,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

// ---- deterministic fixed extraction (a KNOWN garment) -------------------------
const FIXED_VISION: AIVisionResult = {
  category: 'dress',
  primaryColor: '#3366cc',
  secondaryColors: ['#ffffff'],
  material: 'silk',
  pattern: 'floral',
  formality: 'formal',
  season: 'summer',
};
const FIXED_CUTOUT: CutoutResult = {
  imageUrl: 'cutouts/fixed.png',
  hasAlpha: true,
  width: 900,
  height: 1400,
};

// A vision port that ALWAYS returns the same fixed extraction, with an observable call
// counter (extraction must not re-run on the done short-circuit).
interface CountingPorts extends ParsePorts {
  visionCalls(): number;
}
function makeFixedPorts(): CountingPorts {
  let vision = 0;
  return {
    vision: {
      async extractAttributes() {
        vision += 1;
        return FIXED_VISION;
      },
    },
    cutout: {
      async removeBackground() {
        return FIXED_CUTOUT;
      },
    },
    // The vendors receive a minted signed URL; the storage key itself is derived
    // server-side from the verified sub and is never handed to a vendor raw.
    mintSourcePhotoUrl: async (objectKey) => `https://storage.test/signed/${objectKey}?token=sig`,
    visionCalls: () => vision,
  };
}

// A vision ADAPTER that does parse-don't-cast on its RAW provider payload — exactly what
// a real adapter must do at the vendor boundary. A malformed / low-confidence payload
// fails AIVisionResultSchema and the adapter THROWS (BoundaryParseError) rather than
// letting untyped garbage into the domain. This models the fail-safe: a rejected
// extraction never becomes a confident garment.
function makeParsingVisionPort(rawPayload: unknown): AIVisionPort {
  return {
    async extractAttributes(): Promise<AIVisionResult> {
      return parseBoundary(AIVisionResultSchema, rawPayload, 'fake.vision.raw');
    },
  };
}
const OK_CUTOUT_PORT: CutoutPort = {
  async removeBackground() {
    return FIXED_CUTOUT;
  },
};

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

interface ItemRow {
  id: string;
  user_id: string;
  category: string;
  color: string | null;
  pattern: string | null;
  attributes: unknown;
  cutout_path: string | null;
}

// Independent oracle: read the committed garments for a job as the SUPERUSER (RLS-exempt),
// so this is a fresh SELECT that never trusts the handler's own response body.
async function itemsForJob(superuser: QueryExecutor, jobId: string): Promise<ItemRow[]> {
  const { rows } = await superuser.query<ItemRow>(
    `SELECT id, user_id, category, color, pattern, attributes, cutout_path
       FROM public.wardrobe_items WHERE parse_job_id = $1 ORDER BY id`,
    [jobId],
  );
  return rows;
}

async function jobIdForHash(superuser: QueryExecutor, userId: string, hash: string): Promise<string | null> {
  const { rows } = await superuser.query<{ id: string }>(
    `SELECT id FROM public.parse_jobs WHERE user_id = $1 AND source_photo_hash = $2`,
    [userId, hash],
  );
  return rows[0]?.id ?? null;
}

interface ParseBody {
  job: { id: string; status: string };
  items: ItemRow[];
}

describe('parse-photo — Tier-1 metamorphic relations (attribute stability, cap/gate invariance, fail-safe)', () => {
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

  // ---- Relation 1: attribute stability under re-submit (no drift) -------------
  it('re-submitting the same source_photo_hash yields the SAME category, color bucket, and the SAME committed item set', async () => {
    const user = 'aa000000-0000-4000-8000-000000000001';
    const ports = makeFixedPorts();
    const handler = makeParsePhoto(() => ports);
    const body = { source_photo_hash: 'STABLE-1', kind: 'teaser' as const };

    const first = await callAs(handler, pool, user, body);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ParseBody;
    const jobId = firstBody.job.id;
    expect(ports.visionCalls()).toBe(1);

    // Independent SELECT after the first parse — the committed truth on disk.
    const itemsAfterFirst = await itemsForJob(superuser, jobId);
    expect(itemsAfterFirst).toHaveLength(1);
    expect(itemsAfterFirst[0]!.category).toBe(FIXED_VISION.category);
    expect(itemsAfterFirst[0]!.color).toBe(FIXED_VISION.primaryColor);

    const second = await callAs(handler, pool, user, body);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ParseBody;
    // Done short-circuit: the extraction did NOT re-run (no drift possible).
    expect(ports.visionCalls()).toBe(1);
    expect(secondBody.job.id).toBe(jobId);

    // Independent SELECT after the re-submit — the SAME item set (same ids, same
    // category + color bucket), byte-for-byte, not the handler's own body.
    const itemsAfterSecond = await itemsForJob(superuser, jobId);
    expect(itemsAfterSecond.map((r) => r.id)).toEqual(itemsAfterFirst.map((r) => r.id));
    expect(itemsAfterSecond[0]!.category).toBe(itemsAfterFirst[0]!.category);
    expect(itemsAfterSecond[0]!.color).toBe(itemsAfterFirst[0]!.color);
    expect(itemsAfterSecond[0]!.pattern).toBe(itemsAfterFirst[0]!.pattern);
    expect(itemsAfterSecond[0]!.attributes).toEqual(itemsAfterFirst[0]!.attributes);
  });

  // ---- Relation 2: cap/gate invariance (kind never changes the extraction) ----
  it('teaser vs full parse of the SAME fixed extraction produces IDENTICAL per-item attributes', async () => {
    // Two users so the same photo can be parsed under both kinds (idempotency is per
    // (user, hash), so one user cannot hold the same hash as both teaser and full).
    const teaserUser = 'bb000000-0000-4000-8000-000000000002';
    const fullUser = 'cc000000-0000-4000-8000-000000000003';
    const ports = makeFixedPorts();
    const handler = makeParsePhoto(() => ports);

    const teaserRes = await callAs(handler, pool, teaserUser, {
      source_photo_hash: 'SAME-PHOTO',
      kind: 'teaser',
    });
    expect(teaserRes.status).toBe(200);
    const teaserJobId = (await teaserRes.json() as ParseBody).job.id;

    // Full parse requires an active entitlement — seed it as service_role (RLS-exempt),
    // never via the handler. kind='full' then skips the teaser cap and runs the SAME
    // extraction pipeline.
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, entitlement_active, updated_at) VALUES ($1, true, now())`,
      [fullUser],
    );
    const fullRes = await callAs(handler, pool, fullUser, {
      source_photo_hash: 'SAME-PHOTO',
      kind: 'full',
    });
    expect(fullRes.status).toBe(200);
    const fullJobId = (await fullRes.json() as ParseBody).job.id;

    // Independent cross-owner SELECT: the two committed garments — different owners,
    // different jobs, different kinds — carry BYTE-IDENTICAL per-item attributes. Kind
    // gated access (cap/entitlement); it never touched the extraction result.
    const [teaserItems, fullItems] = await Promise.all([
      itemsForJob(superuser, teaserJobId),
      itemsForJob(superuser, fullJobId),
    ]);
    expect(teaserItems).toHaveLength(1);
    expect(fullItems).toHaveLength(1);
    const t = teaserItems[0]!;
    const f = fullItems[0]!;
    expect(f.category).toBe(t.category);
    expect(f.color).toBe(t.color);
    expect(f.pattern).toBe(t.pattern);
    expect(f.cutout_path).toBe(t.cutout_path);
    expect(f.attributes).toEqual(t.attributes);
    // ...and they are genuinely distinct rows owned by distinct tenants (not the same row).
    expect(f.id).not.toBe(t.id);
    expect(t.user_id).toBe(teaserUser);
    expect(f.user_id).toBe(fullUser);
  });

  // ---- Relation 5: fail-safe — a rejected extraction never becomes a garment ----
  it('a low-confidence / schema-rejected vision payload → 502, NO committed garment (fail-safe)', async () => {
    const user = 'dd000000-0000-4000-8000-000000000004';
    // A raw provider payload a real adapter would REJECT: category out of the enum
    // (a low-confidence guess) and a non-hex color. parse-don't-cast throws → handler
    // treats it as a provider failure. This is the fail-safe relation: garbage in does
    // NOT surface as a confident wrong garment on disk.
    const rejectedPayload = {
      category: 'unknown',
      primaryColor: 'not-a-hex',
      secondaryColors: [],
      material: 'silk',
      pattern: 'solid',
      formality: 'casual',
      season: 'summer',
    };
    const handler = makeParsePhoto(() => ({
      vision: makeParsingVisionPort(rejectedPayload),
      cutout: OK_CUTOUT_PORT,
      mintSourcePhotoUrl: async (objectKey: string) => `https://storage.test/signed/${objectKey}?token=sig`,
    }));

    const res = await callAs(handler, pool, user, {
      source_photo_hash: 'LOWCONF-1',
      kind: 'teaser',
    });
    expect(res.status).toBe(502);
    const errBody = (await res.json()) as { error: { code: string; message: string } };
    expect(errBody.error.code).toBe('parse_provider_failed');

    // Independent SELECT: the job is marked failed with the FIXED non-PII reason, and
    // ZERO garments were committed — the rejected extraction produced no wrong garment.
    const jobId = await jobIdForHash(superuser, user, 'LOWCONF-1');
    expect(jobId).not.toBeNull();
    const job = await superuser.query<{ status: string; error_reason: string | null }>(
      `SELECT status, error_reason FROM public.parse_jobs WHERE id = $1`,
      [jobId],
    );
    expect(job.rows[0]?.status).toBe('failed');
    expect(job.rows[0]?.error_reason).toBe('provider_failed');
    expect(await itemsForJob(superuser, jobId!)).toHaveLength(0);

    // Metamorphic contrast: the SAME photo with a WELL-FORMED confident payload commits
    // exactly one garment — proving the 502 above was the rejection, not a broken path.
    const goodPorts = makeFixedPorts();
    const goodHandler = makeParsePhoto(() => goodPorts);
    const goodUser = 'ee000000-0000-4000-8000-000000000005';
    const okRes = await callAs(goodHandler, pool, goodUser, {
      source_photo_hash: 'LOWCONF-1',
      kind: 'teaser',
    });
    expect(okRes.status).toBe(200);
    const okJobId = (await okRes.json() as ParseBody).job.id;
    const okItems = await itemsForJob(superuser, okJobId);
    expect(okItems).toHaveLength(1);
    expect(okItems[0]!.category).toBe(FIXED_VISION.category);
  });
});
