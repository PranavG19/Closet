// Oracle for the swatch-quiz result builder. The properties that matter: it is
// order-independent + idempotent (a stored palette must not depend on tap order), it drops
// anything that isn't a real family (a malformed caller can't poison the palette that later
// steers suggestions), and its output feeds scorePalette with the SAME vocabulary items are
// normalised to — so a chosen swatch actually matches. That last one is graded end-to-end
// through scorePalette, not asserted in isolation (a mirror would just re-check the token set).
import { describe, it, expect } from 'vitest';
import { paletteFromSwatches, isCompletePalette, SWATCH_FAMILIES } from './swatchQuiz.js';
import { COLOR_FAMILIES } from './harmony.js';
import { scorePalette } from './palette.js';

describe('paletteFromSwatches — deterministic, validated palette from tapped swatches', () => {
  it('is order-independent: tap order never changes the stored hues', () => {
    const a = paletteFromSwatches(['red', 'blue', 'green']);
    const b = paletteFromSwatches(['green', 'red', 'blue']);
    expect(a).toEqual(b);
  });

  it('dedups repeated taps (toggling a swatch on twice is one choice)', () => {
    expect(paletteFromSwatches(['red', 'red', 'blue']).hues).toEqual(
      paletteFromSwatches(['red', 'blue']).hues,
    );
  });

  it('is idempotent: re-running on its own output is a no-op', () => {
    const once = paletteFromSwatches(['pink', 'black', 'orange']);
    const twice = paletteFromSwatches([...once.hues]);
    expect(twice).toEqual(once);
  });

  it('drops any token that is not a recognised color family (never trusts a malformed input)', () => {
    const result = paletteFromSwatches(['red', 'turquoise', '', 'blue', '#ff0000']);
    // 'turquoise' / '' / a hex are not family tokens → dropped; only real families survive.
    expect(result.hues).toEqual(['red', 'blue']);
  });

  it('produces hues in the canonical SWATCH_FAMILIES order regardless of input order', () => {
    const result = paletteFromSwatches([...COLOR_FAMILIES].reverse());
    expect(result.hues).toEqual([...SWATCH_FAMILIES]);
  });

  it('SWATCH_FAMILIES is exactly the family vocabulary (no swatch the scorer cannot match)', () => {
    expect([...SWATCH_FAMILIES].sort()).toEqual([...COLOR_FAMILIES].sort());
  });
});

describe('isCompletePalette — an empty selection is not a palette', () => {
  it('rejects an empty selection', () => {
    expect(isCompletePalette(paletteFromSwatches([]))).toBe(false);
    expect(isCompletePalette(paletteFromSwatches(['not-a-color']))).toBe(false);
  });
  it('accepts any non-empty valid selection', () => {
    expect(isCompletePalette(paletteFromSwatches(['red']))).toBe(true);
  });
});

describe('the quiz result actually drives scorePalette (end-to-end, not a mirror)', () => {
  // The whole point of the quiz is that what she picks becomes what scorePalette matches.
  // A red item must land in-palette when she chose red, and out when she did not.
  it('an item whose family she chose is within palette; one she did not is not', () => {
    const { hues } = paletteFromSwatches(['red', 'blue']);
    const annotations = scorePalette({
      items: [
        { id: 'red-top', color: '#ff0000' }, // hex → red family
        { id: 'green-top', color: '#00ff00' }, // hex → green family, not chosen
      ],
      paletteProfile: { hues: [...hues] },
    });
    const byId = new Map(annotations.map((a) => [a.id, a.withinPalette]));
    expect(byId.get('red-top')).toBe(true);
    expect(byId.get('green-top')).toBe(false);
  });

  it('an empty palette puts nothing within palette (advisory stays silent)', () => {
    const { hues } = paletteFromSwatches([]);
    const annotations = scorePalette({
      items: [{ id: 'red-top', color: '#ff0000' }],
      paletteProfile: { hues: [...hues] },
    });
    expect(annotations[0]!.withinPalette).toBe(false);
  });
});
