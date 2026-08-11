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
  harmonyWithChroma,
  isColorFamily,
  type ColorFamily,
} from './harmony.js';

const arbFamily = fc.constantFrom(...COLOR_FAMILIES);
const arbChroma = fc.oneof(fc.constant(null), fc.float({ min: 0, max: 1, noNaN: true }));

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

  // CHROMATIC index order: red0 orange1 yellow2 chartreuse3 green4 teal5 cyan6 azure7
  // blue8 violet9 magenta10 pink11. One step = 30°. These four cases pin the verdicts the
  // first cut collapsed into 'clash'; before naming distances 4 and 5 they returned
  // 'clash', so this discriminates the change rather than passing vacuously.
  it('distance 4 (120°) is triadic — an established even-spaced harmony, not a clash', () => {
    expect(harmony('red', 'green')).toBe('triadic'); // |0-4| = 4
    expect(harmony('orange', 'teal')).toBe('triadic'); // |1-5| = 4
  });

  it('distance 5 (150°) is split-complementary — the softer contrast, not a clash', () => {
    expect(harmony('red', 'teal')).toBe('split-complementary'); // |0-5| = 5
    expect(harmony('yellow', 'azure')).toBe('split-complementary'); // |2-7| = 5
  });

  it('distances 2 (60°) and 3 (90°) remain clash — genuinely weaker pairings', () => {
    expect(harmony('red', 'yellow')).toBe('clash'); // |0-2| = 2
    expect(harmony('red', 'chartreuse')).toBe('clash'); // |0-3| = 3
  });
});

describe('harmonyWithChroma — chroma is a one-way valve OUT of clash (A2)', () => {
  // The oracle is a metamorphic RELATION, not a transcription: whatever the hue table says,
  // adding chroma information may only ever move a verdict OUT of clash, never into it.

  it('METAMORPHIC: lowering a pair\'s chroma can only move it OUT of clash, never into it', () => {
    fc.assert(
      fc.property(arbFamily, arbFamily, arbChroma, arbChroma, arbChroma, arbChroma, (a, b, ca, cb, ca2, cb2) => {
        // Two chroma readings for the same family pair. Whichever is "lower", the verdict at
        // the lower reading may differ from the higher ONLY by being non-clash where the
        // higher was clash. It may NEVER be clash where the higher reading was non-clash.
        const hi = harmonyWithChroma(a, b, Math.max(ca ?? 1, ca2 ?? 1), Math.max(cb ?? 1, cb2 ?? 1));
        const lo = harmonyWithChroma(a, b, Math.min(ca ?? 1, ca2 ?? 1), Math.min(cb ?? 1, cb2 ?? 1));
        if (hi !== 'clash') expect(lo).not.toBe('clash'); // lower chroma never CREATES a clash
      }),
    );
  });

  it('never rewrites a non-clash verdict — only clash → neutral is ever possible', () => {
    fc.assert(
      fc.property(arbFamily, arbFamily, arbChroma, arbChroma, (a, b, ca, cb) => {
        const base = harmony(a, b);
        const adjusted = harmonyWithChroma(a, b, ca, cb);
        if (base !== 'clash') {
          expect(adjusted).toBe(base); // untouched
        } else {
          expect(adjusted === 'clash' || adjusted === 'neutral').toBe(true); // only ever softened
        }
      }),
    );
  });

  it('REGRESSION: with unknown chroma (both null) it is exactly harmony() for every pair', () => {
    for (const a of COLOR_FAMILIES) {
      for (const b of COLOR_FAMILIES) {
        expect(harmonyWithChroma(a, b, null, null)).toBe(harmony(a, b));
      }
    }
  });

  it('a muted garment rescues a real clashing pair into neutral-safe', () => {
    expect(harmony('red', 'yellow')).toBe('clash'); // distance-2 clash
    // one side muted (chroma below the muted ceiling) → neutral, never a clash/scold
    expect(harmonyWithChroma('red', 'yellow', 0.1, 0.9)).toBe('neutral');
    expect(harmonyWithChroma('red', 'yellow', 0.9, 0.1)).toBe('neutral');
    // both vivid → stays clash (silent), never rewritten into anything louder
    expect(harmonyWithChroma('red', 'yellow', 0.9, 0.9)).toBe('clash');
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
