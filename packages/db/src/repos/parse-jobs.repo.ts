// parse_jobs repo. Per-photo idempotent create + the atomic single-winner claim.
// Every "did this happen" decision rides on a RETURNING row count, never a driver
// rowcount (the executor exposes only { rows }).
import type { ParseJobRow, ParseJobKind, WardrobeItemRow } from '@closet/shared';
import type { QueryExecutor } from './index.js';
import { clampLimit } from './pagination.js';

const PROJECTION = `id, user_id, source_photo_hash, source_photo_path, kind, status,
  to_char(claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS claimed_at, error_reason,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

// The crash lease. `claimed_at` older than this ⇒ the isolate that held the claim is
// presumed dead and the job is re-claimable; newer ⇒ a LIVE claim that must not be
// stolen. It is a SQL interval literal, never a caller-supplied value — it is
// interpolated into the claim statement (a parameter cannot appear inside an INTERVAL
// literal), so it MUST stay a module constant.
//
// WHY 10 MINUTES AND NOT THE ORIGINAL 2 (docs/06 §161 wrote `interval '2 min'`):
// 2 minutes was safe only while 'processing' was excluded from the claim set, because
// the lease then governed nothing that could still be in flight. Now that a
// 'processing' row IS re-claimable, the lease is the ONLY thing standing between two
// live isolates and a double charge to the paid providers — so it must exceed the real
// worst-case duration of a single in-flight parse. Measured from the code, not
// guessed: parse-photo makes 3 SEQUENTIAL requestWithRetry calls (vision, Photoroom
// segment, Storage upload) and http.ts gives each maxRetries=2 ⇒ 3 attempts ×
// timeoutMs=15s + up to 750ms jittered backoff ≈ 46s apiece ⇒ ~137s end to end,
// already ABOVE 120s. A 2-minute lease with 'processing' claimable would therefore let
// a healthy-but-slow parse be stolen mid-flight and charge both providers twice.
// 10 minutes clears that 137s worst case with a wide margin (and still clears it if
// PROVIDER_TIMEOUT_MS / PROVIDER_MAX_RETRIES are raised a few multiples via env),
// while keeping the self-heal wait short enough that a crashed job recovers on a
// user's next retry rather than needing the reaper docs/06 §234 declined.
const CLAIM_LEASE = '10 minutes';

// wardrobe_items projection — mirrors wardrobe.repo.ts EXACTLY (timestamptz->::text,
// bigint phash->::text) so listItemsByJob rows satisfy WardrobeItemRow.
const ITEM_PROJECTION = `id, user_id, category, color, pattern, attributes, availability,
  cutout_path, parse_job_id, phash::text AS phash,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

// The garments a full/teaser parse produced, ready to persist. Carries no user_id
// or parse_job_id — the repo stamps both from the caller-supplied args (identity is
// never trusted from the payload), matching CreateWardrobeItemRequest's shape.
export interface CommitItemInput {
  readonly category: string;
  readonly color: string | null;
  readonly pattern: string | null;
  readonly attributes: unknown;
  readonly cutout_path: string | null;
}

// The job to resolve. `source_photo_path` is NOT a request field — the caller
// derives it server-side from the verified sub (see sourcePhotoObjectKey in
// @closet/functions); this interface is deliberately NOT `CreateParseJobRequest`,
// so a handler cannot satisfy it by forwarding a parsed request body.
export interface ResolveJobInput {
  readonly source_photo_hash: string;
  readonly source_photo_path: string;
  readonly kind: ParseJobKind;
}

export type ResolveJobResult =
  | { readonly outcome: 'resolved'; readonly job: ParseJobRow }
  | { readonly outcome: 'cap_reached'; readonly job: null };

