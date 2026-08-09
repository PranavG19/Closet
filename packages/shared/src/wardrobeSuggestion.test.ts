// The oracle here is the CONTRACT suggestItems documents — warmth is a non-negative
// ordinal whose ORDER drives selection — plus the properties the row→item mapping must
// preserve. Not a snapshot of the numbers: the specific values are an implementation
// choice, their relative order is the guarantee.
import { describe, it, expect } from 'vitest';
import { toSuggestionItem, toSuggestionItems } from './wardrobeSuggestion.js';
import { suggestItems, aggregateWarmth } from './suggestion.js';
import { WardrobeCategory } from './schemas/common.js';

const row = (id: string, category: string, availability: 'clean' | 'dirty' | 'unavailable' = 'clean') => ({
  id,
  category,
  availability,
});

describe('toSuggestionItem — the mapping the heuristic needs', () => {
  it('assigns EVERY WardrobeCategory a non-negative warmth', () => {
    // suggestItems' monotonicity proof depends on non-negativity, so this is a contract
    // check, not a formatting check. Iterating the enum means a new category cannot slip
    // through untested.
    for (const category of WardrobeCategory.options) {
      const item = toSuggestionItem(row('i1', category));
      expect(item.warmth).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(item.warmth)).toBe(true);
    }
  });

  it('ranks outerwear as the warmest category', () => {
    // The ordering that matters: as it gets colder, the coat is what gets added.
    const coat = toSuggestionItem(row('i1', 'outerwear')).warmth;
    for (const category of WardrobeCategory.options.filter((c) => c !== 'outerwear')) {
      expect(coat).toBeGreaterThan(toSuggestionItem(row('i2', category)).warmth);
    }
  });

  it('ranks a top warmer than shoes and accessories', () => {
    const top = toSuggestionItem(row('i1', 'top')).warmth;
    expect(top).toBeGreaterThan(toSuggestionItem(row('i2', 'shoes')).warmth);
    expect(top).toBeGreaterThan(toSuggestionItem(row('i3', 'accessory')).warmth);
  });

  it('passes availability through as status unchanged (it is a rename, not a conversion)', () => {
    expect(toSuggestionItem(row('i1', 'top', 'clean')).status).toBe('clean');
    expect(toSuggestionItem(row('i1', 'top', 'dirty')).status).toBe('dirty');
    expect(toSuggestionItem(row('i1', 'top', 'unavailable')).status).toBe('unavailable');
  });

  it('keeps an UNRECOGNISED category with the lightest non-zero warmth, never drops it', () => {
    // Dropping it would hide a garment she owns from every suggestion; treating it as
    // warmest would put an unknown thing at the top of a cold-day outfit.
    const item = toSuggestionItem(row('i1', 'kimono'));
    expect(item.warmth).toBeGreaterThan(0);
    expect(item.category).toBe('kimono');
    expect(item.id).toBe('i1');
  });

  it('preserves ids and order through the list mapping', () => {
    const items = toSuggestionItems([row('a', 'top'), row('b', 'shoes'), row('c', 'outerwear')]);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('the mapped rows actually drive suggestItems correctly', () => {
  // The point of the adapter is that the heuristic becomes REACHABLE from stored rows.
  // These assert the end-to-end behaviour, which is what a screen depends on.
  const closet = [
    row('coat', 'outerwear'),
    row('tee', 'top'),
    row('jeans', 'bottom'),
    row('boots', 'shoes'),
  ];

  it('produces a wearable suggestion from real row shapes', () => {
    const result = suggestItems({ items: toSuggestionItems(closet), tempC: 20 });
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.items.length).toBeGreaterThan(0);
  });

  it('colder weather never lowers aggregate warmth (the heuristic property, via real rows)', () => {
    // This is suggestItems' documented monotonicity guarantee. It only holds if the
    // adapter's warmth values are non-negative — so this test grades the adapter through
    // the heuristic rather than trusting the mapping in isolation.
    const items = toSuggestionItems(closet);
    let previous = -1;
    for (const tempC of [30, 25, 20, 15, 10, 5, 0, -5, -10]) {
      const result = suggestItems({ items, tempC });
      const warmth = result.fallback ? 0 : aggregateWarmth(result.items);
      expect(warmth).toBeGreaterThanOrEqual(previous);
      previous = warmth;
    }
  });

  it('picks the coat first as it gets cold', () => {
    const result = suggestItems({ items: toSuggestionItems(closet), tempC: -5 });
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.items.map((i) => i.id)).toContain('coat');
  });

  it('falls back when nothing is clean, rather than suggesting a dirty garment', () => {
    const dirty = closet.map((r) => ({ ...r, availability: 'dirty' as const }));
    const result = suggestItems({ items: toSuggestionItems(dirty), tempC: 15 });
    expect(result.fallback).toBe(true);
    if (result.fallback) expect(result.reason).toBe('no_clean_items');
  });
});
