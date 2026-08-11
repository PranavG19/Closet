// Oracle for the pure filter mapping. The properties graded here are the ones the SCREEN
// relies on but cannot itself prove: toggling is idempotent-to-clear, facets are independent,
// and deriveListParams emits ONLY active facets (a stray `category: undefined` would send an
// empty query param the server would reject or mis-handle). None of these touch React.
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_OPTIONS,
  AVAILABILITY_OPTIONS,
  toggleCategory,
  toggleAvailability,
  hasActiveFilter,
  deriveListParams,
  categoryLabel,
  availabilityLabel,
  type WardrobeFilter,
} from './wardrobeFilters.js';
import { WardrobeCategory, Availability } from '@closet/shared';

const EMPTY: WardrobeFilter = {};

describe('wardrobeFilters — pure state→query mapping', () => {
  it('the chip vocabularies are EXACTLY the wire enums (no drift, no extra, no missing)', () => {
    // If the screen offered a chip that is not a real enum member, the server would reject it;
    // if it omitted one, that category would be unfilterable. Grade against the shared schema's
    // own option list, not a hand-copied array.
    expect([...CATEGORY_OPTIONS].sort()).toEqual([...WardrobeCategory.options].sort());
    expect([...AVAILABILITY_OPTIONS].sort()).toEqual([...Availability.options].sort());
  });

  it('every option has a label (no chip renders blank)', () => {
    for (const c of CATEGORY_OPTIONS) expect(categoryLabel(c).length).toBeGreaterThan(0);
    for (const a of AVAILABILITY_OPTIONS) expect(availabilityLabel(a).length).toBeGreaterThan(0);
  });

  it('empty filter is inactive and derives no params', () => {
    expect(hasActiveFilter(EMPTY)).toBe(false);
    expect(deriveListParams(EMPTY)).toEqual({});
  });

  it('selecting a category sets exactly that facet', () => {
    const f = toggleCategory(EMPTY, 'dress');
    expect(f.category).toBe('dress');
    expect(hasActiveFilter(f)).toBe(true);
    expect(deriveListParams(f)).toEqual({ category: 'dress' });
  });

  it('re-tapping the active category CLEARS it (back to All)', () => {
    const f = toggleCategory(toggleCategory(EMPTY, 'dress'), 'dress');
    expect(f.category).toBeUndefined();
    expect(hasActiveFilter(f)).toBe(false);
    expect(deriveListParams(f)).toEqual({});
  });

  it('tapping a different category REPLACES (single-select, mirrors the server taking one)', () => {
    const f = toggleCategory(toggleCategory(EMPTY, 'top'), 'shoes');
    expect(f.category).toBe('shoes');
    expect(deriveListParams(f)).toEqual({ category: 'shoes' });
  });

  it('category and availability are INDEPENDENT — setting one keeps the other', () => {
    const f = toggleAvailability(toggleCategory(EMPTY, 'top'), 'clean');
    expect(f).toEqual({ category: 'top', availability: 'clean' });
    expect(deriveListParams(f)).toEqual({ category: 'top', availability: 'clean' });
  });

  it('clearing one facet leaves NO undefined key behind (params carry only active facets)', () => {
    const both = toggleAvailability(toggleCategory(EMPTY, 'top'), 'clean');
    const cleared = toggleCategory(both, 'top'); // clear category
    // The object must not even ENUMERATE category — a `{category: undefined}` would serialize
    // to an empty `?category=` the query builder would still emit.
    expect(Object.keys(cleared)).toEqual(['availability']);
    expect(deriveListParams(cleared)).toEqual({ availability: 'clean' });
    expect(Object.keys(deriveListParams(cleared))).toEqual(['availability']);
  });

  it('toggling never mutates the input filter (immutability)', () => {
    const base = toggleCategory(EMPTY, 'top');
    const snapshot = { ...base };
    toggleAvailability(base, 'clean');
    toggleCategory(base, 'shoes');
    expect(base).toEqual(snapshot);
  });
});
