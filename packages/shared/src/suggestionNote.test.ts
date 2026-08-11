// The oracle is the harmony table (independently: harmony() is symmetric by construction
// and separately tested) plus docs/03's voice rule — "advisory, never bossy… never a nag."
// Each test names which of the two it enforces.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { suggestionNote } from './suggestionNote.js';
import { harmony } from './harmony.js';
import { COLOR_FAMILIES } from './harmony.js';

const item = (color: string | null, category = 'top') => ({ category, color });

// A hex at a family's centre hue (S=100% L=50%) at an arbitrary lightness, for A1 value-spread
// tests. Pure additive-wheel math, hand-derived — NOT computed by the module under test.
const hexAtHueLightness = (hueDeg: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * 1.0; // S = 1
  const hp = hueDeg / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
};

describe('suggestionNote — says nothing rather than something false', () => {
  it('returns null for a single garment (nothing to pair)', () => {
    expect(suggestionNote([item('red')])).toBeNull();
  });

  it('returns null for an empty outfit', () => {
    expect(suggestionNote([])).toBeNull();
  });

  it('returns null when only one garment has a recognisable colour', () => {
    // We cannot compare against unknown, so there is no honest pairing claim to make.
    expect(suggestionNote([item('red'), item(null)])).toBeNull();
    expect(suggestionNote([item('red'), item('vermilion')])).toBeNull();
  });

  it('NEVER scolds a clash — it goes quiet instead (docs/03: never a nag)', () => {
    // Find a real clashing pair from the harmony table itself rather than assuming one.
    const clashing = (['red', 'orange', 'yellow', 'chartreuse', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'] as const)
      .flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => harmony(a, b) === 'clash');
    expect(clashing).toBeDefined();
    const [a, b] = clashing!;
    expect(suggestionNote([item(a), item(b)])).toBeNull();
  });
});

describe('suggestionNote — the note reflects the REAL verdict', () => {
  it('describes a tonal look for two garments of the same family', () => {
    expect(harmony('red', 'red')).toBe('monochromatic');
    expect(suggestionNote([item('red'), item('red')])).toMatch(/tonal/i);
  });

  it('mentions neutrals ONLY when a neutral is actually involved', () => {
    // The hardcoded string this replaces claimed "pairs beautifully with your neutrals"
    // for every outfit, including outfits containing no neutral at all.
    const withNeutral = suggestionNote([item('black'), item('red')]);
    expect(harmony('black', 'red')).toBe('neutral');
    expect(withNeutral).toMatch(/neutral/i);

    const noNeutral = suggestionNote([item('red'), item('orange')]);
    if (noNeutral !== null) expect(noNeutral).not.toMatch(/neutral/i);
  });

  it('describes contrast for a complementary pair', () => {
    const complementary = (['red', 'orange', 'yellow', 'green', 'blue', 'violet'] as const)
      .flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => harmony(a, b) === 'complementary');
    expect(complementary).toBeDefined();
    const [a, b] = complementary!;
    expect(suggestionNote([item(a), item(b)])).toMatch(/contrast/i);
  });

  it('grades a 3-garment outfit by its WEAKEST pair, not its best', () => {
    // A safe neutral pairing must not vouch for an outfit that clashes elsewhere: with a
    // clashing pair present, the note goes silent even though black+anything is 'neutral'.
    const clashing = (['red', 'orange', 'yellow', 'chartreuse', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'] as const)
      .flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => harmony(a, b) === 'clash');
    const [a, b] = clashing!;
    expect(suggestionNote([item('black'), item(a), item(b)])).toBeNull();
  });

  it('is order-independent (harmony is symmetric, so the note must be too)', () => {
    expect(suggestionNote([item('black'), item('red')])).toBe(
      suggestionNote([item('red'), item('black')]),
    );
  });

  it('never returns an empty string — null means "no note", not ""', () => {
    for (const pair of [['red', 'red'], ['black', 'red'], ['red', 'orange']] as const) {
      const note = suggestionNote([item(pair[0]), item(pair[1])]);
      if (note !== null) expect(note.length).toBeGreaterThan(0);
    }
  });
});

describe('suggestionNote — A1: the monochromatic note is gated on VALUE SPREAD', () => {
  // Both hexes are saturated red (S=1), so both classify red → monochromatic; only their
  // lightness differs. The oracle is the two lightnesses I passed in, not the module's output.
  const RED = 0; // red hue centre
  const layered = 'quietly layered';
  const flat = 'One quiet colour';

  it('says the "layered" sentence when the two same-hue garments differ in lightness', () => {
    const note = suggestionNote([item(hexAtHueLightness(RED, 0.3)), item(hexAtHueLightness(RED, 0.7))]);
    expect(note).toContain(layered); // |0.7-0.3| = 0.4 > band
    expect(note).not.toContain(flat);
  });

  it('says the softer "one quiet colour" sentence when the values are close (flat, still positive)', () => {
    const note = suggestionNote([item(hexAtHueLightness(RED, 0.5)), item(hexAtHueLightness(RED, 0.55))]);
    expect(note).toContain(flat); // |0.55-0.5| = 0.05 < band
    expect(note).not.toContain(layered);
    // it is a POSITIVE sentence, never a scold
    expect(note!.toLowerCase()).not.toMatch(/don'?t|avoid|clash|wrong|too|bad/);
  });

  it('CONSERVATIVE: bare tokens (no known lightness) keep the original "layered" line unchanged', () => {
    // Regression guard: a token-only mono pair must read exactly as before A1 landed.
    expect(suggestionNote([item('red'), item('red')])).toContain(layered);
  });
});

describe('suggestionNote — never a scold across a generated matrix of pairs (A1+A2 invariant)', () => {
  const arbColor = fc.oneof(
    fc.constantFrom(...COLOR_FAMILIES), // bare tokens (unknown geometry)
    fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .map(([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`),
    fc.constant(null),
  );

  it('no note is ever negative — every emitted note is one of the known positive sentences or null', () => {
    fc.assert(
      fc.property(fc.array(arbColor, { minLength: 0, maxLength: 5 }), (colors) => {
        const note = suggestionNote(colors.map((c) => item(c)));
        if (note === null) return; // silence is always allowed
        expect(note.toLowerCase()).not.toMatch(/don'?t|avoid|clash|wrong|unflatter|bad|too much/);
        expect(note.length).toBeGreaterThan(0);
      }),
    );
  });
});
