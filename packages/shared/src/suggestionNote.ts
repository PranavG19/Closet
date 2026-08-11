// The one-line advisory note under a suggested outfit — derived from the real F9 harmony
// verdict of the garments actually selected, not asserted.
//
// This replaces a HARDCODED STRING. SuggestionsScreen rendered the literal sentence "This
// pairs beautifully with your neutrals." for every outfit, including outfits with no
// neutral in them and single-item outfits with nothing to pair. The harmony engine that
// could answer the question honestly (harmony.ts, fully tested, symmetric by construction)
// had zero callers.
//
// THE VOICE RULE IS A HARD CONSTRAINT, not a style preference. docs/03 design principles:
// "Advisory, never bossy… never a red error, never a block, never a nag." So a clash is
// never scolded — the note simply goes quiet, or offers the neutral it would sit better
// with. There is no "don't wear this."
import { harmonyWithChroma, type HarmonyVerdict } from './harmony.js';
import { toColorSignal, type ColorSignal } from './colorFamily.js';

export interface NoteItemLike {
  readonly category: string;
  // A stored garment's color is nullable and free-form; only recognised families can be
  // reasoned about.
  readonly color: string | null;
}

// Copy per verdict. A closed Record over HarmonyVerdict so adding a verdict is a compile
// error rather than a silently missing sentence.
//
// `clash` is deliberately absent from this map — see below. It is the one verdict with no
// copy, because saying it out loud would be the nag the design rules forbid.
//
// `monochromatic` is ALSO absent here: its copy is chosen at the call site by value spread
// (A1) — see MONO_LAYERED / MONO_FLAT below — so it is the second verdict with no fixed line.
const NOTE_BY_VERDICT: Readonly<Record<Exclude<HarmonyVerdict, 'clash' | 'monochromatic'>, string>> = {
  analogous: 'These sit next to each other on the wheel; the blend is easy.',
  complementary: 'Opposite hues — this one has some contrast to it.',
  triadic: 'Colours spaced evenly around the wheel — a lively, balanced mix.',
  'split-complementary': 'A softer take on contrast — near-opposite hues that still play well.',
  neutral: 'Neutral-anchored, so it goes with everything else you own.',
};

// A1: two POSITIVE monochromatic sentences, chosen by value spread — never a scold, just the
// more honest of two. "quietly layered" promises depth that only reads when the two garments
// differ in lightness (D-003 research §2/§4 [GROUNDED]: value contrast carries the depth a
// same-hue pairing leans on); when the values are close the look is flat, so the softer
// "one quiet colour" is the honest line.
const MONO_LAYERED = 'A tonal look — one colour, quietly layered.';
const MONO_FLAT = 'One quiet colour, kept simple.';

// A1 tuning constant — NOT a colorimetric law. HSL-lightness band above which a same-hue
// pair reads as "layered" rather than flat. [SOFT] cutpoint: tuned by taste; the axis (value
// contrast carries depth) is the science, the exact 0.15 is not derived from a standard.
const MONO_VALUE_SPREAD_BAND = 0.15;

// The note for a suggested set, or null when there is nothing honest to say.
//
// Returns NULL rather than a filler sentence in three cases: fewer than two garments with
// recognisable colours (nothing to pair), and a clash (see the voice rule). A UI that
// renders null as "no note" is telling the truth; a filler sentence is not.
// Recognised colour signals of a set, in item order. A signal carries the family AND the
// discarded axes (lightness/chroma, null for a bare token); collecting once means the note,
// the verdict, and the value-spread gate all read the SAME source.
function signalsOf(items: readonly NoteItemLike[]): ColorSignal[] {
  const signals: ColorSignal[] = [];
  for (const item of items) {
    const signal = toColorSignal(item.color);
    if (signal !== null) signals.push(signal);
  }
  return signals;
}

// Lower rank = less harmonious = the pair that decides the outfit's note. Triadic and
// split-complementary are harmonious but higher-tension than a straight complementary, so
// they sit just above clash and below complementary.
const RANK: Readonly<Record<HarmonyVerdict, number>> = {
  clash: 0,
  triadic: 1,
  'split-complementary': 2,
  complementary: 3,
  analogous: 4,
  monochromatic: 5,
  neutral: 6,
};

function worstVerdict(signals: readonly ColorSignal[]): HarmonyVerdict | null {
  // One colour (or none) is not a pairing. Note that a two-item outfit where only one item
  // has a known colour lands here too, correctly: we cannot compare against unknown.
  if (signals.length < 2) return null;

  // The verdict for the outfit is the verdict of its two LEAST harmonious garments — the
  // pair that actually determines whether the look holds together. Taking the best pair
  // instead would let one safe combination vouch for an outfit that clashes elsewhere.
  // Uses harmonyWithChroma (A2): a muted garment pulls a clashing pair out to neutral-safe;
  // with unknown chroma (bare tokens) this is exactly harmony(), so the verdict is unchanged.
  let worst: HarmonyVerdict = 'neutral';
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      const verdict = harmonyWithChroma(
        signals[i]!.family,
        signals[j]!.family,
        signals[i]!.chroma,
        signals[j]!.chroma,
      );
      if (RANK[verdict] < RANK[worst]) worst = verdict;
    }
  }
  return worst;
}

// The color-harmony verdict for a suggested set, or null when there is nothing to compare
// (fewer than two garments with recognised colours). Exposed so the one-line note AND the
// fuller rationale (suggestionRationale) derive from the SAME verdict rather than each
// recomputing it — two computations of one thing is how the note and the explanation would
// silently disagree.
export function outfitVerdict(items: readonly NoteItemLike[]): HarmonyVerdict | null {
  return worstVerdict(signalsOf(items));
}

// A1: pick the monochromatic sentence by value spread. "Layered" only when some same-hue
// pair actually differs in lightness beyond the band; "flat" when known lightnesses are all
// close. CONSERVATIVE when lightness is unknown (bare tokens, or a hex pair without two known
// values): default to the layered line, so a token-only outfit reads exactly as it did before
// A1 — the softer sentence is chosen only on positive evidence of a flat pairing.
function monochromaticNote(signals: readonly ColorSignal[]): string {
  let sawKnownPair = false;
  let maxSpread = 0;
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      if (harmonyWithChroma(signals[i]!.family, signals[j]!.family, signals[i]!.chroma, signals[j]!.chroma) !== 'monochromatic')
        continue;
      const la = signals[i]!.lightness;
      const lb = signals[j]!.lightness;
      if (la === null || lb === null) continue;
      sawKnownPair = true;
      maxSpread = Math.max(maxSpread, Math.abs(la - lb));
    }
  }
  if (!sawKnownPair) return MONO_LAYERED; // unknown value spread → conservative, unchanged.
  return maxSpread > MONO_VALUE_SPREAD_BAND ? MONO_LAYERED : MONO_FLAT;
}

export function suggestionNote(items: readonly NoteItemLike[]): string | null {
  const signals = signalsOf(items);
  const worst = worstVerdict(signals);
  // Nothing to compare, or a clash — a clash says nothing (she picked her own clothes; the
  // app is not her critic). Both yield no note.
  if (worst === null || worst === 'clash') return null;
  if (worst === 'monochromatic') return monochromaticNote(signals);
  return NOTE_BY_VERDICT[worst];
}
