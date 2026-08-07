// parse_jobs repo. Per-photo idempotent create + the atomic single-winner claim.
// Every "did this happen" decision rides on a RETURNING row count, never a driver
// rowcount (the executor exposes only { rows }).
import type { ParseJobRow, CreateParseJobRequest } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `id, user_id, source_photo_hash, source_photo_path, kind, status,
  to_char(claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS claimed_at, error_reason,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

export interface ParseJobsRepo {
  // ON CONFLICT (user_id, source_photo_hash) DO NOTHING: null = photo already
  // submitted (0 rows returned = conflict swallowed).
  create(userId: string, input: CreateParseJobRequest): Promise<ParseJobRow | null>;
  // Atomic claim: null = claim lost (a live lease is held or the job is done). A
  // job whose claimed_at is older than the 2-minute lease is re-claimable.
  claim(userId: string, id: string): Promise<ParseJobRow | null>;
  getById(userId: string, id: string): Promise<ParseJobRow | null>;
  listByUser(userId: string): Promise<ParseJobRow[]>;
}

export function makeParseJobsRepo(exec: QueryExecutor): ParseJobsRepo {
  return {
    async create(userId, input) {
      const { rows } = await exec.query<ParseJobRow>(
        `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, source_photo_hash) DO NOTHING
         RETURNING ${PROJECTION}`,
        [userId, input.source_photo_hash, input.source_photo_path, input.kind],
      );
      return rows[0] ?? null;
    },

    async claim(userId, id) {
      const { rows } = await exec.query<ParseJobRow>(
        `UPDATE public.parse_jobs
         SET status = 'processing', claimed_at = now()
         WHERE id = $2 AND user_id = $1
           AND status IN ('pending','failed')
           AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
         RETURNING ${PROJECTION}`,
        [userId, id],
      );
      return rows[0] ?? null;
    },

    async getById(userId, id) {
      const { rows } = await exec.query<ParseJobRow>(
        `SELECT ${PROJECTION} FROM public.parse_jobs WHERE user_id = $1 AND id = $2`,
        [userId, id],
      );
      return rows[0] ?? null;
    },

    async listByUser(userId) {
      const { rows } = await exec.query<ParseJobRow>(
        `SELECT ${PROJECTION} FROM public.parse_jobs
         WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
        [userId],
      );
      return rows;
    },
  };
}
