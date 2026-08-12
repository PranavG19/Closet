// outfits repo.
import type { OutfitRow, OutfitSummary, OutfitItemInput } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `id, user_id, name,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

export interface CreateOutfitArgs {
  // Client-minted id for idempotent create (D-001). Omit to let the DB mint one.
  readonly id?: string;
  readonly name?: string | null;
  readonly items: readonly OutfitItemInput[];
}

export interface OutfitsRepo {
  create(userId: string, name: string | null): Promise<OutfitRow>;
  // Idempotent create of an outfit + its member items in ONE atomic statement
  // (one tx per query()). ON CONFLICT (user_id, id) DO NOTHING: a retry with the
  // same client-minted id returns the SAME outfit and does NOT re-insert items.
  // A member item_id owned by another tenant raises 23503 (composite FK), never a
  // silent cross-tenant link.
  createWithItems(userId: string, args: CreateOutfitArgs): Promise<OutfitRow>;
  getById(userId: string, id: string): Promise<OutfitRow | null>;
  listByUser(userId: string): Promise<OutfitRow[]>;
  // Like listByUser, but each row carries its garment count (LEFT JOIN so a 0-member outfit
  // is still listed with item_count 0). Same tenant predicate + ordering; RLS scopes both
  // outfits and the joined outfit_items to ctx.userId, so the count can only ever include the
  // caller's own members.
  listWithCounts(userId: string): Promise<OutfitSummary[]>;
}

export function makeOutfitsRepo(exec: QueryExecutor): OutfitsRepo {
  return {
    async create(userId, name) {
      const { rows } = await exec.query<OutfitRow>(
        `INSERT INTO public.outfits (user_id, name) VALUES ($1,$2)
         RETURNING ${PROJECTION}`,
        [userId, name],
      );
      const row = rows[0];
      if (!row) throw new Error('outfits insert returned no row');
      return row;
    },

    async createWithItems(userId, args) {
      // One atomic statement. `target` resolves the outfit id (client-minted for
      // idempotency, else DB-minted). ins_outfit inserts ON CONFLICT DO NOTHING;
      // ins_items runs to completion (data-modifying CTEs always execute) but only
      // inserts when the outfit was NEWLY created — a retry (conflict ⇒ ins_outfit
      // empty) re-inserts nothing. The statement returns a row ONLY when THIS call won
      // the insert (ins_outfit non-empty).
      //
      // NO in-statement UNION-ALL fallback SELECT for the conflict case: under READ
      // COMMITTED the loser's statement snapshot is fixed at statement start — before
      // the concurrent winner commits — so a `SELECT ... WHERE NOT EXISTS(ins_outfit)`
      // in the SAME statement sees ZERO rows on a truly-simultaneous duplicate and 500s
      // (`returned no row`). This is the exact trap wear-log.repo.ts:44-47 documents; the
      // sequential retry happened to work only because the first create was already
      // committed in an earlier transaction. The conflict row is read by a FRESH query()
      // below instead — a new transaction, new snapshot, so it sees the committed row.
      const { rows } = await exec.query<OutfitRow>(
        `WITH target AS (
           SELECT COALESCE($2::uuid, gen_random_uuid()) AS oid
         ),
         ins_outfit AS (
           INSERT INTO public.outfits (id, user_id, name)
           SELECT oid, $1, $3 FROM target
           ON CONFLICT (user_id, id) DO NOTHING
           RETURNING id, user_id, name,
                     to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
         ),
         ins_items AS (
           INSERT INTO public.outfit_items (user_id, outfit_id, item_id, slot, position)
           SELECT $1, t.oid, x.item_id, x.slot, x.position
           FROM target t,
                jsonb_to_recordset($4::jsonb) AS x(item_id uuid, slot text, position int)
           WHERE EXISTS (SELECT 1 FROM ins_outfit)
           ON CONFLICT (outfit_id, item_id) DO NOTHING
           RETURNING 1
         )
         SELECT id, user_id, name, created_at, updated_at FROM ins_outfit`,
        [userId, args.id ?? null, args.name ?? null, JSON.stringify(args.items)],
      );
      const inserted = rows[0];
      if (inserted) return inserted;

      // Lost the insert race (or a sequential retry): the outfit already exists,
      // committed. A retry only reaches here when the caller supplied the id (a
      // DB-minted uuid never conflicts). A FRESH query() is a new transaction whose
      // snapshot is taken after the winner committed, so it reads the canonical row —
      // making create response-idempotent under simultaneous retries (D-001), not just
      // data-idempotent. SELECT-only; the grant matrix is unchanged.
      const { rows: existing } = await exec.query<OutfitRow>(
        `SELECT ${PROJECTION} FROM public.outfits WHERE user_id = $1 AND id = $2`,
        [userId, args.id ?? null],
      );
      const row = existing[0];
      if (!row) throw new Error('outfits createWithItems returned no row');
      return row;
    },

    async getById(userId, id) {
      const { rows } = await exec.query<OutfitRow>(
        `SELECT ${PROJECTION} FROM public.outfits WHERE user_id = $1 AND id = $2`,
        [userId, id],
      );
      return rows[0] ?? null;
    },

    async listByUser(userId) {
      const { rows } = await exec.query<OutfitRow>(
        `SELECT ${PROJECTION} FROM public.outfits
         WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
        [userId],
      );
      return rows;
    },

    async listWithCounts(userId) {
      // LEFT JOIN + GROUP BY so an outfit with zero members still appears (count 0), and
      // count(oi.item_id) counts only non-null joined rows — the standard "count children"
      // idiom. ::int because count() is bigint; the OutfitSummary schema wants a JS number.
      // Grouped by o.id (the PK), so every non-aggregated column is functionally dependent and
      // needs no extra GROUP BY terms. Columns are aliased (o.) rather than reusing PROJECTION,
      // which uses bare names that would be ambiguous once outfit_items is joined.
      const { rows } = await exec.query<OutfitSummary>(
        `SELECT o.id, o.user_id, o.name,
                to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
                count(oi.item_id)::int AS item_count
         FROM public.outfits o
         LEFT JOIN public.outfit_items oi ON oi.outfit_id = o.id
         WHERE o.user_id = $1
         GROUP BY o.id
         ORDER BY o.created_at DESC, o.id DESC`,
        [userId],
      );
      return rows;
    },
  };
}