export interface ParseJobsRepo {
  // ON CONFLICT (user_id, source_photo_hash) DO NOTHING: null = photo already
  // submitted (0 rows returned = conflict swallowed).
  create(userId: string, input: ResolveJobInput): Promise<ParseJobRow | null>;
  // Atomic claim: null = claim lost (a live lease is held or the job is done). A
  // job whose claimed_at is older than the crash lease is re-claimable — including
  // one stuck at 'processing' by an isolate that died mid-parse (see CLAIM_LEASE).
  claim(userId: string, id: string): Promise<ParseJobRow | null>;
  getById(userId: string, id: string): Promise<ParseJobRow | null>;
  listByUser(userId: string): Promise<ParseJobRow[]>;
  // Idempotent create with a teaser-count cap, serialized per user by a
  // pg_advisory_xact_lock so count-then-insert can't race two connections past the
  // cap. An already-submitted hash returns 'resolved' and does NOT count against the
  // cap; kind='full' skips the cap entirely.
  resolveJob(
    userId: string,
    input: ResolveJobInput,
    teaserCap: number,
  ): Promise<ResolveJobResult>;
  // Persist a parse job's garments in ONE data-modifying CTE: delete this job's
  // existing items first (so reprocessing a failed/processing job can't double the
  // garments), re-insert, then flip status='done'. Returns the inserted count.
  commit(
    userId: string,
    jobId: string,
    items: readonly CommitItemInput[],
  ): Promise<{ itemCount: number }>;
  markFailed(userId: string, jobId: string, reason: string): Promise<void>;
  listItemsByJob(userId: string, jobId: string): Promise<WardrobeItemRow[]>;
  countTeaserJobs(userId: string): Promise<number>;
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
           AND status IN ('pending','failed','processing')
           AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_LEASE}')
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
      // Server-clamped like wardrobe/wear-log (docs/06 §4: "server-clamped limit ≤ 100"): a
      // user-scoped list must never return the whole table unbounded. No caller passes a limit
      // today, so this applies the default page size as a hard ceiling; a keyset cursor can be
      // threaded through later if a paged parse-history view lands.
      const { rows } = await exec.query<ParseJobRow>(
        `SELECT ${PROJECTION} FROM public.parse_jobs
         WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [userId, clampLimit(undefined)],
      );
      return rows;
    },

    async resolveJob(userId, input, teaserCap) {
      // Serialize count-then-insert per user through the resolve_teaser_job plpgsql
      // fn (migration 0012). A single CTE cannot do this: under READ COMMITTED the
      // statement's snapshot is fixed BEFORE an in-CTE advisory lock is granted, so
      // the cap-count reads a stale pre-lock snapshot and every racer inserts (the
      // cap is blown). Inside plpgsql each statement re-snapshots after the lock, so
      // lock -> count -> insert sees a prior racer's committed row. The fn returns
      // the job id (existing photo = idempotent, does NOT count against the cap; new
      // photo under cap = the inserted id) or NULL iff a NEW teaser photo hit the cap.
      const resolved = await exec.query<{ id: string | null }>(
        `SELECT public.resolve_teaser_job($1, $2, $3, $4, $5) AS id`,
        [userId, input.source_photo_hash, input.source_photo_path, input.kind, teaserCap],
      );
      const jobId = resolved.rows[0]?.id ?? null;
      if (jobId === null) return { outcome: 'cap_reached', job: null };

      const readBack = await exec.query<ParseJobRow>(
        `SELECT ${PROJECTION} FROM public.parse_jobs WHERE user_id = $1 AND id = $2`,
        [userId, jobId],
      );
      const job = readBack.rows[0];
      if (!job) return { outcome: 'cap_reached', job: null };
      return { outcome: 'resolved', job };
    },

    async commit(userId, jobId, items) {
      const { rows } = await exec.query<{ item_count: number }>(
        `WITH del AS (
           DELETE FROM public.wardrobe_items
           WHERE user_id = $1 AND parse_job_id = $2
         ), ins AS (
           INSERT INTO public.wardrobe_items
             (user_id, category, color, pattern, attributes, cutout_path, parse_job_id)
           SELECT $1, x.category, x.color, x.pattern, x.attributes, x.cutout_path, $2
           FROM jsonb_to_recordset($3::jsonb)
             AS x(category text, color text, pattern text, attributes jsonb, cutout_path text)
           RETURNING 1
         )
         UPDATE public.parse_jobs SET status = 'done'
         WHERE user_id = $1 AND id = $2
         RETURNING (SELECT count(*) FROM ins)::int AS item_count`,
        [userId, jobId, JSON.stringify(items)],
      );
      const row = rows[0];
      if (!row) throw new Error('commit: parse job not found or not owned');
      return { itemCount: row.item_count };
    },

    async markFailed(userId, jobId, reason) {
      // claimed_at MUST be cleared here. `claim()` admits a row only when claimed_at IS NULL or
      // is older than CLAIM_LEASE — that staleness check exists for a CRASHED isolate, which
      // never gets to call markFailed. A job that fails cleanly (a provider 500, a timeout) is
      // finished and idle, so leaving the lease set made it unretryable for the full 10 minutes:
      // claim() refused it, and with UNIQUE(user_id, source_photo_hash) the retry could not
      // create a new row either, so she got a permanent-looking 409 "already being parsed" for a
      // photo that was sitting there failed and idle. Releasing the lease is what makes "try
      // again" mean try again.
      await exec.query(
        `UPDATE public.parse_jobs
         SET status = 'failed', claimed_at = NULL, error_reason = $3
         WHERE user_id = $1 AND id = $2`,
        [userId, jobId, reason],
      );
    },

    async listItemsByJob(userId, jobId) {
      const { rows } = await exec.query<WardrobeItemRow>(
        `SELECT ${ITEM_PROJECTION} FROM public.wardrobe_items
         WHERE user_id = $1 AND parse_job_id = $2
         ORDER BY created_at, id`,
        [userId, jobId],
      );
      return rows;
    },

    async countTeaserJobs(userId) {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.parse_jobs
         WHERE user_id = $1 AND kind = 'teaser'`,
        [userId],
      );
      return rows[0]?.n ?? 0;
    },
  };
}
