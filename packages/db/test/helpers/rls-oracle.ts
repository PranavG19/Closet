// rls-oracle — the probe that makes an "RLS denies it" claim non-vacuous.
//
// THE TRAP IT CLOSES. A test that asks a repo for another tenant's rows passes the
// READER'S OWN id as $1, so the repo's own `WHERE user_id = $1` returns the empty
// set. The RLS policy is never consulted and the assertion cannot fail — the test
// stays green with row-level security switched off entirely. So this helper takes
// NO user_id for its probe query: the read is `SELECT user_id FROM public.<table>`
// with no predicate at all, which makes the repo-predicate escape unrepresentable
// (CLAUDE.md rule 2) rather than merely discouraged.
//
// WARNING — TESTCONTAINER ONLY, NEVER A REAL SUPABASE PROJECT. Step 3 issues
// superuser DDL (ALTER TABLE ... DISABLE ROW LEVEL SECURITY) against the whole
// table, so for the duration of that one statement pair the table is readable by
// every role. It is only sound on a throwaway container, and it must be the only
// thing touching that database while it runs. That holds today because vitest runs
// the `it` blocks of one file serially and each file boots its OWN container via
// startPg() — sharing one container across files, or switching to `it.concurrent`,
// would break it. The restore lives in a `finally` so a failed assertion in step
// 2 or 3 cannot leave the table unprotected for the rest of the file.
//
// Precedent for the shape: subscriptions.rls.integration.test.ts's FORCE-stripping
// fire-drill, which mutates and restores on the same disposable container.
import { expect } from 'vitest';
import type { QueryExecutor } from './executor.js';

/**
 * Prove that `tenantExec` cannot see `otherUserId`'s rows in `table`, AND that the
 * proof could have failed. Four steps, in order:
 *   1. superuser control — the rows being hidden actually exist;
 *   2. unfiltered read through the tenant context — the other tenant is ABSENT;
 *   3. fire-drill — with RLS disabled the SAME read surfaces the other tenant, so
 *      step 2 is a live measurement and not a tautology;
 *   4. restore ENABLE + FORCE and re-assert step 2.
 *
 * The `table` type is a closed union of the tenant tables app_user holds SELECT on;
 * pointing this at a system table (webhook_events) would fail on the grant, not the
 * policy, and prove nothing.
 */
export async function expectRlsDenies(
  superuser: QueryExecutor,
  tenantExec: QueryExecutor,
  table:
    | 'wardrobe_items'
    | 'parse_jobs'
    | 'outfits'
    | 'outfit_items'
    | 'wear_log'
    | 'palette_profile'
    | 'subscriptions'
    | 'rate_limit_counters',
  otherUserId: string,
): Promise<void> {
  // (1) Control. Without this a 0-row read proves the table is EMPTY, not that
  // isolation held — the exact confusion that made the converted call sites vacuous.
  const seeded = await superuser.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
    [otherUserId],
  );
  expect(
    Number(seeded.rows[0]?.n),
    `${table}: superuser sees 0 rows for ${otherUserId} — there is nothing to hide, so this probe is vacuous`,
  ).toBeGreaterThan(0);

  // The probe. No predicate, no parameter — there is no repo `WHERE user_id = $1`
  // for a false pass to hide behind. Only RLS can keep the other tenant out.
  const ownersVisibleToTenant = async (): Promise<string[]> => {
    const { rows } = await tenantExec.query<{ user_id: string }>(`SELECT user_id FROM public.${table}`);
    return [...new Set(rows.map((r) => r.user_id))];
  };

  try {
    // (2) The claim.
    expect(
      await ownersVisibleToTenant(),
      `${table}: an UNFILTERED read through the tenant context returned ${otherUserId}'s rows — RLS is not scoping this table`,
    ).not.toContain(otherUserId);

    // (3) The point of the whole helper: prove the probe CAN fail, on this run, in
    // this container. With RLS off the identical statement MUST surface the other
    // tenant. If it does not, step 2's pass measured nothing — wrong table, no
    // seeded rows, or an executor that never reached this database.
    await superuser.query(`ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`);
    expect(
      await ownersVisibleToTenant(),
      `${table}: RLS DISABLED and the probe still saw only its own rows — the probe cannot fail, so step 2 proved nothing`,
    ).toContain(otherUserId);
  } finally {
    // (4a) Restore. Every table in the union above is declared ENABLE + FORCE by its
    // migration and the check-rls gate holds that true, so restoring both restores
    // the honest state rather than inventing one.
    await superuser.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    await superuser.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
  }

  // (4b) Re-assert outside the finally: if step 2/3 threw, that failure is the one
  // worth reporting and this line is correctly skipped.
  expect(
    await ownersVisibleToTenant(),
    `${table}: RLS was not restored after the fire-drill — later tests in this file are running unprotected`,
  ).not.toContain(otherUserId);
}
