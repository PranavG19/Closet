// wardrobe_items repo. Repos are the ONLY DB seam: parameterized SQL over an
// injected executor that already carries tenant context (app_user + sub). This
// repo NEVER opens a connection, sets a role/claim, holds service_role, or
// bypasses RLS. Projections cast timestamptz->::text and the bigint phash->::text
// (64-bit exceeds JS safe-integer range — NOT a float) so returned rows match
// WardrobeItemRow. user_id always comes from the caller-supplied argument (a
// handler sources it from ctx.userId), never from a request body.
import type {
  WardrobeItemRow,
  CreateWardrobeItemRequest,
  Availability,
} from '@closet/shared';
import type { QueryExecutor } from './index.js';
// The server page-size clamp lives in ONE place (pagination.ts) — it was declared
// identically here, in wear-log.repo.ts, and a third time in functions/src/wardrobe/schemas.ts.
import { clampLimit } from './pagination.js';

const PROJECTION = `id, user_id, category, color, pattern, attributes, availability,
  cutout_path, parse_job_id, phash::text AS phash,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

export interface WardrobeListFilters {
  readonly category?: string;
  readonly color?: string;
  readonly availability?: Availability;
  readonly cursor?: { readonly createdAt: string; readonly id: string };
  readonly limit?: number;
}

export interface WardrobeRepo {
  create(userId: string, input: CreateWardrobeItemRequest): Promise<WardrobeItemRow>;
  listByUser(userId: string, opts?: WardrobeListFilters): Promise<WardrobeItemRow[]>;
  getById(userId: string, id: string): Promise<WardrobeItemRow | null>;
  setAvailability(
    userId: string,
    itemId: string,
    availability: Availability,
  ): Promise<WardrobeItemRow | null>;
  // Dedupe keep-one MERGE (docs/06 §7): re-point wear_log + outfit_items refs from
  // the discarded item to the kept item, then delete the now-unreferenced discard,
  // as ONE atomic statement (the ON DELETE RESTRICT FK is checked at statement end,
  // after all re-pointing). merged=false = discard not owned/already gone (no-op).
  mergeKeepOne(
    userId: string,
    args: { keepId: string; discardId: string },
  ): Promise<{ merged: boolean }>;
}

export function makeWardrobeRepo(exec: QueryExecutor): WardrobeRepo {
  return {
    async create(userId, input) {
      const { rows } = await exec.query<WardrobeItemRow>(
        `INSERT INTO public.wardrobe_items
           (user_id, category, color, pattern, attributes, cutout_path, parse_job_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING ${PROJECTION}`,
        [
          userId,
          input.category,
          input.color ?? null,
          input.pattern ?? null,
          input.attributes ?? null,
          input.cutout_path ?? null,
          input.parse_job_id ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('wardrobe_items insert returned no row');
      return row;
    },

    async listByUser(userId, opts) {
      const limit = clampLimit(opts?.limit);
      const cursor = opts?.cursor;
      const { rows } = await exec.query<WardrobeItemRow>(
        `SELECT ${PROJECTION}
         FROM public.wardrobe_items
         WHERE user_id = $1
           AND ($2::text IS NULL OR category = $2)
           AND ($3::text IS NULL OR color = $3)
           AND ($4::text IS NULL OR availability = $4)
           AND ($5::timestamptz IS NULL
                OR (created_at, id) < ($5::timestamptz, $6::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $7`,
        [
          userId,
          opts?.category ?? null,
          opts?.color ?? null,
          opts?.availability ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          limit,
        ],
      );
      return rows;
    },

    async getById(userId, id) {
      const { rows } = await exec.query<WardrobeItemRow>(
        `SELECT ${PROJECTION} FROM public.wardrobe_items WHERE user_id = $1 AND id = $2`,
        [userId, id],
      );
      return rows[0] ?? null;
    },

    async setAvailability(userId, itemId, availability) {
      const { rows } = await exec.query<WardrobeItemRow>(
        `UPDATE public.wardrobe_items SET availability = $3
         WHERE user_id = $1 AND id = $2
         RETURNING ${PROJECTION}`,
        [userId, itemId, availability],
      );
      return rows[0] ?? null;
    },

    // Delegates to the SECURITY DEFINER public.merge_keep_one(keep, discard) fn
    // (migration 0011). The moat is append-only: app_user has no UPDATE grant on
    // wear_log and no DELETE grant on outfit_items, so the re-point cannot run as an
    // inline CTE under the caller's role. The definer fn performs the whole re-point
    // -then-delete in one transaction, scoped internally to auth.uid() (so a caller
    // can only merge their OWN items — userId is NOT passed; the fn reads the
    // verified sub itself). It returns true iff the discard existed and was deleted;
    // false is the idempotent no-op (already merged / not owned). wear_log's ON
    // DELETE RESTRICT still guards the moat — the delete only lands because the
    // re-point ran first inside the fn.
    async mergeKeepOne(_userId, { keepId, discardId }) {
      const { rows } = await exec.query<{ merged: boolean }>(
        `SELECT public.merge_keep_one($1, $2) AS merged`,
        [keepId, discardId],
      );
      return { merged: rows[0]?.merged === true };
    },
  };
}
