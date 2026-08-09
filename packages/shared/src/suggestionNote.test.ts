// The oracle is the harmony table (independently: harmony() is symmetric by construction
// and separately tested) plus docs/03's voice rule — "advisory, never bossy… never a nag."
// Each test names which of the two it enforces.
import { describe, it, expect } from 'vitest';
import { suggestionNote } from './suggestionNote.js';
import { harmony } from './harmony.js';

const item = (color: string | null, category = 'top') => ({ category, color });

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
