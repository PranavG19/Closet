// Oracle for the hex/token → ColorFamily seam (D-003 Step 1). The independent signals:
// (1) canonical hexes at each family's centre angle are hand-derived and land in that
// family — a value the implementation did not compute; (2) fast-check totality — no
// input throws and every result is a family or null; (3) the lossy-but-honest contract
// (unknown/malformed → null, never a guess).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toColorFamily, toColorSignal, familySwatchHex } from './colorFamily.js';
import { COLOR_FAMILIES, isColorFamily } from './harmony.js';

describe('familySwatchHex — the quiz swatch represents its own family', () => {
  const CHROMATIC = ['red', 'orange', 'yellow', 'chartreuse', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'] as const;

  it('is total: every family yields a valid #rrggbb hex', () => {
    for (const family of COLOR_FAMILIES) {
      expect(familySwatchHex(family)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('a chromatic family’s swatch maps BACK to that same family (round-trip through toColorFamily)', () => {
    // The independent oracle: the swatch shown for "red" must itself be classified red by
    // the same geometry that buckets stored garment colours. If a swatch drifted off its
    // bucket centre this would fail — proving the swatch is not a hand-picked literal that
    // could disagree with what the palette scorer matches.
    for (const family of CHROMATIC) {
      expect(toColorFamily(familySwatchHex(family))).toBe(family);
    }
  });
});

describe('toColorFamily — token passthrough', () => {
  it('every canonical family token maps to itself (round-trip)', () => {
    for (const family of COLOR_FAMILIES) {
      expect(toColorFamily(family)).toBe(family);
    }
  });
});

describe('toColorFamily — hex quantisation to the 12-hue wheel', () => {
  // Pure-hue hexes at each family's CENTRE angle (HSL S=100% L=50%), hand-derived from
  // the additive wheel, not from the converter. red 0°, orange 30° ... pink 330°.
  const CENTRE_HEX: ReadonlyArray<readonly [string, string]> = [
    ['#ff0000', 'red'], // 0°
    ['#ff8000', 'orange'], // 30°
    ['#ffff00', 'yellow'], // 60°
    ['#80ff00', 'chartreuse'], // 90°
    ['#00ff00', 'green'], // 120°
    ['#00ff80', 'teal'], // 150°
    ['#00ffff', 'cyan'], // 180°
    ['#0080ff', 'azure'], // 210°
    ['#0000ff', 'blue'], // 240°
    ['#8000ff', 'violet'], // 270°
    ['#ff00ff', 'magenta'], // 300°
    ['#ff0080', 'pink'], // 330°
  ];

  it('a saturated hex at each family centre lands in that family', () => {
    for (const [hex, family] of CENTRE_HEX) {
      expect(toColorFamily(hex), `${hex} should be ${family}`).toBe(family);
    }
  });

  it('red owns the wrap-around bucket [345°, 15°) on both sides of 0°', () => {
    expect(toColorFamily('#ff0010')).toBe('red'); // ~356°, just below 360
    expect(toColorFamily('#ff1000')).toBe('red'); // ~4°, just above 0
  });

  it('low-saturation hexes are achromatic neutrals, split by lightness', () => {
    expect(toColorFamily('#000000')).toBe('black');
    expect(toColorFamily('#ffffff')).toBe('white');
    expect(toColorFamily('#808080')).toBe('gray');
    // A barely-saturated mid grey is still neutral, not a chromatic family.
    expect(toColorFamily('#7f8081')).toBe('gray');
  });

  it('a very dark saturated hue still reads black (value dominates the neutral cut)', () => {
    expect(toColorFamily('#0a0500')).toBe('black');
  });
});

describe('toColorFamily — honest null contract (never a guess, never a throw)', () => {
  it('returns null for an unmodelled colour name', () => {
    expect(toColorFamily('turquoise')).toBeNull();
    expect(toColorFamily('rebeccapurple')).toBeNull();
  });

  it('returns null for malformed / non-canonical hex', () => {
    expect(toColorFamily('#fff')).toBeNull(); // short hex — schema is #rrggbb only
    expect(toColorFamily('#FF0000')).toBeNull(); // uppercase — schema is lowercase
    expect(toColorFamily('ff0000')).toBeNull(); // missing #
    expect(toColorFamily('')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(toColorFamily(null)).toBeNull();
    expect(toColorFamily(undefined)).toBeNull();
  });
});

describe('toColorSignal — emits family + lightness + chroma (A1), agreeing with toColorFamily', () => {
  it('family agrees with toColorFamily for every input (one classifier, two views)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const signal = toColorSignal(s);
        expect(signal?.family ?? null).toBe(toColorFamily(s));
      }),
    );
  });

  it('a bare token carries NO geometry (lightness/chroma null — never a fabricated axis)', () => {
    for (const family of COLOR_FAMILIES) {
      const signal = toColorSignal(family);
      expect(signal).not.toBeNull();
      expect(signal!.lightness).toBeNull();
      expect(signal!.chroma).toBeNull();
    }
  });

  it('a #rrggbb hex yields both axes in [0,1]', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })),
        ([r, g, b]) => {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const signal = toColorSignal(hex);
          expect(signal).not.toBeNull();
          // HSL L is exact in [0,1]; HSL saturation is mathematically in [0,1] but the
          // division can float over by an epsilon (e.g. #9494ff → 1.0000000002), so allow a
          // tiny tolerance rather than pretend the raw converter clamps.
          const EPS = 1e-9;
          expect(signal!.lightness!).toBeGreaterThanOrEqual(0);
          expect(signal!.lightness!).toBeLessThanOrEqual(1);
          expect(signal!.chroma!).toBeGreaterThanOrEqual(0);
          expect(signal!.chroma!).toBeLessThanOrEqual(1 + EPS);
        },
      ),
    );
  });

  it('a known light vs dark hex differ in emitted lightness (the axis A1 gates on is real)', () => {
    const dark = toColorSignal('#400000'); // dark red
    const light = toColorSignal('#ff8080'); // light red
    expect(dark!.lightness!).toBeLessThan(light!.lightness!);
  });

  it('unknown/malformed → null, same honest contract as toColorFamily', () => {
    expect(toColorSignal('turquoise')).toBeNull();
    expect(toColorSignal('#fff')).toBeNull();
    expect(toColorSignal(null)).toBeNull();
    expect(toColorSignal(undefined)).toBeNull();
  });
});

describe('toColorFamily — totality (fast-check: no input throws, result is family|null)', () => {
  it('every string yields a valid ColorFamily or null, never a throw', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = toColorFamily(s);
        expect(result === null || isColorFamily(result)).toBe(true);
      }),
    );
  });

  it('every well-formed #rrggbb hex yields a family (never null — a colour always has one)', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })),
        ([r, g, b]) => {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const result = toColorFamily(hex);
          expect(result !== null && isColorFamily(result)).toBe(true);
        },
      ),
    );
  });
});
