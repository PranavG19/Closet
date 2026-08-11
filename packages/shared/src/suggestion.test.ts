// Tier-1 (docs/05): property tests for F5 suggestion — the four safety laws:
// never-dirty, always-fallback, warmth-monotonicity, and (composed) advisory-
// never-blocks. Oracle = invariants over adversarially-mixed generated wardrobes.
//
// RED-FIRST NOTE (task-08 §5): each law was first run against a broken stub —
// (a) a selector that skipped the status filter → never-dirty FAILED;
// (b) a selector returning `{items:[]}` on zero-clean → always-fallback FAILED;
// (c) a fixed top-1 selector ignoring tempC → warmth-monotonicity FAILED as
// fast-check found a colder temp with lower aggregate warmth. The real
// suggestItems then turned all four green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  suggestItems,
  aggregateWarmth,
  type SuggestionItem,
} from './suggestion.js';
import { scorePalette } from './palette.js';
import { BoundaryParseError } from './parse.js';

const arbStatus = fc.constantFrom('clean' as const, 'dirty' as const, 'unavailable' as const);
const arbItem: fc.Arbitrary<SuggestionItem> = fc.record({
  id: fc.uuid(),
  status: arbStatus,
  warmth: fc.integer({ min: 0, max: 10 }),
  category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
});
// unique ids so id-set assertions are meaningful.
const arbWardrobe = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: 12 });
const arbTemp = fc.integer({ min: -30, max: 45 });

describe('F5 law 1 — never-dirty / always-available', () => {
  it('every selected item is clean', () => {
    fc.assert(
      fc.property(arbWardrobe, arbTemp, (items, tempC) => {
        const result = suggestItems({ items, tempC });
        if (!result.fallback) {
          for (const it of result.items) expect(it.status).toBe('clean');
        }
      }),
    );
  });
});

describe('F5 law 2 — always-fallback / never-empty-broken', () => {
  it('≥1 clean item → non-empty, no fallback flag; 0 clean → defined fallback', () => {
    fc.assert(
      fc.property(arbWardrobe, arbTemp, (items, tempC) => {
        const cleanCount = items.filter((i) => i.status === 'clean').length;
        const result = suggestItems({ items, tempC });
        if (cleanCount > 0) {
          expect(result.fallback).toBe(false);
          expect(result.items.length).toBeGreaterThan(0);
        } else {
          expect(result.fallback).toBe(true);
          if (result.fallback) {
            expect(result.reason.length).toBeGreaterThan(0);
            expect(result.items).toEqual([]);
          }
        }
      }),
    );
  });

  it('empty wardrobe → fallback with reason', () => {
    const result = suggestItems({ items: [], tempC: 10 });
    expect(result.fallback).toBe(true);
    if (result.fallback) expect(result.reason).toBe('no_clean_items');
  });
});

describe('F5 law 3 — warmth monotonicity (colder never lowers aggregate warmth)', () => {
  it('∀ wardrobe, t1 < t2 ⇒ aggWarmth(suggest(t1)) ≥ aggWarmth(suggest(t2))', () => {
    fc.assert(
      fc.property(arbWardrobe, arbTemp, arbTemp, (items, ta, tb) => {
        const t1 = Math.min(ta, tb);
        const t2 = Math.max(ta, tb);
        const colder = suggestItems({ items, tempC: t1 });
        const warmer = suggestItems({ items, tempC: t2 });
        const wc = colder.fallback ? 0 : aggregateWarmth([...colder.items]);
        const ww = warmer.fallback ? 0 : aggregateWarmth([...warmer.items]);
        expect(wc).toBeGreaterThanOrEqual(ww);
      }),
    );
  });
});

describe('F5 law 4 (composed) — advisory-never-blocks', () => {
  it('the sole clean candidate is selected regardless of palette membership', () => {
    fc.assert(
      fc.property(arbItem, fc.array(fc.uuid()), (baseItem, hues) => {
        // exactly one clean item, made off-palette by construction (color not in hues).
        const cleanItem: SuggestionItem = { ...baseItem, status: 'clean', id: 'sole-clean' };
        const items = [cleanItem];
        const result = suggestItems({ items, tempC: 5 });
        expect(result.fallback).toBe(false);
        if (!result.fallback) {
          expect(result.items.map((i) => i.id)).toContain('sole-clean');
        }
        // palette scoring annotates but never removes the item.
        const annotations = scorePalette({
          items: [{ id: 'sole-clean', color: 'off-palette-color' }],
          paletteProfile: { hues },
        });
        expect(annotations.map((a) => a.id)).toEqual(['sole-clean']);
      }),
    );
  });
});

