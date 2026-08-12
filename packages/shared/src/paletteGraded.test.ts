// A3 + A4 (docs/research/color-theory.md §5, next-waves-roadmap) — the GRADED palette:
// scorePalette moved from a binary {0,1} family-membership to a hue-distance affinity, and
// suggestItems now re-ranks equal-warmth items by that graded affinity. These are the
// metamorphic properties the grading INTRODUCES — the invariants the pre-existing
// palette/suggestion suites already lock (advisory-never-blocks, warmth monotonicity,
// id-multiset, purity) are unchanged and still guard those files; this file only adds the
// new claims. Oracles are structural (distance ordering, multiset equality), not a recomputed
// mirror of the scorer.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scorePalette } from './palette.js';
import { suggestItems, type SuggestionItem } from './suggestion.js';
import { paletteAffinity, hueDistance, COLOR_FAMILIES, type ColorFamily } from './harmony.js';
import { familySwatchHex } from './colorFamily.js';

const CHROMATIC: ColorFamily[] = [
  'red', 'orange', 'yellow', 'chartreuse', 'green', 'teal',
  'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink',
];

describe('A3 — paletteAffinity: graded by hue distance, bounded, advisory', () => {
  it('is bounded in [0,1] for every family against every single-family palette', () => {
    for (const item of COLOR_FAMILIES) {
      for (const chosen of COLOR_FAMILIES) {
        const a = paletteAffinity(item, [chosen]);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('an exact family match scores 1.0; an empty palette scores 0', () => {
    expect(paletteAffinity('red', ['red'])).toBe(1);
    expect(paletteAffinity('red', [])).toBe(0);
  });

  it('MONOTONE: a chromatic family nearer a chosen hue never scores lower than a farther one', () => {
    // For a fixed single chosen chromatic family, affinity is non-increasing in hue distance.
    fc.assert(
      fc.property(fc.constantFrom(...CHROMATIC), fc.constantFrom(...CHROMATIC), fc.constantFrom(...CHROMATIC), (chosen, x, y) => {
        const dx = hueDistance(x, chosen);
        const dy = hueDistance(y, chosen);
        if (dx < dy) {
          expect(paletteAffinity(x, [chosen])).toBeGreaterThanOrEqual(paletteAffinity(y, [chosen]));
        }
      }),
    );
  });

  it('an analogous colour (1 step) outranks its complement (6 steps) — the whole point of grading', () => {
    // red palette: orange (1 step) must score strictly above cyan (6 steps, the complement).
    expect(paletteAffinity('orange', ['red'])).toBeGreaterThan(paletteAffinity('cyan', ['red']));
  });

  it('adding a family to the palette never LOWERS any item affinity (nearest-wins is monotone in the set)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COLOR_FAMILIES),
        fc.array(fc.constantFrom(...COLOR_FAMILIES), { maxLength: 5 }),
        fc.constantFrom(...COLOR_FAMILIES),
        (item, base, extra) => {
          const before = paletteAffinity(item, base);
          const after = paletteAffinity(item, [...base, extra]);
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });
});

describe('A3 — scorePalette grades a hex by nearness (not binary), still advisory', () => {
  it('a hex one step off a chosen family scores between the exact match and the complement', () => {
    // Palette = red. Compare red hex (exact) vs orange hex (analogous) vs cyan hex (complement).
    const items = [
      { id: 'exact', color: familySwatchHex('red') },
      { id: 'near', color: familySwatchHex('orange') },
      { id: 'far', color: familySwatchHex('cyan') },
    ];
    const out = scorePalette({ items, paletteProfile: { hues: ['red'] } });
    const byId = new Map(out.map((a) => [a.id, a.score]));
    expect(byId.get('exact')!).toBeGreaterThan(byId.get('near')!);
    expect(byId.get('near')!).toBeGreaterThan(byId.get('far')!);
    // Advisory: every id preserved regardless of score (the pre-existing suite proves this
    // over random input; this is the concrete graded case).
    expect(out).toHaveLength(3);
  });
});

// ---- A4: the graded affinity drives the equal-warmth re-rank in suggestItems ----------
const warmT = 25; // warm enough that targetLayerCount = 1 (single pick), isolating the tie-break

describe('A4 — suggestItems re-ranks equal-warmth items by graded affinity', () => {
  it('among equal-warmth clean items, the ANALOGOUS colour is picked over the complement', () => {
    // palette = red. Three equal-warmth tops: orange (analogous, 1 step), cyan (complement),
    // blue (distant). The analogous one must be the single pick — binary membership could not
    // distinguish these (none is an EXACT red), so this is behaviour only grading produces.
    const items: SuggestionItem[] = [
      { id: 'cyan-top', status: 'clean', warmth: 2, category: 'top', colorFamily: 'cyan' },
      { id: 'blue-top', status: 'clean', warmth: 2, category: 'top', colorFamily: 'blue' },
      { id: 'orange-top', status: 'clean', warmth: 2, category: 'top', colorFamily: 'orange' },
    ];
    const res = suggestItems({ items, tempC: warmT, paletteFamilies: ['red'] });
    expect(res.fallback).toBe(false);
    if (!res.fallback) expect(res.items[0]!.id).toBe('orange-top');
  });

  it('METAMORPHIC: toggling the palette changes at most ORDERING, never the selected id-multiset size', () => {
    const arbItem = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom('clean' as const, 'dirty' as const, 'unavailable' as const),
      warmth: fc.integer({ min: 0, max: 5 }),
      category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
      colorFamily: fc.option(fc.constantFrom(...CHROMATIC), { nil: null }),
    });
    const arbItems = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: 12 });
    const arbPalette = fc.array(fc.constantFrom(...CHROMATIC), { maxLength: 4 });
    fc.assert(
      fc.property(arbItems, fc.integer({ min: -5, max: 35 }), arbPalette, (items, tempC, paletteFamilies) => {
        const without = suggestItems({ items, tempC });
        const with_ = suggestItems({ items, tempC, paletteFamilies });
        // Same fallback status and same NUMBER of picks — colour never adds/removes an item.
        expect(with_.fallback).toBe(without.fallback);
        if (!without.fallback && !with_.fallback) {
          expect(with_.items.length).toBe(without.items.length);
          // And the two selections have identical aggregate warmth (re-rank is within-tier).
          const sum = (xs: readonly SuggestionItem[]): number => xs.reduce((s, i) => s + i.warmth, 0);
          expect(sum(with_.items)).toBe(sum(without.items));
        }
      }),
    );
  });
});
