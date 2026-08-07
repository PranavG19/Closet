// rate_limit_counters repo — the per-user provider-spend throttle seam (migration
// 0015). One method: atomic check-and-increment against a fixed window.
import type { QueryExecutor } from './index.js';

export interface RateLimitRepo {
  // true = admitted (the call may hit the paid provider), false = over budget for
  // this window. Atomic: the underlying fn is ONE upsert whose ON CONFLICT DO UPDATE
  // performs the increment under the row lock and whose RETURNING is the
  // post-increment count, so N concurrent callers admit AT MOST `limit`.
  // `windowInterval` is a Postgres interval literal (e.g. '1 hour', '60 seconds').
  consume(
    userId: string,
    scope: string,
    limit: number,
    windowInterval: string,
  ): Promise<{ admitted: boolean }>;
}

export function makeRateLimitRepo(exec: QueryExecutor): RateLimitRepo {
  return {
    async consume(userId, scope, limit, windowInterval) {
      const { rows } = await exec.query<{ admitted: boolean | null }>(
        `SELECT public.consume_rate_token($1, $2, $3, $4::interval) AS admitted`,
        [userId, scope, limit, windowInterval],
      );
      const admitted = rows[0]?.admitted;
      // A missing/NULL answer is not a "maybe" on a spend path — fail CLOSED.
      if (admitted !== true && admitted !== false) return { admitted: false };
      return { admitted };
    },
  };
}
