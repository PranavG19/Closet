// palette_profile repo. 1:1 on user_id; upsert on conflict.
import type { PaletteProfileRow } from '@closet/shared';
import type { Json } from '@closet/shared';
import type { QueryExecutor } from './index.js';

const PROJECTION = `user_id, hues`;

export interface PaletteRepo {
  upsert(userId: string, hues: Json): Promise<PaletteProfileRow>;
  getByUser(userId: string): Promise<PaletteProfileRow | null>;
}

export function makePaletteRepo(exec: QueryExecutor): PaletteRepo {
  return {
    async upsert(userId, hues) {
      const { rows } = await exec.query<PaletteProfileRow>(
        `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET hues = excluded.hues, updated_at = now()
         RETURNING ${PROJECTION}`,
        [userId, JSON.stringify(hues)],
      );
      const row = rows[0];
      if (!row) throw new Error('palette_profile upsert returned no row');
      return row;
    },

    async getByUser(userId) {
      const { rows } = await exec.query<PaletteProfileRow>(
        `SELECT ${PROJECTION} FROM public.palette_profile WHERE user_id = $1`,
        [userId],
      );
      return rows[0] ?? null;
    },
  };
}
