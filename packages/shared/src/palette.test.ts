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
import { COLOR_FAMILIES, type ColorFamily } from './harmony.js';
import { BoundaryParseError } from './parse.js';

// The wardrobe neutrals (harmony.ts NEUTRAL). Derived here rather than guessed: COLOR_FAMILIES is
// [...CHROMATIC, ...NEUTRAL] in wheel order, so dropping these leaves the chromatic wheel in its
// exact index order — the geometry paletteAffinity uses — without hardcoding a list that could
// drift from harmony.ts (an earlier hardcode had the wrong 12th family and silently broke).
const NEUTRALS: ReadonlySet<string> = new Set(['black', 'white', 'gray', 'beige', 'navy']);
const CHROMATIC_WHEEL: readonly ColorFamily[] = COLOR_FAMILIES.filter((f) => !NEUTRALS.has(f));

// The DOCUMENTED withinPalette law (palette.ts:43-47 + harmony.ts affinity table + threshold):
// withinPalette ⟺ affinity ≥ 0.75. The affinity table gives 1.0 (exact) / 0.75 (analogous, 1
// step) / lower beyond, and NEUTRAL_AFFINITY = 0.5 for any neutral involvement. Since 0.5 < 0.75:
//   - a NEUTRAL item is never within-palette (0.5),
//   - a chromatic item matched only against a chosen NEUTRAL is never within-palette (0.5),
//   - a chromatic item is within-palette iff it is 0 or 1 hue-step from some chosen CHROMATIC
//     family.
// This recomputes the expectation from the spec's geometry — NOT by calling paletteAffinity.
function expectedWithinPalette(itemFamily: ColorFamily | null, chosen: readonly ColorFamily[]): boolean {
  if (itemFamily === null || chosen.length === 0) return false;
  if (NEUTRALS.has(itemFamily)) return false; // NEUTRAL_AFFINITY 0.5 < 0.75 threshold
  const ii = CHROMATIC_WHEEL.indexOf(itemFamily);
  return chosen
    .filter((f) => !NEUTRALS.has(f))
    .some((c) => {
      const ci = CHROMATIC_WHEEL.indexOf(c);
      const raw = Math.abs(ii - ci);
      const dist = Math.min(raw, CHROMATIC_WHEEL.length - raw);
      return dist <= 1; // exact (0) or analogous (1) clears the 0.75 threshold
    });
}

// A valid family token — the swatch quiz emits these, and toColorFamily maps them to themselves.
const arbFamily: fc.Arbitrary<ColorFamily> = fc.constantFrom(...COLOR_FAMILIES);
// An item whose color is a real family token (so toColorFamily actually resolves it) or null.
const arbItem: fc.Arbitrary<PaletteItem> = fc.record({
  id: fc.uuid(),
  color: fc.option(arbFamily as fc.Arbitrary<string>, { nil: null }),
});
const arbItems = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: 20 });
// A profile of real family tokens — the discriminating input the old fc.string() never produced.
const arbProfile = fc.record({ hues: fc.array(arbFamily as fc.Arbitrary<string>) });

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

  it('withinPalette follows the graded law: exact OR analogous (≤1 hue-step) to a chosen chromatic family', () => {
    // NON-VACUOUS: colors and hues are drawn from real COLOR_FAMILIES (the old fc.string()
    // essentially never produced a valid family, so the discriminating analogous case — where
    // the graded impl says true but exact-membership says false — was never sampled and the
    // stale exact-membership oracle passed vacuously). The oracle here recomputes the expected
    // label from the spec's hue-step geometry (expectedWithinPalette), independent of the impl's
    // paletteAffinity code path.
    fc.assert(
      fc.property(arbItems, arbProfile, (items, paletteProfile) => {
        const chosen = paletteProfile.hues
          .map((h) => toColorFamily(h))
          .filter((f): f is ColorFamily => f !== null);
        const out = scorePalette({ items, paletteProfile });
        for (const [i, ann] of out.entries()) {
          const family = toColorFamily(items[i]!.color);
          expect(ann.withinPalette).toBe(expectedWithinPalette(family, chosen));
        }
      }),
    );
  });

  it('an ANALOGOUS item (1 hue-step off a chosen family) is within-palette — the exact case the stale oracle missed', () => {
    // 'orange' is one step from 'red' on the wheel → affinity 0.75 → withinPalette true, even
    // though orange is NOT a member of the profile. Exact-family-membership would call this
    // false; the graded contract calls it true. This is the concrete discriminator.
    const out = scorePalette({
      items: [
        { id: 'analogous', color: 'orange' },
        { id: 'exact', color: 'red' },
        { id: 'far', color: 'cyan' }, // complement of red → affinity ~0 → false
      ],
      paletteProfile: { hues: ['red'] },
    });
    expect(out.find((a) => a.id === 'exact')!.withinPalette).toBe(true);
    expect(out.find((a) => a.id === 'analogous')!.withinPalette).toBe(true);
    expect(out.find((a) => a.id === 'far')!.withinPalette).toBe(false);
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
