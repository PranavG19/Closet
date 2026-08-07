// Independent oracle for task-13 (Storage RLS on storage.objects — docs/06 §6).
// This is the SOLE control preventing cross-user photo byte access, so the proof
// is "not by construction": SET LOCAL ROLE app_user (via makeTenantExecutor) and
// assert user A gets 0 rows for user B's prefix on BOTH buckets, for read AND
// write. The oracle is observed database state from a vantage the inserting
// statement does not control (a different tenant, or the RLS-bypassing superuser),
// never a return value the caller chose.
//
// Container note: postgres:17-alpine has NO `storage` schema (that is a
// Supabase-managed schema). Migration 0013 handles this with the same dual-target
// pattern as 0001_substrate — it fabricates a faithful `storage` stand-in
// (buckets + objects + foldername + RLS FORCE) ONLY when `storage` is absent, so
// the EXACT policy text shipped to prod is genuinely exercised against real rows
// here. On hosted Supabase that block no-ops and Supabase owns the schema.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations, revertMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Insert an object owned by `userId` at that user's prefix, as that tenant. The
// name follows the {user_id}/{parse_job_id}/{file} convention — first segment is
// the owner the RLS policy binds to.
async function insertObject(
  exec: QueryExecutor,
  bucket: string,
  userId: string,
  tail: string,
): Promise<void> {
  await exec.query(
    `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ($1, $2, $3)`,
    [bucket, `${userId}/${tail}`, userId],
  );
}

