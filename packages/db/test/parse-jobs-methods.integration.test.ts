// Independent oracle for the Wave-4 parse-jobs crown-jewel methods (task-09b W4):
// resolveJob (idempotent + teaser cap + per-user serialization), commit (delete-
// partial-then-insert idempotent CTE), markFailed, listItemsByJob, countTeaserJobs.
// Drives the REAL repo through a real app_user tenant executor against real Postgres.
// Oracles are the shared Zod row schemas (parse-don't-cast) + a superuser control
// that proves rows exist while a cross-tenant SELECT is refused by RLS (isolation,
// not an empty table).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ParseJobRow, WardrobeItemRow } from '@closet/shared';
import { makeParseJobsRepo } from '../src/repos/parse-jobs.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

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

describe('parse-jobs W4 methods — resolveJob / commit / markFailed / listItemsByJob', () => {
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

  it('resolveJob is idempotent: same hash twice → same job id, count grows by exactly 1', async () => {
    const repo = makeParseJobsRepo(execA);
    const before = await superuserTeaserCount(superuser, USER_A);

    const first = await repo.resolveJob(
      USER_A,
      { source_photo_hash: 'R1', source_photo_path: 'a/R1.jpg', kind: 'teaser' },
      100,
    );
    expect(first.outcome).toBe('resolved');
    expect(first.job).not.toBeNull();
    expect(() => ParseJobRow.parse(first.job)).not.toThrow();

    const again = await repo.resolveJob(
      USER_A,
      { source_photo_hash: 'R1', source_photo_path: 'a/R1-different-path.jpg', kind: 'teaser' },
      100,
    );
    expect(again.outcome).toBe('resolved');
    expect(again.job?.id).toBe(first.job?.id);

    const after = await superuserTeaserCount(superuser, USER_A);
    expect(after - before).toBe(1);
  });

  it('teaser cap: NEW photo at the cap → cap_reached/null/count unchanged; EXISTING photo → resolved (does not count)', async () => {
    // Dedicated tenant so this test owns its teaser count exactly (no coupling to
    // teaser jobs other tests created for USER_A).
    const userD = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    const execD = makeTenantExecutor(pool, userD);
    const repo = makeParseJobsRepo(execD);
    const teaserCap = 4;
    // Seed exactly `teaserCap` teaser jobs (named so we can re-resolve one later).
    for (let i = 0; i < teaserCap; i += 1) {
      const seeded = await repo.resolveJob(
        userD,
        { source_photo_hash: `CAP-seed-${i}`, source_photo_path: `d/seed-${i}.jpg`, kind: 'teaser' },
        teaserCap,
      );
      expect(seeded.outcome).toBe('resolved');
    }
    expect(await superuserTeaserCount(superuser, userD)).toBe(teaserCap);

    // A brand-new teaser photo must be refused.
    const capped = await repo.resolveJob(
      userD,
      { source_photo_hash: 'CAP-new', source_photo_path: 'd/cap-new.jpg', kind: 'teaser' },
      teaserCap,
    );
    expect(capped.outcome).toBe('cap_reached');
    expect(capped.job).toBeNull();
    expect(await superuserTeaserCount(superuser, userD)).toBe(teaserCap);

    // Re-resolving an ALREADY-submitted teaser photo is idempotent even at the cap
    // (it does not count against the cap).
    const existing = await repo.resolveJob(
      userD,
      { source_photo_hash: 'CAP-seed-0', source_photo_path: 'd/seed-0.jpg', kind: 'teaser' },
      teaserCap,
    );
    expect(existing.outcome).toBe('resolved');
    expect(existing.job).not.toBeNull();
    expect(await superuserTeaserCount(superuser, userD)).toBe(teaserCap);

    // kind='full' skips the cap entirely.
    const full = await repo.resolveJob(
      userD,
      { source_photo_hash: 'FULL-past-cap', source_photo_path: 'd/full.jpg', kind: 'full' },
      teaserCap,
    );
    expect(full.outcome).toBe('resolved');
    expect(full.job?.kind).toBe('full');

    // countTeaserJobs mirrors the superuser count (full job did not bump it).
    expect(await repo.countTeaserJobs(userD)).toBe(teaserCap);
  });

  it('cap under contention: many DISTINCT new teaser photos with 1 slot free → exactly 1 lands (advisory lock serializes count-then-insert)', async () => {
    // Fresh tenant so this test owns the whole teaser count.
    const userC = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
    const execC = makeTenantExecutor(pool, userC);
    const repo = makeParseJobsRepo(execC);
    const teaserCap = 3;
    // Seed teaserCap-1 so the cap admits EXACTLY ONE more.
    for (let i = 0; i < teaserCap - 1; i += 1) {
      await repo.resolveJob(
        userC,
        { source_photo_hash: `C-seed-${i}`, source_photo_path: `c/seed-${i}.jpg`, kind: 'teaser' },
        teaserCap,
      );
    }
    expect(await superuserTeaserCount(superuser, userC)).toBe(teaserCap - 1);

    // A wide burst of DISTINCT new teaser photos races on app_user connections. If
    // the count-then-insert weren't serialized, several would each read n=cap-1 and
    // all insert, blowing past the cap. Serialized, exactly one lands and the rest
    // see the cap. (A 2-racer would pass by timing luck; 12 makes the race real.)
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        repo.resolveJob(
          userC,
          { source_photo_hash: `C-race-${i}`, source_photo_path: `c/r${i}.jpg`, kind: 'teaser' },
          teaserCap,
        ),
      ),
    );

    const resolved = results.filter((r) => r.outcome === 'resolved').length;
    const finalCount = await superuserTeaserCount(superuser, userC);
    expect(finalCount).toBe(teaserCap);
    expect(resolved).toBe(1);
  });

  it('commit: N items → itemCount N, listItemsByJob returns N, status=done; reprocess a failed job with same N → EXACTLY N (not 2N)', async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.resolveJob(
      USER_A,
      { source_photo_hash: 'COMMIT-1', source_photo_path: 'a/commit1.jpg', kind: 'full' },
      100,
    );
    const jobId = job.job!.id;

    const items = [
      { category: 'top', color: 'red', pattern: null, attributes: { fit: 'slim' }, cutout_path: 'a/c/1.png' },
      { category: 'bottom', color: 'blue', pattern: 'stripe', attributes: null, cutout_path: 'a/c/2.png' },
      { category: 'shoes', color: null, pattern: null, attributes: { heel: true }, cutout_path: null },
    ];

    const committed = await repo.commit(USER_A, jobId, items);
    expect(committed.itemCount).toBe(items.length);

    const listed = await repo.listItemsByJob(USER_A, jobId);
    expect(listed).toHaveLength(items.length);
    listed.forEach((row) => expect(() => WardrobeItemRow.parse(row)).not.toThrow());
    listed.forEach((row) => expect(row.parse_job_id).toBe(jobId));

    const done = await repo.getById(USER_A, jobId);
    expect(done?.status).toBe('done');

    // Force the job back to 'failed' and inject a stray partial item (as if a prior
    // crashed run left one behind) via superuser, then reprocess with the SAME N.
    await superuser.query(`UPDATE public.parse_jobs SET status='failed' WHERE id=$1`, [jobId]);
    await superuser.query(
      `INSERT INTO public.wardrobe_items (user_id, category, parse_job_id) VALUES ($1, 'accessory', $2)`,
      [USER_A, jobId],
    );
    expect(await superuserItemCount(superuser, jobId)).toBe(items.length + 1);

    const recommitted = await repo.commit(USER_A, jobId, items);
    expect(recommitted.itemCount).toBe(items.length);
    const relisted = await repo.listItemsByJob(USER_A, jobId);
    // delete-partial-then-insert: no double garments, no stray partial survivor.
    expect(relisted).toHaveLength(items.length);
    expect(await superuserItemCount(superuser, jobId)).toBe(items.length);
    expect((await repo.getById(USER_A, jobId))?.status).toBe('done');
  });

  it('markFailed sets status=failed + error_reason', async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.resolveJob(
      USER_A,
      { source_photo_hash: 'FAIL-1', source_photo_path: 'a/fail1.jpg', kind: 'full' },
      100,
    );
    const jobId = job.job!.id;
    await repo.markFailed(USER_A, jobId, 'segmentation_timeout');
    const row = await repo.getById(USER_A, jobId);
    expect(row?.status).toBe('failed');
    expect(row?.error_reason).toBe('segmentation_timeout');
  });

  it('cross-tenant control: rows exist (superuser) but a B-executor SELECT of A items returns 0 (RLS isolation, not empty table)', async () => {
    const repo = makeParseJobsRepo(execA);
    const job = await repo.resolveJob(
      USER_A,
      { source_photo_hash: 'ISO-1', source_photo_path: 'a/iso1.jpg', kind: 'full' },
      100,
    );
    const jobId = job.job!.id;
    const items = [
      { category: 'dress', color: 'green', pattern: null, attributes: null, cutout_path: null },
      { category: 'outerwear', color: 'black', pattern: null, attributes: null, cutout_path: null },
    ];
    await repo.commit(USER_A, jobId, items);

    // Superuser bypasses RLS → rows are really there.
    expect(await superuserItemCount(superuser, jobId)).toBe(items.length);

    // A-tenant sees them; B-tenant (sub=B) sees none of A's items — isolation, not
    // an empty table.
    expect(await repo.listItemsByJob(USER_A, jobId)).toHaveLength(items.length);
    const bRepo = makeParseJobsRepo(execB);
    expect(await bRepo.listItemsByJob(USER_A, jobId)).toHaveLength(0);
    expect(await bRepo.countTeaserJobs(USER_A)).toBe(0);
  });
});
