// wear_log repo — the moat. Append-only (INSERT + SELECT only; no update/delete
// grant). The append is idempotent under retry via the partial UNIQUE(user_id,
// client_id): a duplicate tap resolves onto the caller's own pre-existing row and
// returns it, so a jittery client can retry freely and still land exactly one row.
//
// appendWear is ONE statement (one tx per query() call): a writable CTE that
// (a) inserts with ON CONFLICT DO NOTHING, (b) conditionally flips the worn item
// to 'dirty' — atomically with the append, only when a NEW row was inserted — and
// (c) UNION ALLs a fallback SELECT of the pre-existing row so exactly one canonical
// row is returned whether the insert landed or was a dup. client_id is minted by
// the caller at tap time, never here.
import type { WearLogRow, LogWearRequest } from '@closet/shared';
import type { QueryExecutor } from './index.js';

// Base-table projection: worn_at (timestamptz) rendered to strict ISO-8601 so it
// matches WearLogRow's Timestamptz schema. Used wherever we read the real column.
const COLS = `id, user_id, item_id, outfit_id, to_char(worn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS worn_at, client_id`;
// Passthrough projection for reading OUT of the `ins` CTE, whose worn_at is ALREADY
// the formatted text produced by COLS in the INSERT ... RETURNING — re-applying the
// to_char there would AT TIME ZONE a text value (timezone(unknown,text) error).
const COLS_PASSTHROUGH = `id, user_id, item_id, outfit_id, worn_at, client_id`;
import { clampLimit } from './pagination.js';

export interface AppendWearArgs {
  readonly userId: string;
  readonly itemId: string;
  readonly outfitId?: string | null;
  readonly clientId: string;
  readonly flipToDirty: boolean;
}

export interface WearLogRepo {
  appendWear(args: AppendWearArgs): Promise<WearLogRow>;
  // Convenience wrapper for the LogWearRequest boundary shape (no flip).
  append(userId: string, input: LogWearRequest): Promise<WearLogRow>;
  listByUser(userId: string, opts?: { limit?: number }): Promise<WearLogRow[]>;
}

export function makeWearLogRepo(exec: QueryExecutor): WearLogRepo {
  const appendWear = async (args: AppendWearArgs): Promise<WearLogRow> => {
    // The INSERT statement returns the row ONLY when this call won the insert; on a
    // conflict (a duplicate client_id — the retry/jitter case) ON CONFLICT DO NOTHING
    // yields no row. The flip-to-dirty happens ONLY here, gated on EXISTS(ins), so a
    // duplicate never re-flips. (No in-statement fallback SELECT: under READ COMMITTED
    // the loser's snapshot is taken before the winner commits, so a UNION-ALL fallback
    // would see zero rows and 500 on truly-simultaneous taps. DO UPDATE isn't an option
    // either — app_user has SELECT+INSERT only on this append-only moat, no UPDATE grant.)
    const { rows } = await exec.query<WearLogRow>(
      `WITH ins AS (
         INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
         RETURNING ${COLS}
       ),
       flip AS (
         UPDATE public.wardrobe_items SET availability = 'dirty'
         WHERE user_id = $1 AND id = $2 AND $5 = true
           AND EXISTS (SELECT 1 FROM ins)
         RETURNING 1
       )
       SELECT ${COLS_PASSTHROUGH} FROM ins`,
      [args.userId, args.itemId, args.outfitId ?? null, args.clientId, args.flipToDirty],
    );
    const inserted = rows[0];
    if (inserted) return inserted;

    // Lost the insert race (duplicate client_id): the winner's row is committed. A
    // FRESH query() is a new transaction with a new snapshot, so this SELECT sees it —
    // making the append response-idempotent under simultaneous retries (F8), not just
    // data-idempotent. SELECT-only, so the append-only grant matrix is unchanged.
    const { rows: existing } = await exec.query<WearLogRow>(
      `SELECT ${COLS} FROM public.wear_log WHERE user_id = $1 AND client_id = $2`,
      [args.userId, args.clientId],
    );
    const row = existing[0];
    if (!row) throw new Error('wear_log append returned no canonical row');
    return row;
  };

  return {
    appendWear,

    append(userId, input) {
      return appendWear({
        userId,
        itemId: input.item_id,
        outfitId: input.outfit_id ?? null,
        clientId: input.client_id,
        flipToDirty: false,
      });
    },

    async listByUser(userId, opts) {
      const { rows } = await exec.query<WearLogRow>(
        `SELECT ${COLS} FROM public.wear_log
         WHERE user_id = $1 ORDER BY worn_at DESC LIMIT $2`,
        [userId, clampLimit(opts?.limit)],
      );
      return rows;
    },
  };
}
