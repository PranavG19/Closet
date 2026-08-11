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
import { toColorFamily } from './colorFamily.js';
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

  it('withinPalette is true exactly when the item color FAMILY is in the profile families', () => {
    // The rule is now family-normalised (D-003 Step 2), not raw-string equality: both
    // the item color and the profile hues go through toColorFamily, so a hex item can
    // match a family-token quiz answer. This property mirrors the implementation's
    // oracle independently (recomputing via toColorFamily here would be a mirror, so it
    // is stated as the family-membership law).
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const profileFamilies = new Set(
          paletteProfile.hues.map((h) => toColorFamily(h)).filter((f): f is NonNullable<typeof f> => f !== null),
        );
        const out = scorePalette({ items, paletteProfile });
        for (const [i, ann] of out.entries()) {
          const family = toColorFamily(items[i]!.color);
          expect(ann.withinPalette).toBe(family !== null && profileFamilies.has(family));
        }
      }),
    );
  });

  it('THE FIX: a hex-stored item matches a family-token quiz answer (was silently always false)', () => {
    // The concrete bug D-003 Step 2 closes. Before family-normalisation, a red garment
    // stored as '#ff0000' never matched a quiz that selected the token 'red' — the hex
    // and token vocabularies never intersected under raw-string equality, so every
    // hex item read as off-palette. Now it matches.
    const out = scorePalette({
      items: [
        { id: 'a', color: '#ff0000' }, // red hex
        { id: 'b', color: '#00ff00' }, // green hex — NOT in the profile
      ],
      paletteProfile: { hues: ['red', 'pink'] }, // family tokens from the swatch quiz
    });
    expect(out.find((a) => a.id === 'a')!.withinPalette).toBe(true);
    expect(out.find((a) => a.id === 'b')!.withinPalette).toBe(false);
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
