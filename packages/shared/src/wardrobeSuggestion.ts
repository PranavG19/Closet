// The adapter between a stored wardrobe row and the F5 suggestion heuristic.
//
// WHY THIS FILE HAS TO EXIST. `suggestItems` requires a numeric `warmth` per item, and
// THERE IS NO `warmth` COLUMN on wardrobe_items (see WardrobeItemRow in schemas/wardrobe.ts
// — category, color, pattern, attributes, availability, cutout_path, parse_job_id, phash,
// timestamps; no warmth). So the heuristic was unreachable from real data, not merely
// unwired: any caller would have had to invent the missing field inline, in a screen, with
// no test. Deriving it here — once, next to the heuristic it feeds, with its own tests —
// is what makes the pure function usable without a migration.
//
// Warmth is ORDINAL, not physical. `suggestItems` only ever compares and sums these values
// (warmest-first selection, and a monotonicity guarantee that colder weather never lowers
// aggregate warmth), so what matters is the ORDER, not the units. Category is the only
// warmth signal the schema actually carries; fabric weight would be better and lives in
// `attributes`, which is free-form JSON with no guaranteed keys — reading it here would be
// guessing at a shape nothing enforces.
import { WardrobeCategory, type Availability } from './schemas/common.js';
import type { SuggestionItem } from './suggestion.js';

// Ordinal warmth by category. Non-negative because `suggestItems` documents warmth as a
// non-negative ordinal — that is what makes its "adding a layer never lowers the sum"
// property provable.
//
// A closed Record over the enum, deliberately: adding a category to WardrobeCategory
// becomes a COMPILE ERROR here rather than silently defaulting to 0, which would make the
// new category permanently the coldest thing in the closet and quietly wrong.
const WARMTH_BY_CATEGORY: Readonly<Record<WardrobeCategory, number>> = {
  outerwear: 4, // the warmth layer — always the first thing picked as it gets colder
  top: 2,
  dress: 2,
  bottom: 2,
  shoes: 1,
  accessory: 1, // a scarf and a belt are both "accessory"; the schema cannot tell them apart
};

// The subset of a stored row this adapter reads. Structural rather than importing
// WardrobeItemRow, so a caller can pass any row-shaped value (including the mobile client's
// parsed rows) without a cast.
export interface WardrobeRowLike {
  readonly id: string;
  readonly category: string;
  readonly availability: Availability;
}

// Map a stored row to the heuristic's input view.
//
// An UNRECOGNISED category is not silently coerced: it falls back to the lightest non-zero
// warmth, because dropping the item would hide a garment she owns from every suggestion,
// and treating it as the warmest would put an unknown thing at the top of a cold-day
// outfit. Lightest-but-present is the honest default.
export function toSuggestionItem(row: WardrobeRowLike): SuggestionItem {
  const parsed = WardrobeCategory.safeParse(row.category);
  const warmth = parsed.success ? WARMTH_BY_CATEGORY[parsed.data] : 1;
  return {
    id: row.id,
    // `availability` and the heuristic's `status` are the same closed set
    // ('clean' | 'dirty' | 'unavailable'), so this is a rename, not a conversion.
    status: row.availability,
    warmth,
    category: row.category,
  };
}

export function toSuggestionItems(rows: readonly WardrobeRowLike[]): SuggestionItem[] {
  return rows.map(toSuggestionItem);
}
