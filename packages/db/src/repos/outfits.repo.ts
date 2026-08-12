// outfits repo.
import { OUTFIT_PREVIEW_LIMIT, type OutfitRow, type OutfitSummary, type OutfitItemInput } from '@closet/shared';
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
  // Delete the caller's own outfit; its members cascade (outfit_items FK ON DELETE CASCADE).
  // Returns true iff a row was actually removed — false when the id doesn't exist OR belongs
  // to another tenant (RLS makes those indistinguishable, which is the point: a cross-tenant
  // delete is simply a no-op, never an error that would confirm the row exists).
  remove(userId: string, id: string): Promise<boolean>;
  // Rename the caller's own outfit (name may be null to clear it → "Untitled look"). Returns
  // the updated row, or null when the id doesn't exist / belongs to another tenant (RLS scopes
  // the UPDATE, so a cross-tenant rename matches nothing — a no-op, never an error). The
  // updated_at trigger (migration 0004) bumps automatically.
  rename(userId: string, id: string, name: string | null): Promise<OutfitRow | null>;
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

    async rename(userId, id, name) {
      // WHERE user_id = $1 is belt-and-suspenders with the RLS UPDATE policy. Only `name` is
      // set — updated_at is bumped by the outfits_set_updated_at trigger, never here. RETURNING
      // the full projection so the caller gets the canonical post-update row (incl. the new
      // updated_at). No row matched → null (non-existent or other tenant).
      const { rows } = await exec.query<OutfitRow>(
        `UPDATE public.outfits SET name = $3 WHERE user_id = $1 AND id = $2
         RETURNING ${PROJECTION}`,
        [userId, id, name],
      );
      return rows[0] ?? null;
    },

    async remove(userId, id) {
      // WHERE user_id = $1 is belt-and-suspenders with the RLS DELETE policy (both scope to
      // the caller). RETURNING id lets us report whether a row matched — rowCount is also
      // reliable for DELETE, but RETURNING is explicit and consistent with the other methods.
      const { rows } = await exec.query<{ id: string }>(
        `DELETE FROM public.outfits WHERE user_id = $1 AND id = $2 RETURNING id`,
        [userId, id],
      );
      return rows.length > 0;
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
      // Per-outfit aggregates via two correlated subqueries, so the outer query stays one row
      // per outfit (no GROUP BY over the base table, no fan-out to dedupe):
      //   - item_count: COUNT of this outfit's members (0 for an empty outfit).
      //   - preview_paths: up to OUTFIT_PREVIEW_LIMIT member cutout_paths, EXCLUDING members
      //     with no cutout yet (WHERE cutout_path IS NOT NULL), position-ordered to match the
      //     builder, aggregated into a text[]. COALESCE to '{}' so an outfit with no cutouts
      //     yields an empty array, never SQL NULL (which would fail the array schema).
      // Both subqueries carry `user_id = $1` alongside the outfit_id join: redundant under RLS
      // (which already scopes outfit_items to the caller) but it keeps the tenant predicate
      // explicit and lets the composite index serve the lookup.
      const { rows } = await exec.query<OutfitSummary>(
        `SELECT o.id, o.user_id, o.name,
                to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
                (SELECT count(*)::int
                   FROM public.outfit_items oi
                  WHERE oi.user_id = $1 AND oi.outfit_id = o.id) AS item_count,
                COALESCE((
                  SELECT array_agg(p.cutout_path ORDER BY p.ord)
                    FROM (
                      SELECT wi.cutout_path,
                             row_number() OVER (ORDER BY oi.position ASC NULLS LAST, oi.id ASC) AS ord
                        FROM public.outfit_items oi
                        JOIN public.wardrobe_items wi
                          ON wi.user_id = oi.user_id AND wi.id = oi.item_id
                       WHERE oi.user_id = $1 AND oi.outfit_id = o.id
                         AND wi.cutout_path IS NOT NULL
                       ORDER BY oi.position ASC NULLS LAST, oi.id ASC
                       LIMIT $2
                    ) p
                ), '{}') AS preview_paths
         FROM public.outfits o
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC, o.id DESC`,
        [userId, OUTFIT_PREVIEW_LIMIT],
      );
      return rows;
    },
  };
}
