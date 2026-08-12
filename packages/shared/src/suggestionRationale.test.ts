// Oracle for the suggestion rationale. The load-bearing part is NOT the exact wording — it
// is the honesty invariants from D-003 Step 5, which are graded here two ways the author's
// own sentences can't fake:
//   (a) a FORBIDDEN-VOCABULARY scan over every produced line (no wording may imply camera
//       detection, prescription, or scientific certainty), run over an adversarial matrix of
//       inputs so a bad sentence can't hide in a branch the happy path misses;
//   (b) structural invariants: the outfit is ALWAYS explained (never empty), a clash is
//       never named, and the honesty caveats always travel WITH any color claim.
import { describe, it, expect } from 'vitest';
import { suggestionRationale, type RationaleInput } from './suggestionRationale.js';
import { HARMONY_VERDICTS, type HarmonyVerdict } from './harmony.js';

// Every input shape the screen can produce: each verdict (plus null), × palette present/absent,
// × palette-influenced/not. This is the matrix the vocabulary scan must hold over.
const allInputs: RationaleInput[] = [];
for (const verdict of [...HARMONY_VERDICTS, null] as (HarmonyVerdict | null)[]) {
  for (const hasPalette of [true, false]) {
    for (const paletteInfluencedOrder of [true, false]) {
      for (const freshnessInfluencedOrder of [true, false]) {
        for (const selectedCount of [1, 2, 4]) {
          allInputs.push({ selectedCount, verdict, hasPalette, paletteInfluencedOrder, freshnessInfluencedOrder });
        }
      }
    }
  }
}

describe('suggestionRationale — honesty invariants (D-003 Step 5)', () => {
  // The risks list forbids any implication of detection, prescription, or certainty. This is
  // the independent oracle: a regex sweep the copy cannot argue its way around.
  const FORBIDDEN = [
    /\bdetect/i, // never "detected from a photo" / "we detected your skin tone"
    /\bscan(ned|ning)?\b/i, // no implication we scanned her
    /\bprescrib/i, // advisory, never prescriptive
    /\byou (should|must|need to)\b/i, // no bossy directives (docs/03 voice)
    /\bdon['’]t wear\b/i, // never scold a choice
    /\bscientific(ally)?\b/i, // no certainty claims
    /\bproven\b/i,
    /\bclash\b/i, // a clash is silent, never named to the user
  ];

  it('never emits forbidden vocabulary, across the full input matrix', () => {
    for (const input of allInputs) {
      for (const line of suggestionRationale(input)) {
        for (const pattern of FORBIDDEN) {
          expect(pattern.test(line), `"${line}" matched forbidden ${pattern}`).toBe(false);
        }
      }
    }
  });

  it('always explains the outfit — never returns an empty rationale', () => {
    for (const input of allInputs) {
      expect(suggestionRationale(input).length).toBeGreaterThan(0);
    }
  });

  it('states the palette is self-identified whenever color reasoning is surfaced', () => {
    // If a palette exists OR a (non-clash) color verdict is stated, the self-identification
    // caveat MUST appear — the limit travels with the claim, never orphaned.
    for (const input of allInputs) {
      const usedColor = input.hasPalette || (input.verdict !== null && input.verdict !== 'clash');
      const lines = suggestionRationale(input);
      const hasSelfIdentified = lines.some((l) => /self-chosen|swatch quiz/i.test(l));
      const hasApproximation = lines.some((l) => /broad families|gentle hint/i.test(l));
      if (usedColor) {
        expect(hasSelfIdentified, `missing self-ID caveat for ${JSON.stringify(input)}`).toBe(true);
        expect(hasApproximation, `missing approximation caveat for ${JSON.stringify(input)}`).toBe(true);
      } else {
        // No color reasoning → no color caveats (we don't lecture about a thing we didn't use).
        expect(hasSelfIdentified).toBe(false);
        expect(hasApproximation).toBe(false);
      }
    }
  });

  it('always includes the weather honesty line (we do not read the forecast yet)', () => {
    for (const input of allInputs) {
      const lines = suggestionRationale(input);
      expect(lines.some((l) => /don’t read the forecast|assumes mild/i.test(l))).toBe(true);
    }
  });
});

describe('suggestionRationale — the color reason tracks the verdict', () => {
  const base: RationaleInput = { selectedCount: 2, verdict: null, hasPalette: false, paletteInfluencedOrder: false, freshnessInfluencedOrder: false };

  it('states a color reason for a harmonious verdict', () => {
    const lines = suggestionRationale({ ...base, verdict: 'complementary' });
    expect(lines.some((l) => /near-opposite hues/i.test(l))).toBe(true);
  });

  it('says nothing about color for a clash (it is silent), but STILL explains the outfit', () => {
    const clash = suggestionRationale({ ...base, verdict: 'clash' });
    // No color reason line, but the weather reason is still present — the look is suggested,
    // we just don't comment on its colors.
    expect(clash.some((l) => /hue|color family|contrast/i.test(l))).toBe(false);
    expect(clash.length).toBeGreaterThan(0);
  });

  it('distinguishes palette-influenced from not, honestly', () => {
    const influenced = suggestionRationale({ ...base, hasPalette: true, paletteInfluencedOrder: true });
    const notInfluenced = suggestionRationale({ ...base, hasPalette: true, paletteInfluencedOrder: false });
    expect(influenced.some((l) => /leaned toward your palette/i.test(l))).toBe(true);
    expect(notInfluenced.some((l) => /didn’t change today’s pick/i.test(l))).toBe(true);
  });

  it('explains freshness ONLY when it moved the pick (silent otherwise)', () => {
    const fresh = suggestionRationale({ ...base, freshnessInfluencedOrder: true });
    const notFresh = suggestionRationale({ ...base, freshnessInfluencedOrder: false });
    expect(fresh.some((l) => /haven’t worn lately|wore something similar recently/i.test(l))).toBe(true);
    // When freshness didn't change anything, we don't mention it at all — no filler.
    expect(notFresh.some((l) => /haven’t worn lately|wore something similar recently/i.test(l))).toBe(false);
  });
});
