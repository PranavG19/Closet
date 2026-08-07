// F5 — weather-aware outfit suggestion, safe by construction. It never proposes
// a garment she cannot wear now (only status='clean'), always returns something
// wearable when any clean item exists, returns a defined non-empty fallback when
// none do, and colder weather never lowers the aggregate warmth it recommends.
// Pure: no Date, no Math.random, no I/O, no mutation of arguments.
import { z } from 'zod';
import { parseBoundary } from './parse.js';

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
});
export type SuggestionItem = z.infer<typeof SuggestionItemSchema>;

export const SuggestionInputSchema = z.object({
  items: z.array(SuggestionItemSchema),
  tempC: z.number(),
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

  // Copy before sort (never mutate the argument). Warmest first; id tie-break
  // makes selection deterministic regardless of input order.
  const byWarmthDesc = [...clean].sort((a, b) =>
    b.warmth !== a.warmth ? b.warmth - a.warmth : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const desired = targetLayerCount(parsed.tempC);
  const count = Math.min(Math.max(1, desired), byWarmthDesc.length);
  const selected = byWarmthDesc.slice(0, count);
  return { fallback: false, items: selected };
}
