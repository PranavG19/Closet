// Data-export repo (GDPR/CCPA right of access). Returns EVERY row the caller owns
// across the six user-facing tenant tables plus their money row.
//
// NO SECURITY DEFINER here, and none is wanted: every statement runs as plain
// app_user under RLS FORCE, so each table reference is already confined to
// auth.uid(). That is the point — the export path holds no elevated privilege, so a
// bug in it cannot widen scope beyond what the caller could already SELECT. (The
// `user_id = $1` predicates are belt-and-braces and match the other repos; RLS is
// the actual boundary.) subscriptions is SELECT-only for app_user, which is exactly
// what an export needs.
//
// webhook_events is deliberately ABSENT: it has no user_id, is not tenant data, and
// app_user has no grant on it.
//
// The whole export is ONE statement (one tx per query() call), so every table is
// read from a SINGLE snapshot. Seven sequential SELECTs would each get their own
// snapshot, and a concurrent write landing mid-export could produce a document that
// references an outfit whose items are missing — an internally inconsistent, and
// therefore incomplete, subject-access response. jsonb_agg with an explicit ORDER BY
// also makes the document byte-stable for a given DB state.
//
// Projections mirror the per-table repos EXACTLY (timestamptz -> ISO text via
// to_char, bigint phash -> ::text since 64-bit exceeds JS safe-integer range) so
// every row satisfies its frozen @closet/shared row schema.
import type {
  WardrobeItemRow,
  ParseJobRow,
  OutfitRow,
  OutfitItemRow,
  WearLogRow,
  PaletteProfileRow,
  SubscriptionRow,
} from '@closet/shared';
import type { QueryExecutor } from './index.js';

// timestamptz -> strict ISO-8601 with a literal Z (matches Timestamptz).
const TS = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${col.split('.').pop() ?? col}`;

// NOTE the ORDER BY columns are the ALREADY-formatted ISO text values. Fixed-width
// ISO-8601 sorts lexicographically exactly as it sorts chronologically, so this is
// a real chronological order, not an approximation.
const SQL = `SELECT
  (SELECT coalesce(jsonb_agg(w ORDER BY w.created_at, w.id), '[]'::jsonb)
     FROM (SELECT id, user_id, category, color, pattern, attributes, availability,
                  cutout_path, parse_job_id, phash::text AS phash,
                  ${TS('created_at')}, ${TS('updated_at')}
             FROM public.wardrobe_items WHERE user_id = $1) w) AS wardrobe_items,

  (SELECT coalesce(jsonb_agg(j ORDER BY j.created_at, j.id), '[]'::jsonb)
     FROM (SELECT id, user_id, source_photo_hash, source_photo_path, kind, status,
                  ${TS('claimed_at')}, error_reason,
                  ${TS('created_at')}, ${TS('updated_at')}
             FROM public.parse_jobs WHERE user_id = $1) j) AS parse_jobs,

  (SELECT coalesce(jsonb_agg(o ORDER BY o.created_at, o.id), '[]'::jsonb)
     FROM (SELECT id, user_id, name, ${TS('created_at')}, ${TS('updated_at')}
             FROM public.outfits WHERE user_id = $1) o) AS outfits,

  (SELECT coalesce(jsonb_agg(oi ORDER BY oi.outfit_id, oi.position NULLS LAST, oi.id), '[]'::jsonb)
     FROM (SELECT id, outfit_id, user_id, item_id, slot, position
             FROM public.outfit_items WHERE user_id = $1) oi) AS outfit_items,

  (SELECT coalesce(jsonb_agg(wl ORDER BY wl.worn_at, wl.id), '[]'::jsonb)
     FROM (SELECT id, user_id, item_id, outfit_id, ${TS('worn_at')}, client_id
             FROM public.wear_log WHERE user_id = $1) wl) AS wear_log,

  (SELECT to_jsonb(p)
     FROM (SELECT user_id, hues
             FROM public.palette_profile WHERE user_id = $1) p) AS palette_profile,

  (SELECT to_jsonb(s)
     FROM (SELECT user_id, rc_app_user_id, entitlement_active,
                  ${TS('event_ts')}, ${TS('expires_at')}, ${TS('updated_at')}
             FROM public.subscriptions WHERE user_id = $1) s) AS subscription`;

// The complete set of a user's server-side personal data. palette_profile and
// subscription are 1:1 (PK user_id), so they are a single row or null — an absent
// row is a legitimate export value, never an error.
export interface ExportedUserData {
  readonly wardrobe_items: WardrobeItemRow[];
  readonly parse_jobs: ParseJobRow[];
  readonly outfits: OutfitRow[];
  readonly outfit_items: OutfitItemRow[];
  readonly wear_log: WearLogRow[];
  readonly palette_profile: PaletteProfileRow | null;
  readonly subscription: SubscriptionRow | null;
}

export interface ExportRepo {
  exportMyData(userId: string): Promise<ExportedUserData>;
}

export function makeExportRepo(exec: QueryExecutor): ExportRepo {
  return {
    async exportMyData(userId) {
      const { rows } = await exec.query<ExportedUserData>(SQL, [userId]);
      const row = rows[0];
      // A scalar-subquery SELECT with no FROM always yields exactly one row, so this
      // is unreachable in practice; it exists so a silent empty result can never be
      // served as a "complete" export.
      if (!row) throw new Error('export returned no document row');
      return row;
    },
  };
}
