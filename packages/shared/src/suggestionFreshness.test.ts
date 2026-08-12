// F5 freshness tie-break — suggestItems now takes an optional recentlyWornIds set and, among
// items EQUAL on warmth AND palette affinity, prefers one NOT recently worn (so today's look
// isn't yesterday's exact pieces). These are the metamorphic properties the tie-break
// INTRODUCES; the pre-existing weather/monotonicity/never-filters invariants are unchanged and
// still guarded by suggestion.test.ts. Oracles are structural (multiset/warmth equality, pick
// position), never a recomputed mirror of the sort.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { suggestItems, type SuggestionItem } from './suggestion.js';

const warmT = 25; // targetLayerCount = 1 (single pick), isolating the tie-break to one slot

describe('F5 freshness — recentlyWornIds is a within-tier tie-break, never a filter', () => {
  it('among equal-warmth equal-palette items, a NOT-recently-worn one is picked over a recent one', () => {
    // Two identical-warmth tops, no palette signal → they tie on warmth AND affinity, so the
    // ONLY thing that can separate them is freshness. 'worn' is recent; 'fresh' is not.
    const items: SuggestionItem[] = [
      { id: 'worn', status: 'clean', warmth: 2, category: 'top', colorFamily: null },
      { id: 'fresh', status: 'clean', warmth: 2, category: 'top', colorFamily: null },
    ];
    const res = suggestItems({ items, tempC: warmT, recentlyWornIds: ['worn'] });
    expect(res.fallback).toBe(false);
    if (!res.fallback) expect(res.items[0]!.id).toBe('fresh');
  });

  it('RED-FIRST: without the freshness signal the pick falls to id order (proves the signal bites)', () => {
    // Same two items; 'fresh' > 'worn' by id, so id-order alone would pick 'fresh' too — flip
    // the ids so id-order would pick the WORN one, and prove freshness overrides it.
    const items: SuggestionItem[] = [
      { id: 'a-worn', status: 'clean', warmth: 2, category: 'top', colorFamily: null },
      { id: 'z-fresh', status: 'clean', warmth: 2, category: 'top', colorFamily: null },
    ];
    // No freshness: id order picks 'a-worn' (lexicographically first).
    const plain = suggestItems({ items, tempC: warmT });
    expect(plain.fallback).toBe(false);
    if (!plain.fallback) expect(plain.items[0]!.id).toBe('a-worn');
    // With freshness marking 'a-worn' recent: the fresh 'z-fresh' overrides id order.
    const withFresh = suggestItems({ items, tempC: warmT, recentlyWornIds: ['a-worn'] });
    expect(withFresh.fallback).toBe(false);
    if (!withFresh.fallback) expect(withFresh.items[0]!.id).toBe('z-fresh');
  });

  it('NEVER a filter: a recently-worn item is still picked when it is the only clean option', () => {
    const items: SuggestionItem[] = [
      { id: 'only', status: 'clean', warmth: 2, category: 'top', colorFamily: null },
    ];
    const res = suggestItems({ items, tempC: warmT, recentlyWornIds: ['only'] });
    expect(res.fallback).toBe(false);
    if (!res.fallback) expect(res.items[0]!.id).toBe('only');
  });

  it('freshness NEVER crosses a warmth tier: a warmer recently-worn item still outranks a cooler fresh one', () => {
    // A cold day wants layers; the warm coat was worn yesterday but must STILL be selected
    // before a cooler fresh tee — freshness only reorders WITHIN equal warmth.
    const items: SuggestionItem[] = [
      { id: 'warm-coat-worn', status: 'clean', warmth: 5, category: 'outerwear', colorFamily: null },
      { id: 'cool-tee-fresh', status: 'clean', warmth: 1, category: 'top', colorFamily: null },
    ];
    const res = suggestItems({ items, tempC: -5, recentlyWornIds: ['warm-coat-worn'] });
    expect(res.fallback).toBe(false);
    if (!res.fallback) expect(res.items[0]!.id).toBe('warm-coat-worn');
  });

  it('METAMORPHIC: adding recentlyWornIds changes at most ORDERING — never pick count or aggregate warmth', () => {
    const arbItem = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom('clean' as const, 'dirty' as const, 'unavailable' as const),
      warmth: fc.integer({ min: 0, max: 5 }),
      category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
      colorFamily: fc.constant(null),
    });
    const arbItems = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: 12 });
    fc.assert(
      fc.property(arbItems, fc.integer({ min: -5, max: 35 }), (items, tempC) => {
        // Mark a subset (every other item) as recently worn.
        const recentlyWornIds = items.filter((_, i) => i % 2 === 0).map((i) => i.id);
        const without = suggestItems({ items, tempC });
        const with_ = suggestItems({ items, tempC, recentlyWornIds });
        expect(with_.fallback).toBe(without.fallback);
        if (!without.fallback && !with_.fallback) {
          expect(with_.items.length).toBe(without.items.length);
          const sum = (xs: readonly SuggestionItem[]): number => xs.reduce((s, i) => s + i.warmth, 0);
          expect(sum(with_.items)).toBe(sum(without.items));
        }
      }),
    );
  });
});