describe('F5 law 5 — palette is a WITHIN-TIER tie-break, never a filter, never breaks weather (D-003 Step 3)', () => {
  // Items that carry a colorFamily so the tie-break can engage.
  const arbColorItem: fc.Arbitrary<SuggestionItem> = fc.record({
    id: fc.uuid(),
    status: arbStatus,
    warmth: fc.integer({ min: 0, max: 10 }),
    category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
    colorFamily: fc.constantFrom('red', 'blue', 'green', 'black', 'pink', null),
  });
  const arbColorWardrobe = fc.uniqueArray(arbColorItem, { selector: (i) => i.id, maxLength: 12 });
  const arbPalette = fc.array(fc.constantFrom('red', 'blue', 'green', 'black', 'pink'), { maxLength: 5 });

  it('a palette NEVER changes which items are eligible — count is identical with and without it', () => {
    // The core safety law the critique demanded: palette may reorder, never filter. The
    // number selected is a function of tempC + clean-count ONLY, so it cannot change when a
    // palette is added. (Membership can differ only WITHIN a warmth tier, tested below.)
    fc.assert(
      fc.property(arbColorWardrobe, arbTemp, arbPalette, (items, tempC, paletteFamilies) => {
        const without = suggestItems({ items, tempC });
        const withPalette = suggestItems({ items, tempC, paletteFamilies });
        const nWithout = without.fallback ? 0 : without.items.length;
        const nWith = withPalette.fallback ? 0 : withPalette.items.length;
        expect(nWith).toBe(nWithout);
        expect(withPalette.fallback).toBe(without.fallback);
      }),
    );
  });

  it('weather monotonicity STILL holds with a palette applied (tie-break never crosses tiers)', () => {
    fc.assert(
      fc.property(arbColorWardrobe, arbTemp, arbTemp, arbPalette, (items, ta, tb, paletteFamilies) => {
        const t1 = Math.min(ta, tb);
        const t2 = Math.max(ta, tb);
        const colder = suggestItems({ items, tempC: t1, paletteFamilies });
        const warmer = suggestItems({ items, tempC: t2, paletteFamilies });
        const wc = colder.fallback ? 0 : aggregateWarmth([...colder.items]);
        const ww = warmer.fallback ? 0 : aggregateWarmth([...warmer.items]);
        expect(wc).toBeGreaterThanOrEqual(ww);
      }),
    );
  });

  it('adding a palette never lowers the aggregate warmth of the selection (same tier, same sum)', () => {
    // Because the tie-break only reorders EQUAL-warmth items, the aggregate warmth of the
    // selected prefix is invariant to the palette — proving the reorder is warmth-neutral.
    fc.assert(
      fc.property(arbColorWardrobe, arbTemp, arbPalette, (items, tempC, paletteFamilies) => {
        const without = suggestItems({ items, tempC });
        const withPalette = suggestItems({ items, tempC, paletteFamilies });
        const wWithout = without.fallback ? 0 : aggregateWarmth([...without.items]);
        const wWith = withPalette.fallback ? 0 : aggregateWarmth([...withPalette.items]);
        expect(wWith).toBe(wWithout);
      }),
    );
  });

  it('CONCRETE: among equal-warmth items, an in-palette one is preferred (the actual behavior)', () => {
    // Two equal-warmth clean tops, one red (in palette) one blue (not). tempC warm enough
    // to want exactly 1 layer, so only the preferred one is selected.
    const items: SuggestionItem[] = [
      { id: 'blue-top', status: 'clean', warmth: 2, category: 'top', colorFamily: 'blue' },
      { id: 'red-top', status: 'clean', warmth: 2, category: 'top', colorFamily: 'red' },
    ];
    const withPalette = suggestItems({ items, tempC: 25, paletteFamilies: ['red'] });
    expect(withPalette.fallback).toBe(false);
    if (!withPalette.fallback) expect(withPalette.items[0]!.id).toBe('red-top');
    // Without a palette, the id tie-break wins (blue-top < red-top), so the palette
    // demonstrably changed the WITHIN-TIER order — not vacuous.
    const without = suggestItems({ items, tempC: 25 });
    if (!without.fallback) expect(without.items[0]!.id).toBe('blue-top');
  });
});

describe('purity + malformed input', () => {
  it('same input twice → byte-identical output', () => {
    fc.assert(
      fc.property(arbWardrobe, arbTemp, (items, tempC) => {
        const a = suggestItems({ items, tempC });
        const b = suggestItems({ items, tempC });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
    );
  });

  it('does not mutate the input array', () => {
    const items: SuggestionItem[] = [
      { id: 'a', status: 'clean', warmth: 1, category: 'top' },
      { id: 'b', status: 'clean', warmth: 5, category: 'outerwear' },
    ];
    const snapshot = JSON.stringify(items);
    suggestItems({ items, tempC: -10 });
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it('rejects malformed input at the boundary (missing tempC / unknown status)', () => {
    expect(() => suggestItems({ items: [] })).toThrow(BoundaryParseError);
    expect(() =>
      suggestItems({ items: [{ id: 'x', status: 'soggy', warmth: 1, category: 'top' }], tempC: 10 }),
    ).toThrow(BoundaryParseError);
  });
});
