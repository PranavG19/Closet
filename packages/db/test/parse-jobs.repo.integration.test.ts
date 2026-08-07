// Independent oracle for makeParseJobsRepo (task-09b). Per-photo idempotency +
// single-winner atomic claim + stale-lease re-claim, as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ParseJobRow } from '@closet/shared';
import { makeParseJobsRepo } from '../src/repos/parse-jobs.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

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
    // Backdate claimed_at past the 2-min lease via superuser → re-claimable.
    await superuser.query(
      `UPDATE public.parse_jobs SET status='failed', claimed_at = now() - interval '3 minutes' WHERE id = $1`,
      [jobId],
    );
    const reclaimed = await repo.claim(USER_A, jobId);
    expect(reclaimed?.status).toBe('processing');
  });

  it('cross-tenant read control — B sees none of A jobs; B claim of A job → null', async () => {
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
  });
});
