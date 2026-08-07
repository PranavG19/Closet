// outfit_items repo. The composite FKs (user_id, outfit_id)->outfits and
// (user_id, item_id)->wardrobe_items make a cross-tenant reference unrepresentable
// at write time — a mismatched id raises 23503, not a silent scope leak. No
// created_at/updated_at in OutfitItemRow; position is int (no cast).
import type { OutfitItemRow, OutfitItemInput } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `id, outfit_id, user_id, item_id, slot, position`;

export interface OutfitItemsRepo {
  add(userId: string, outfitId: string, input: OutfitItemInput): Promise<OutfitItemRow>;
  listByOutfit(userId: string, outfitId: string): Promise<OutfitItemRow[]>;
}

export function makeOutfitItemsRepo(exec: QueryExecutor): OutfitItemsRepo {
  return {
    async add(userId, outfitId, input) {
      const { rows } = await exec.query<OutfitItemRow>(
        `INSERT INTO public.outfit_items (user_id, outfit_id, item_id, slot, position)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING ${PROJECTION}`,
        [userId, outfitId, input.item_id, input.slot ?? null, input.position ?? null],
      );
      const row = rows[0];
      if (!row) throw new Error('outfit_items insert returned no row');
      return row;
    },

    async listByOutfit(userId, outfitId) {
      const { rows } = await exec.query<OutfitItemRow>(
        `SELECT ${PROJECTION} FROM public.outfit_items
         WHERE user_id = $1 AND outfit_id = $2
         ORDER BY position ASC NULLS LAST, id ASC`,
        [userId, outfitId],
      );
      return rows;
    },
  };
}
