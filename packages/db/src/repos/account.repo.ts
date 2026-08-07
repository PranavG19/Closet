// account repo — the account-deletion seam (Apple App Store Review Guideline
// 5.1.1(v): an app offering account creation MUST offer in-app account deletion).
//
// Delegates entirely to the SECURITY DEFINER public.delete_my_account() fn
// (migration 0014). No SQL for the purge itself lives here, and deliberately no
// userId parameter is threaded in: the function takes ZERO arguments and reads
// auth.uid() itself, so there is no seam through which one tenant could name
// another. The executor already carries (app_user role + verified sub), which is
// what makes auth.uid() resolve to the caller.
//
// The purge is PERMANENT and covers the seven tenant tables in FK-safe order
// (wear_log -> outfit_items -> outfits -> wardrobe_items -> parse_jobs ->
// palette_profile -> subscriptions). Storage bytes (originals/cutouts buckets) and
// the auth.users identity record are NOT reachable from SQL — they are a
// service_role deploy-wired step, documented in 0014's header.
import type { QueryExecutor } from './index.js';

// Per-table row counts of what the purge actually erased, plus their sum. Counts
// only — safe to log; no ids, no PII.
export interface AccountPurgeCounts {
  readonly wear_log: number;
  readonly outfit_items: number;
  readonly outfits: number;
  readonly wardrobe_items: number;
  readonly parse_jobs: number;
  readonly palette_profile: number;
  readonly subscriptions: number;
  readonly total: number;
}

export interface AccountRepo {
  // Permanently purge every row belonging to the authenticated caller. Idempotent:
  // a second call returns all-zero counts rather than erroring.
  deleteMyAccount(): Promise<AccountPurgeCounts>;
}

export function makeAccountRepo(exec: QueryExecutor): AccountRepo {
  return {
    async deleteMyAccount() {
      const { rows } = await exec.query<{ counts: AccountPurgeCounts }>(
        `SELECT public.delete_my_account() AS counts`,
      );
      const counts = rows[0]?.counts;
      if (!counts) throw new Error('delete_my_account returned no summary');
      return counts;
    },
  };
}
