// F5 — weather-aware outfit suggestion, safe by construction. It never proposes
// a garment she cannot wear now (only status='clean'), always returns something
// wearable when any clean item exists, returns a defined non-empty fallback when
// none do, and colder weather never lowers the aggregate warmth it recommends.
// Pure: no Date, no Math.random, no I/O, no mutation of arguments.
import { z } from 'zod';
import { parseBoundary } from './parse.js';
import { paletteAffinity, isColorFamily, type ColorFamily } from './harmony.js';

export const ItemStatus = z.enum(['clean', 'dirty', 'unavailable']);
export type ItemStatus = z.infer<typeof ItemStatus>;

// Minimal input view the heuristic actually reads. warmth is a non-negative
// ordinal scale (0 = lightest .. higher = warmer); non-negativity is what makes
// the warmth-monotone selection provable (adding a layer never lowers the sum).
export const SuggestionItemSchema = z.object({
  id: z.string(),
  status: ItemStatus,
  warmth: z.number().int().min(0),
  category: z.string(),
  // Optional color-family hint (from toColorFamily upstream). Used ONLY as an
  // equal-warmth tie-breaker (see suggestItems); absent → no color influence at all.
  colorFamily: z.string().nullable().optional(),
});
export type SuggestionItem = z.infer<typeof SuggestionItemSchema>;

export const SuggestionInputSchema = z.object({
  items: z.array(SuggestionItemSchema),
  tempC: z.number(),
  // The self-identified flattering families (B1 palette, already normalized to family
  // tokens). OPTIONAL and advisory: when present, an in-palette item is preferred over an
  // off-palette one OF EQUAL WARMTH — never across warmth tiers, so the weather guarantee
  // is untouched, and never as a filter, so nothing clean is ever excluded. Absent → the
  // heuristic is byte-identical to the pre-color version.
  paletteFamilies: z.array(z.string()).optional(),
  // Item ids worn RECENTLY (caller decides the window — e.g. the last 7 wear-log entries).
  // OPTIONAL and advisory: a FRESHNESS tie-break — among EQUAL-warmth items that are ALSO
  // equal on palette affinity, one NOT recently worn is preferred, so today's look isn't
  // yesterday's exact pieces. Never across warmth tiers (weather guarantee intact), never a
  // filter (a recently-worn item is still suggested if it's the only clean option). Absent →
  // byte-identical to the pre-freshness version.
  recentlyWornIds: z.array(z.string()).optional(),
});
export type SuggestionInput = z.infer<typeof SuggestionInputSchema>;

export type Suggestion =
  | { readonly fallback: false; readonly items: readonly SuggestionItem[] }
  | { readonly fallback: true; readonly reason: string; readonly items: readonly [] };

// Aggregate warmth = SUM of the selected items' warmth (exported so tests grade
// monotonicity against the same definition the heuristic targets).
export function aggregateWarmth(items: readonly SuggestionItem[]): number {
  return items.reduce((sum, item) => sum + item.warmth, 0);
}

// Layer count rises monotonically as tempC falls: ceil-of-a-falling-linear is
// non-decreasing in (WARM_BASE - tempC), so colder never asks for fewer layers.
const WARM_BASE_C = 25;
const BAND_WIDTH_C = 10;
function targetLayerCount(tempC: number): number {
  return 1 + Math.max(0, Math.ceil((WARM_BASE_C - tempC) / BAND_WIDTH_C));
}

export function suggestItems(input: unknown): Suggestion {
  const parsed = parseBoundary(SuggestionInputSchema, input, 'suggestItems');

  // Wearability filter is unconditional and first — no later branch re-admits an
  // excluded item. Only clean (== available) items are ever candidates.
  const clean = parsed.items.filter((item) => item.status === 'clean');
  if (clean.length === 0) {
    return { fallback: true, reason: 'no_clean_items', items: [] };
  }

  // Palette preference is a TIE-BREAKER WITHIN a warmth tier, never across tiers. Ordering
  // rules, in strict priority: (1) warmth desc — the weather guarantee, unchanged; (2) if a
  // palette is given, HIGHER palette affinity first (A4: a graded hue-distance score, so an
  // analogous colour outranks a distant one — not just exact-match-first); (3) id — the
  // deterministic final tie break. Because (2) only ever reorders items of EQUAL warmth,
  // aggregateWarmth of any prefix is identical to the warmth-only ordering, so
  // colder-never-warmer is preserved by construction. With no palette, (2) is inert and this
  // is byte-identical to the pre-color version.
  const paletteFamilies: ColorFamily[] | null = parsed.paletteFamilies
    ? parsed.paletteFamilies.filter((f): f is ColorFamily => isColorFamily(f))
    : null;
  // Affinity in [0,1]; 0 when no palette, no family, or an unmodelled family token.
  const affinity = (item: SuggestionItem): number =>
    paletteFamilies !== null && item.colorFamily != null && isColorFamily(item.colorFamily)
      ? paletteAffinity(item.colorFamily, paletteFamilies)
      : 0;

  // Freshness penalty in {0,1}: 1 when the item was worn recently (ranked LAST within its
  // warmth+palette tier), 0 otherwise. Empty/absent set → every penalty is 0 and this is inert.
  const recentlyWorn = new Set(parsed.recentlyWornIds ?? []);
  const freshnessPenalty = (item: SuggestionItem): number => (recentlyWorn.has(item.id) ? 1 : 0);

  // Copy before sort (never mutate the argument). Strict tie-break priority, each applied ONLY
  // within a tie of all higher keys, so aggregateWarmth of any prefix is identical to the
  // warmth-only ordering (weather guarantee preserved by construction):
  //   (1) warmth desc; (2) higher palette affinity; (3) freshness — not-recently-worn first;
  //   (4) id (deterministic final).
  const byWarmthDesc = [...clean].sort((a, b) => {
    if (b.warmth !== a.warmth) return b.warmth - a.warmth;
    const aff = affinity(b) - affinity(a);
    if (aff !== 0) return aff;
    // Equal warmth AND equal palette affinity: prefer the one NOT worn recently (lower penalty).
    const fresh = freshnessPenalty(a) - freshnessPenalty(b);
    if (fresh !== 0) return fresh;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const desired = targetLayerCount(parsed.tempC);
  const count = Math.min(Math.max(1, desired), byWarmthDesc.length);
  const selected = byWarmthDesc.slice(0, count);
  return { fallback: false, items: selected };
}
