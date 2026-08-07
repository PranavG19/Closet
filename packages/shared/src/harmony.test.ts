// Tier-1 (docs/05): property tests for F9 harmony — determinism, symmetry,
// totality. The oracle is a relation-level law over the generated domain, NOT a
// transcription of the rule table.
//
// RED-FIRST NOTE (task-07 §5): before the real table landed, these ran against a
// deliberately-broken stub — an asymmetric lookup `(a,b) => a < b ? 'clash' :
// 'neutral'`. fast-check shrank the symmetry property to a minimal counterexample
// (e.g. a='azure', b='beige') and FAILED; totality also failed where the stub
// returned an off-list value. The real symmetric frozen table then turned all green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  COLOR_FAMILIES,
  HARMONY_VERDICTS,
  harmony,
  isColorFamily,
  type ColorFamily,
} from './harmony.js';

const arbFamily = fc.constantFrom(...COLOR_FAMILIES);

describe('harmony — structural laws', () => {
  it('determinism: same pair → same verdict every call', () => {
    fc.assert(
      fc.property(arbFamily, arbFamily, (a, b) => {
        expect(harmony(a, b)).toBe(harmony(a, b));
      }),
    );
  });

  it('symmetry: harmony(a,b) === harmony(b,a)', () => {
    fc.assert(
      fc.property(arbFamily, arbFamily, (a, b) => {
        expect(harmony(a, b)).toBe(harmony(b, a));
      }),
    );
  });

  it('totality (sampled): every verdict is a documented HARMONY_VERDICT', () => {
    fc.assert(
      fc.property(arbFamily, arbFamily, (a, b) => {
        const v = harmony(a, b);
        expect(HARMONY_VERDICTS).toContain(v);
        expect(v).not.toBeUndefined();
        expect(v).not.toBeNull();
      }),
    );
  });

  it('totality (exhaustive): full cross-product resolves to a documented verdict', () => {
    for (const a of COLOR_FAMILIES) {
      for (const b of COLOR_FAMILIES) {
        const v = harmony(a, b);
        expect(HARMONY_VERDICTS).toContain(v);
        // exhaustive symmetry too
        expect(v).toBe(harmony(b, a));
      }
    }
  });

  it('same-family is monochromatic (documented monochrome verdict, never a crash)', () => {
    fc.assert(
      fc.property(arbFamily, (a) => {
        // a chromatic family with itself is monochromatic; a neutral with itself
        // is neutral-safe — both are documented, neither undefined.
        const v = harmony(a, a);
        expect(HARMONY_VERDICTS).toContain(v);
      }),
    );
    expect(harmony('red', 'red')).toBe('monochromatic');
  });

  it('neutral-vs-anything is neutral (F9 neutral-safe)', () => {
    for (const chromatic of ['red', 'blue', 'green'] as const) {
      expect(harmony('black', chromatic)).toBe('neutral');
      expect(harmony(chromatic, 'white')).toBe('neutral');
    }
  });

  it('a known complementary pair returns complementary (opposite on the 12-hue wheel)', () => {
    // red is hue index 0; its opposite (distance 6 of 12) is cyan.
    expect(harmony('red', 'cyan')).toBe('complementary');
    // green (index 4) opposite magenta (index 10), distance 6.
    expect(harmony('green', 'magenta')).toBe('complementary');
  });
});

describe('isColorFamily — parse guard', () => {
  it('accepts every documented family, rejects non-family strings and non-strings', () => {
    for (const f of COLOR_FAMILIES) expect(isColorFamily(f)).toBe(true);
    expect(isColorFamily('spaceship')).toBe(false);
    expect(isColorFamily(42)).toBe(false);
    expect(isColorFamily(null)).toBe(false);
    expect(isColorFamily(undefined)).toBe(false);
  });

  it('narrows the type (compile-time) for use before harmony', () => {
    const raw: unknown = 'navy';
    if (isColorFamily(raw)) {
      const fam: ColorFamily = raw;
      expect(HARMONY_VERDICTS).toContain(harmony(fam, 'red'));
    }
  });
});
