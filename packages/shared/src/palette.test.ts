// Tier-1 (docs/05): property tests for B1 palette scoring — advisory-never-blocks.
// Oracle = length/id-set preservation over generated items + profiles.
//
// RED-FIRST NOTE (task-08 §5): the advisory law was first run against a stub that
// FILTERED to within-palette items (`.filter(a => a.withinPalette)`). The
// length-and-id-set-preservation property FAILED (fast-check produced off-palette
// items that vanished). The real annotate-only scorePalette then turned it green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scorePalette, type PaletteItem } from './palette.js';
import { BoundaryParseError } from './parse.js';

const arbItem: fc.Arbitrary<PaletteItem> = fc.record({
  id: fc.uuid(),
  color: fc.option(fc.string(), { nil: null }),
});
const arbItems = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: 20 });
const arbProfile = fc.record({ hues: fc.array(fc.string()) });

describe('B1 palette — advisory-never-blocks', () => {
  it('output length equals input length; id-set preserved (nothing dropped/hidden)', () => {
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const out = scorePalette({ items, paletteProfile });
        expect(out.length).toBe(items.length);
        expect(new Set(out.map((a) => a.id))).toEqual(new Set(items.map((i) => i.id)));
      }),
    );
  });

  it('preserves input order (pure annotation, no reorder-away)', () => {
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const out = scorePalette({ items, paletteProfile });
        expect(out.map((a) => a.id)).toEqual(items.map((i) => i.id));
      }),
    );
  });

  it('withinPalette is true exactly when the item color is in the hue set', () => {
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const hueSet = new Set(paletteProfile.hues);
        const out = scorePalette({ items, paletteProfile });
        for (const [i, ann] of out.entries()) {
          const color = items[i]!.color;
          expect(ann.withinPalette).toBe(color !== null && hueSet.has(color));
        }
      }),
    );
  });

  it('empty items → empty annotations (well-formed, not an error)', () => {
    expect(scorePalette({ items: [], paletteProfile: { hues: [] } })).toEqual([]);
  });

  it('determinism: same input twice → identical output', () => {
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const a = scorePalette({ items, paletteProfile });
        const b = scorePalette({ items, paletteProfile });
        expect(a).toEqual(b);
      }),
    );
  });

  it('rejects malformed input at the boundary', () => {
    expect(() => scorePalette({ items: [{ id: 'x' }], paletteProfile: { hues: [] } })).toThrow(
      BoundaryParseError,
    );
    expect(() => scorePalette({ items: [], paletteProfile: {} })).toThrow(BoundaryParseError);
  });
});
