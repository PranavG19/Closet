// Independent oracle for task-02 (wardrobe_items + parse_jobs RLS).
// Tier-3 (RLS tenant isolation) + Tier-2 (constraint/idempotency). The oracle is
// actual database state observed from a vantage the inserting statement does not
// control — never a return value the caller chose.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations, revertMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function insertItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category, cutout_path)
     VALUES ($1, 'top', 'p') RETURNING id`,
    [userId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insert returned no id');
  return id;
}

describe('0002/0003 wardrobe_items + parse_jobs — RLS isolation + idempotency', () => {
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

  it('own rows visible; other tenant sees 0', async () => {
    await insertItem(execA, USER_A);
    const seenByA = await execA.query('SELECT id FROM public.wardrobe_items');
    expect(seenByA.rows.length).toBeGreaterThanOrEqual(1);
    const seenByB = await execB.query('SELECT id FROM public.wardrobe_items');
    expect(seenByB.rows.length).toBe(0);
  });

  it('WITH CHECK control — as app_user A, inserting user_id=B is refused', async () => {
    // The must-fail control: if this ever succeeds, the connection was still
    // superuser and every isolation assertion is meaningless.
    await expect(
      execA.query(
        `INSERT INTO public.wardrobe_items (user_id, category, cutout_path) VALUES ($1, 'top', 'p')`,
        [USER_B],
      ),
    ).rejects.toThrow();
  });

  it('per-photo idempotency — duplicate (user_id, source_photo_hash) adds 0 rows', async () => {
    await execA.query(
      `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
       VALUES ($1, 'H', 'sp', 'teaser')`,
      [USER_A],
    );
    const dup = await execA.query(
      `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
       VALUES ($1, 'H', 'sp', 'teaser')
       ON CONFLICT (user_id, source_photo_hash) DO NOTHING RETURNING id`,
      [USER_A],
    );
    expect(dup.rows.length).toBe(0);
    const count = await execA.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.parse_jobs WHERE source_photo_hash = 'H'`,
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('concurrent duplicate — exactly one insert wins, the other raises', async () => {
    const both = await Promise.allSettled([
      execA.query(
        `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
         VALUES ($1, 'RACE', 'sp', 'full')`,
        [USER_A],
      ),
      execA.query(
        `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
         VALUES ($1, 'RACE', 'sp', 'full')`,
        [USER_A],
      ),
    ]);
    const fulfilled = both.filter((r) => r.status === 'fulfilled').length;
    const rejected = both.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it('cross-tenant composite FK is unrepresentable', async () => {
    // A owns a parse job; B (as app_user, own user_id) tries to link a garment to
    // A's job id. No wardrobe parent (B, jobId) parent exists → FK rejects at write.
    const { rows } = await execA.query<{ id: string }>(
      `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
       VALUES ($1, 'FKTEST', 'sp', 'full') RETURNING id`,
      [USER_A],
    );
    const jobId = rows[0]?.id;
    await expect(
      execB.query(
        `INSERT INTO public.wardrobe_items (user_id, category, cutout_path, parse_job_id)
         VALUES ($1, 'top', 'p', $2)`,
        [USER_B, jobId],
      ),
    ).rejects.toThrow();
  });

  it('superuser cross-owner join counts 0 — no pair ever crosses tenants', async () => {
    const { rows } = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.wardrobe_items w
       JOIN public.parse_jobs j ON w.parse_job_id = j.id AND w.user_id <> j.user_id`,
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('up->down->up redo runs clean', async () => {
    await revertMigrations(pool);
    await applyMigrations(pool);
    // After redo the schema is empty again; a fresh select as A returns 0 rows, no error.
    const seen = await execA.query('SELECT id FROM public.wardrobe_items');
    expect(seen.rows.length).toBe(0);
  });
});
