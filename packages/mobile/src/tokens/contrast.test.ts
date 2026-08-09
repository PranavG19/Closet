// THE ACCESSIBILITY GATE FOR THE PALETTE. docs/03 §Accessibility calls WCAG AA contrast
// "baseline, non-negotiable" — and before this file nothing enforced it, so 7 of 10
// foreground tokens shipped failing, including `text.tertiary` at 2.58:1 (below even the
// 3.0 large-text floor) and white-on-`accent.pink` at 2.91:1, which is the filled Button's
// OWN LABEL: the `Subscribe` and `I wore this` text.
//
// A screenshot audit found that by eye. A test can find it by arithmetic, and arithmetic
// does not get tired — which is the point: this converts a review commitment into a
// mechanism, so a future palette revision by anyone (human or agent) that breaks AA goes
// red instead of shipping.
//
// THE RATIOS ARE COMPUTED FROM THE WCAG 2.x FORMULA IMPLEMENTED HERE, NOT read from a
// table I wrote down. That is deliberate: a hardcoded expected-ratio table would be a
// mirror oracle — it would agree with whatever the tokens happened to be. The oracle is the
// spec's formula plus its published thresholds (4.5:1 normal text, 3.0:1 large text and
// non-text UI components), so changing a hex changes the measured value and the threshold
// stays put.
import { describe, it, expect } from 'vitest';
import { lightTokens } from './tokens.js';

// WCAG 2.x relative luminance. Transcribed from the definition:
//   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function channelLuminance(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channelLuminance((n >> 16) & 0xff) +
    0.7152 * channelLuminance((n >> 8) & 0xff) +
    0.0722 * channelLuminance(n & 0xff)
  );
}

// WCAG 2.x contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05).
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

// The published thresholds. Named so a failure message says which rule broke.
const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_TEXT_AND_UI = 3.0;

const { color } = lightTokens;
// Every background a foreground can land on. Each foreground is checked against ALL of
// them and graded on the WORST — a token that passes on white and fails on the sunken well
// is still a token that fails somewhere she will actually see it.
const BACKGROUNDS = Object.entries(color.bg);

function worstAgainstBackgrounds(fg: string): { ratio: number; bg: string } {
  let worst = { ratio: Number.POSITIVE_INFINITY, bg: '' };
  for (const [name, bg] of BACKGROUNDS) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < worst.ratio) worst = { ratio, bg: name };
  }
  return worst;
}

describe('the formula itself (so a broken implementation cannot silently pass everything)', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#4A7B2C', '#4A7B2C')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(contrastRatio('#FEDCBA', '#123456'), 10);
  });
});

describe('text tokens clear AA 4.5:1 on every background', () => {
  // Iterating the token object rather than a list means a NEW text token is covered the
  // moment it is added — it cannot be introduced untested.
  for (const [name, value] of Object.entries(color.text)) {
    // onAccent is white-on-a-fill; it is graded against the accent fills below, not
    // against the page backgrounds it never sits on.
    if (name === 'onAccent') continue;
    it(`text.${name} (${value})`, () => {
      const { ratio, bg } = worstAgainstBackgrounds(value);
      expect(
        ratio,
        `text.${name} is ${ratio.toFixed(2)}:1 on bg.${bg}, needs ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }
});

describe('accent tokens are legible as text AND under a white label', () => {
  // These two constraints together are why `accent` and `accentDecorative` are separate
  // families: one colour cannot be both the brightest brand tone and readable type.
  for (const [name, value] of Object.entries(color.accent)) {
    it(`accent.${name} (${value}) clears AA as text on every background`, () => {
      const { ratio, bg } = worstAgainstBackgrounds(value);
      expect(
        ratio,
        `accent.${name} is ${ratio.toFixed(2)}:1 on bg.${bg}, needs ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it(`text.onAccent is legible on an accent.${name} fill`, () => {
      // The regression this catches by name: the filled Button's own label. At the old
      // pink this was 2.91:1 — the `Subscribe` text on the paywall.
      const ratio = contrastRatio(color.text.onAccent, value);
      expect(
        ratio,
        `onAccent on accent.${name} is ${ratio.toFixed(2)}:1, needs ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }
});

describe('state indicators clear the 3.0:1 non-text UI bar', () => {
  // 3.0 and not 4.5 because these are dots paired with a text label (docs/03: never encode
  // meaning in hue alone), so the colour is redundant reinforcement. They still have to be
  // VISIBLE — every one of them was under 2.5:1 before.
  for (const [name, value] of Object.entries(color.state)) {
    it(`state.${name} (${value})`, () => {
      const { ratio, bg } = worstAgainstBackgrounds(value);
      expect(
        ratio,
        `state.${name} is ${ratio.toFixed(2)}:1 on bg.${bg}, needs ${AA_LARGE_TEXT_AND_UI}:1`,
      ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_AND_UI);
    });
  }
});

describe('the decorative family is documented as decorative, not accidentally legible', () => {
  it('exists and is a distinct, LIGHTER set than the text-legal accents', () => {
    // If someone "simplifies" the two families back into one, this fails — which is the
    // guard. The decorative tones are the original brand hexes and are lighter by design.
    for (const key of ['pink', 'red', 'blue'] as const) {
      expect(color.accentDecorative[key]).not.toBe(color.accent[key]);
      expect(relativeLuminance(color.accentDecorative[key])).toBeGreaterThan(
        relativeLuminance(color.accent[key]),
      );
    }
  });

  it('preserves each brand hue exactly — only lightness was reduced', () => {
    // The aesthetic claim, made checkable: the accessible accents are the SAME colour,
    // darker. A future "fix" that silently swaps pink for maroon fails here.
    const hue = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      const r = ((n >> 16) & 0xff) / 255;
      const g = ((n >> 8) & 0xff) / 255;
      const b = (n & 0xff) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const h =
        max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h / 6) * 360;
    };
    for (const key of ['pink', 'red', 'blue'] as const) {
      // Within 2° — the same colour, not a different one.
      expect(Math.abs(hue(color.accent[key]) - hue(color.accentDecorative[key]))).toBeLessThan(2);
    }
  });
});
