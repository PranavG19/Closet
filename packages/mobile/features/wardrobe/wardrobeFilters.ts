// F4 wardrobe filters — the PURE state→query mapping, kept out of the screen so it can be
// tested without React or a running backend. The screen holds a WardrobeFilter in state and
// feeds deriveListParams() straight into useWardrobe(); the server (wardrobe/list.ts) does the
// actual filtering under RLS, so this file only ever TRANSLATES a selection into the query
// params that endpoint already accepts — it never filters rows itself (that would be a second,
// drifting filter).
//
// `color` is deliberately NOT a filter dimension here: it is free-text (any string the parser
// emitted), so it has no fixed chip set. Category and availability are closed enums, so they
// map cleanly to a chip row. If a colour facet is ever added it belongs on the server's existing
// `color` param, not a client-side scan.
import type { WardrobeCategory, Availability } from '@closet/shared';
import type { ListWardrobeParams } from '../../src/api/index.js';

// `undefined` on a dimension means "no filter on it" (show all) — the same shape the query
// params use, so an unset facet simply omits its param rather than sending a sentinel the
// server would have to special-case.
export interface WardrobeFilter {
  readonly category?: WardrobeCategory;
  readonly availability?: Availability;
}

// The chip vocabularies, in display order. These are the SAME closed enums the wire contract
// declares (WardrobeCategory / Availability in @closet/shared) — a chip that isn't a real enum
// member could not be constructed, so the filter can never send a value the server rejects.
export const CATEGORY_OPTIONS: readonly WardrobeCategory[] = [
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
];

export const AVAILABILITY_OPTIONS: readonly Availability[] = ['clean', 'dirty', 'unavailable'];

// Gentle, non-clinical labels (docs/03: copy is kind, never a shout). Availability reuses the
// exact strings AvailabilityChip already shows, so the filter chip and the item chip read the
// same word for the same state.
const CATEGORY_LABEL: Readonly<Record<WardrobeCategory, string>> = {
  top: 'Tops',
  bottom: 'Bottoms',
  dress: 'Dresses',
  outerwear: 'Outerwear',
  shoes: 'Shoes',
  accessory: 'Accessories',
};

const AVAILABILITY_LABEL: Readonly<Record<Availability, string>> = {
  clean: 'Ready to wear',
  dirty: 'In the wash',
  // "Set aside", not the clinical "Unavailable" — the one cold word among warm state labels,
  // and it matches statusChange.ts's action label ("Set aside") so the state and the verb agree.
  unavailable: 'Set aside',
};

export function categoryLabel(category: WardrobeCategory): string {
  return CATEGORY_LABEL[category];
}

export function availabilityLabel(availability: Availability): string {
  return AVAILABILITY_LABEL[availability];
}

// Toggle a chip: tapping the active value clears that facet (back to "All"), tapping a
// different value replaces it. A facet is single-select — the server's list query takes ONE
// category and ONE availability, so the UI mirrors that rather than pretending to OR values it
// cannot send.
export function toggleCategory(filter: WardrobeFilter, next: WardrobeCategory): WardrobeFilter {
  const category = filter.category === next ? undefined : next;
  return withCategory(filter, category);
}

export function toggleAvailability(filter: WardrobeFilter, next: Availability): WardrobeFilter {
  const availability = filter.availability === next ? undefined : next;
  return withAvailability(filter, availability);
}

// Rebuild the filter with one facet changed, OMITTING a facet that is undefined rather than
// setting it to undefined — so `deriveListParams` and equality checks see a clean object with
// only the active keys (an explicit `category: undefined` would still enumerate the key).
function withCategory(filter: WardrobeFilter, category: WardrobeCategory | undefined): WardrobeFilter {
  return {
    ...(category !== undefined ? { category } : {}),
    ...(filter.availability !== undefined ? { availability: filter.availability } : {}),
  };
}

function withAvailability(filter: WardrobeFilter, availability: Availability | undefined): WardrobeFilter {
  return {
    ...(filter.category !== undefined ? { category: filter.category } : {}),
    ...(availability !== undefined ? { availability } : {}),
  };
}

// Whether any facet is active — the screen uses this to decide whether the empty state should
// say "no items" (truly empty closet) or "no matches" (filtered to nothing), two situations
// with opposite next actions.
export function hasActiveFilter(filter: WardrobeFilter): boolean {
  return filter.category !== undefined || filter.availability !== undefined;
}

// The query params for useWardrobe — exactly the active facets, nothing else. Omits an unset
// facet so the request carries no empty query string for it.
export function deriveListParams(filter: WardrobeFilter): ListWardrobeParams {
  return {
    ...(filter.category !== undefined ? { category: filter.category } : {}),
    ...(filter.availability !== undefined ? { availability: filter.availability } : {}),
  };
}
