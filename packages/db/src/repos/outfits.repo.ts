// outfits repo.
import type { OutfitRow, OutfitItemInput } from '@closet/shared';
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
      // empty) re-inserts nothing. The final row is read from ins_outfit's RETURNING
      // for the create case and from the table for the retry case (a plain SELECT
      // cannot see rows the sibling CTEs inserted in the same statement).
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
         SELECT id, user_id, name, created_at, updated_at FROM ins_outfit
         UNION ALL
         SELECT id, user_id, name, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
         FROM public.outfits
         WHERE user_id = $1 AND id = (SELECT oid FROM target)
           AND NOT EXISTS (SELECT 1 FROM ins_outfit)`,
        [userId, args.id ?? null, args.name ?? null, JSON.stringify(args.items)],
      );
      const row = rows[0];
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
  };
}