describe('0013 storage RLS — cross-user byte isolation (the ONLY control)', () => {
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

  it('originals: A owns A/job1/orig.jpg; B sees 0; superuser confirms it exists', async () => {
    await insertObject(execA, 'originals', USER_A, 'job1/orig.jpg');

    const seenByA = await execA.query(
      `SELECT id FROM storage.objects WHERE bucket_id = 'originals'`,
    );
    expect(seenByA.rows.length).toBeGreaterThanOrEqual(1);

    const seenByB = await execB.query(
      `SELECT id FROM storage.objects WHERE bucket_id = 'originals'`,
    );
    expect(seenByB.rows.length).toBe(0);

    // Isolation, not an empty table: the row really exists (superuser bypasses RLS).
    const truth = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM storage.objects
       WHERE bucket_id = 'originals' AND name = $1`,
      [`${USER_A}/job1/orig.jpg`],
    );
    expect(truth.rows[0]?.n).toBe('1');
  });

  it('cutouts: A owns A/job1/cut.png; B sees 0; superuser confirms it exists', async () => {
    await insertObject(execA, 'cutouts', USER_A, 'job1/cut.png');

    const seenByB = await execB.query(
      `SELECT id FROM storage.objects WHERE bucket_id = 'cutouts'`,
    );
    expect(seenByB.rows.length).toBe(0);

    const truth = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM storage.objects
       WHERE bucket_id = 'cutouts' AND name = $1`,
      [`${USER_A}/job1/cut.png`],
    );
    expect(truth.rows[0]?.n).toBe('1');
  });

  it('write isolation: B inserting under A prefix is refused (WITH CHECK) on both buckets', async () => {
    await expect(
      execB.query(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('originals', $1, $2)`,
        [`${USER_A}/job1/steal.jpg`, USER_B],
      ),
    ).rejects.toThrow();

    await expect(
      execB.query(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('cutouts', $1, $2)`,
        [`${USER_A}/job1/steal.png`, USER_B],
      ),
    ).rejects.toThrow();

    // Positive control: B CAN write under its OWN prefix — the refusal above is
    // the owner binding, not a blanket write denial.
    await insertObject(execB, 'originals', USER_B, 'jobB/ok.jpg');
    const truth = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM storage.objects WHERE name = $1`,
      [`${USER_B}/jobB/ok.jpg`],
    );
    expect(truth.rows[0]?.n).toBe('1');

    // And nothing landed under A's prefix from B's attempts.
    const leaked = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM storage.objects WHERE name LIKE $1`,
      [`${USER_A}/job1/steal%`],
    );
    expect(leaked.rows[0]?.n).toBe('0');
  });

  it('bucket_id predicate bites: an originals-shaped policy does NOT reach a cutouts object', async () => {
    // Behavioral proof on a mutant table that reuses the SAME storage.foldername
    // and the SAME policy shape as 0013, so the ONLY variable is the bucket_id
    // predicate. Real storage.objects policies are left untouched.
    await superuser.query(`DROP TABLE IF EXISTS public.mut_bucket`);
    await superuser.query(
      `CREATE TABLE public.mut_bucket (name text NOT NULL, bucket_id text NOT NULL)`,
    );
    await superuser.query(`ALTER TABLE public.mut_bucket ENABLE ROW LEVEL SECURITY`);
    await superuser.query(`ALTER TABLE public.mut_bucket FORCE ROW LEVEL SECURITY`);
    await superuser.query(`GRANT SELECT ON public.mut_bucket TO app_user`);
    // A owns one object in each bucket, both at A's prefix.
    await superuser.query(
      `INSERT INTO public.mut_bucket (name, bucket_id) VALUES
        ($1, 'originals'), ($2, 'cutouts')`,
      [`${USER_A}/j/o.jpg`, `${USER_A}/j/c.png`],
    );

    // (i) bucket-scoped policy (like 0013): A sees ONLY the originals row.
    await superuser.query(
      `CREATE POLICY mut_scoped ON public.mut_bucket FOR SELECT TO app_user
       USING (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text)`,
    );
    const scoped = await execA.query<{ bucket_id: string }>(
      `SELECT bucket_id FROM public.mut_bucket`,
    );
    expect(scoped.rows.length).toBe(1);
    expect(scoped.rows[0]?.bucket_id).toBe('originals');

    // (ii) drop the bucket_id predicate: the SAME owner check now leaks the
    // cutouts row too — proving the bucket_id predicate is load-bearing.
    await superuser.query(`DROP POLICY mut_scoped ON public.mut_bucket`);
    await superuser.query(
      `CREATE POLICY mut_unscoped ON public.mut_bucket FOR SELECT TO app_user
       USING ((storage.foldername(name))[1] = auth.uid()::text)`,
    );
    const unscoped = await execA.query(`SELECT bucket_id FROM public.mut_bucket`);
    expect(unscoped.rows.length).toBe(2);

    await superuser.query(`DROP TABLE public.mut_bucket`);
  });

  it('MUTATION: the folder-index literal [1] is load-bearing — [2] leaks across users', async () => {
    // Red-first mutation proof (not committed to the migration): a policy that
    // binds segment [2] instead of [1] lets user B read an object it does not own.
    // This is what makes the [1] in 0013 the actual owner binding.
    await superuser.query(`DROP TABLE IF EXISTS public.mut_index`);
    await superuser.query(`CREATE TABLE public.mut_index (name text NOT NULL)`);
    await superuser.query(`ALTER TABLE public.mut_index ENABLE ROW LEVEL SECURITY`);
    await superuser.query(`ALTER TABLE public.mut_index FORCE ROW LEVEL SECURITY`);
    await superuser.query(`GRANT SELECT ON public.mut_index TO app_user`);
    // Owner is the FIRST segment (A). Segment [2] happens to be B.
    await superuser.query(`INSERT INTO public.mut_index (name) VALUES ($1)`, [
      `${USER_A}/${USER_B}/f.jpg`,
    ]);

    // Correct policy — binds [1]=owner: B (not the owner) sees 0.
    await superuser.query(
      `CREATE POLICY mut_ix_correct ON public.mut_index FOR SELECT TO app_user
       USING ((storage.foldername(name))[1] = auth.uid()::text)`,
    );
    const correct = await execB.query(`SELECT name FROM public.mut_index`);
    expect(correct.rows.length).toBe(0);

    // Mutant policy — binds [2] instead of [1]: B now reads A's object. LEAK.
    await superuser.query(`DROP POLICY mut_ix_correct ON public.mut_index`);
    await superuser.query(
      `CREATE POLICY mut_ix_two ON public.mut_index FOR SELECT TO app_user
       USING ((storage.foldername(name))[2] = auth.uid()::text)`,
    );
    const mutant = await execB.query(`SELECT name FROM public.mut_index`);
    expect(mutant.rows.length).toBe(1);

    await superuser.query(`DROP TABLE public.mut_index`);
  });

  it('up->down->up redo runs clean (real reversible DOWN)', async () => {
    await revertMigrations(pool);
    await applyMigrations(pool);
    // After redo the storage stand-in is rebuilt and empty; a fresh tenant select
    // returns 0 rows with no error, and both buckets exist again.
    const seen = await execA.query(`SELECT id FROM storage.objects`);
    expect(seen.rows.length).toBe(0);
    const buckets = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM storage.buckets WHERE id IN ('originals','cutouts')`,
    );
    expect(buckets.rows[0]?.n).toBe('2');
  });
});
