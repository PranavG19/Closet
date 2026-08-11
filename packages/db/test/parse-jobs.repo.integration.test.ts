// Independent oracle for makeParseJobsRepo (task-09b). Per-photo idempotency +
// single-winner atomic claim + stale-lease re-claim, as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ParseJobRow } from '@closet/shared';
import { makeParseJobsRepo } from '../src/repos/parse-jobs.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';
import { expectRlsDenies } from './helpers/rls-oracle.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

describe('makeParseJobsRepo — idempotency + atomic claim', () => {
  let harness: PgHarness;
  let pool: Pool;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('per-photo create is idempotent (differential row count = 0 on dup)', async () => {
    const repo = makeParseJobsRepo(execA);
    const first = await repo.create(USER_A, {
      source_photo_hash: 'H1',
      source_photo_path: 'a/H1.jpg',
      kind: 'teaser',
    });
    expect(first).not.toBeNull();
    expect(() => ParseJobRow.parse(first)).not.toThrow();
    // Same hash again → null (conflict swallowed), and the table still holds 1 row.
    const dup = await repo.create(USER_A, {
      source_photo_hash: 'H1',
      source_photo_path: 'a/H1-again.jpg',
      kind: 'teaser',
    });
    expect(dup).toBeNull();
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.parse_jobs WHERE user_id = $1 AND source_photo_hash = 'H1'`,
      [USER_A],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('claim is single-winner and re-claimable after a stale lease', async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.create(USER_A, {
      source_photo_hash: 'H2',
      source_photo_path: 'a/H2.jpg',
      kind: 'full',
    });
    const jobId = job!.id;
    const won = await repo.claim(USER_A, jobId);
    expect(won?.status).toBe('processing');
    // Second claim while the lease is live → null.
    expect(await repo.claim(USER_A, jobId)).toBeNull();
    // Backdate claimed_at past the CLAIM_LEASE (repo: 10 minutes) via superuser →
    // re-claimable. The margin is deliberate: 3 minutes used to be "stale" under the
    // old 2-minute lease, but the lease was widened to exceed the real worst-case
    // in-flight parse (~137s) now that a 'processing' row is re-claimable at all.
    await superuser.query(
      `UPDATE public.parse_jobs SET status='failed', claimed_at = now() - interval '20 minutes' WHERE id = $1`,
      [jobId],
    );
    const reclaimed = await repo.claim(USER_A, jobId);
    expect(reclaimed?.status).toBe('processing');
  });

  // ---- The stuck-'processing' reclaim law (Audit-R2 blocker A) -----------------
  // An Edge isolate that dies between claim() and markFailed/commit (Deno eviction,
  // wall-clock kill, OOM, deploy mid-request) leaves the row at status='processing'
  // with a claimed_at that will never be refreshed. There is no reaper (docs/06 §234
  // declines pg_cron), and UNIQUE(user_id, source_photo_hash) + resolveJob returning
  // the existing row means that photo can NEVER be re-parsed by that user — every
  // retry 409s forever. So 'processing' MUST be governed by the SAME crash lease as
  // 'pending'/'failed': expired lease ⇒ reclaimable; LIVE lease ⇒ still refused.
  //
  // The two assertions are a matched pair and BOTH are load-bearing: the first proves
  // a crashed job self-heals, the second proves the single-winner guarantee survived
  // (a fix that merely added 'processing' with no lease check would pass #1 and fail
  // #2, letting two live isolates double-charge the paid providers).
  it("stuck 'processing' with an EXPIRED lease is re-claimable (crash self-heals)", async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.create(USER_A, {
      source_photo_hash: 'STUCK-EXPIRED',
      source_photo_path: 'a/stuck-expired.jpg',
      kind: 'full',
    });
    const jobId = job!.id;
    // Seed the exact state a crashed isolate leaves behind: 'processing' + a stale
    // claimed_at. Not 'failed' — markFailed never ran, that is the whole point.
    await superuser.query(
      `UPDATE public.parse_jobs
         SET status='processing', claimed_at = now() - interval '20 minutes'
       WHERE id = $1`,
      [jobId],
    );
    const reclaimed = await repo.claim(USER_A, jobId);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe('processing');
  });

  it("stuck 'processing' with a LIVE lease is still REFUSED (single-winner preserved)", async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.create(USER_A, {
      source_photo_hash: 'STUCK-LIVE',
      source_photo_path: 'a/stuck-live.jpg',
      kind: 'full',
    });
    const jobId = job!.id;
    // A genuinely IN-FLIGHT job: 'processing' with a fresh lease. Stealing this would
    // double-charge the paid providers — the lease clause must still bite.
    await superuser.query(
      `UPDATE public.parse_jobs SET status='processing', claimed_at = now() WHERE id = $1`,
      [jobId],
    );
    expect(await repo.claim(USER_A, jobId)).toBeNull();
  });

  it("concurrent burst over a STALE-lease 'processing' row → EXACTLY ONE winner", async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.create(USER_A, {
      source_photo_hash: 'STUCK-BURST',
      source_photo_path: 'a/stuck-burst.jpg',
      kind: 'full',
    });
    const jobId = job!.id;
    await superuser.query(
      `UPDATE public.parse_jobs
         SET status='processing', claimed_at = now() - interval '20 minutes'
       WHERE id = $1`,
      [jobId],
    );

    // 12 racers on independent app_user connections all see an expired lease in their
    // pre-statement snapshot. The row-level write lock is what serializes them: the
    // losers re-evaluate the WHERE against the winner's COMMITTED row (claimed_at is
    // now fresh) and return zero rows. A 2-racer would pass on timing luck; 12 makes
    // the race real.
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, () => repo.claim(USER_A, jobId)),
    );
    const winners = results.filter((r) => r !== null).length;
    expect(winners).toBe(1);
  });

  // MIXED, and now labelled that way. `getById(USER_A, ...)` passes the OTHER tenant's
  // id, so it lands in the repo's `WHERE user_id = $1` as A and only RLS can suppress
  // the row — that half is a GENUINE policy probe (fire-drilled: widening
  // parse_jobs_select_own to USING (true) makes it fail). `claim(USER_B, ...)` and
  // `listByUser(USER_B)` pass B's own id, so they are repo-predicate assertions and
  // stayed green under the same mutant. All three are kept; the unfiltered probe is
  // added so the RLS claim does not rest on the getById half alone.
  it('B getById of A job → null (RLS); B claim/list of A job → null (repo predicate)', async () => {
    const a = makeParseJobsRepo(execA);
    const job = await a.create(USER_A, {
      source_photo_hash: 'H3',
      source_photo_path: 'a/H3.jpg',
      kind: 'teaser',
    });
    const b = makeParseJobsRepo(execB);
    expect(await b.getById(USER_A, job!.id)).toBeNull();
    expect(await b.claim(USER_B, job!.id)).toBeNull();
    const bList = await b.listByUser(USER_B);
    expect(bList.some((r) => r.id === job!.id)).toBe(false);
    await expectRlsDenies(superuser, execB, 'parse_jobs', USER_A);
  });
});
