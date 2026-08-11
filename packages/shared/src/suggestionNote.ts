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
import { harmony, isColorFamily, type ColorFamily, type HarmonyVerdict } from './harmony.js';

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
const NOTE_BY_VERDICT: Readonly<Record<Exclude<HarmonyVerdict, 'clash'>, string>> = {
  monochromatic: 'A tonal look — one colour, quietly layered.',
  analogous: 'These sit next to each other on the wheel; the blend is easy.',
  complementary: 'Opposite hues — this one has some contrast to it.',
  triadic: 'Colours spaced evenly around the wheel — a lively, balanced mix.',
  'split-complementary': 'A softer take on contrast — near-opposite hues that still play well.',
  neutral: 'Neutral-anchored, so it goes with everything else you own.',
};

// The note for a suggested set, or null when there is nothing honest to say.
//
// Returns NULL rather than a filler sentence in three cases: fewer than two garments with
// recognisable colours (nothing to pair), and a clash (see the voice rule). A UI that
// renders null as "no note" is telling the truth; a filler sentence is not.
export function suggestionNote(items: readonly NoteItemLike[]): string | null {
  const families: ColorFamily[] = [];
  for (const item of items) {
    if (item.color !== null && isColorFamily(item.color)) families.push(item.color);
  }
  // One colour (or none) is not a pairing. Note that a two-item outfit where only one item
  // has a known colour lands here too, correctly: we cannot compare against unknown.
  if (families.length < 2) return null;

  // The verdict for the outfit is the verdict of its two LEAST harmonious garments — the
  // pair that actually determines whether the look holds together. Taking the best pair
  // instead would let one safe combination vouch for an outfit that clashes elsewhere.
  // Lower rank = less harmonious = the pair that decides the outfit's note. Triadic and
  // split-complementary are harmonious but higher-tension than a straight complementary,
  // so they sit just above clash and below complementary.
  const RANK: Readonly<Record<HarmonyVerdict, number>> = {
    clash: 0,
    triadic: 1,
    'split-complementary': 2,
    complementary: 3,
    analogous: 4,
    monochromatic: 5,
    neutral: 6,
  };

  let worst: HarmonyVerdict = 'neutral';
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const verdict = harmony(families[i]!, families[j]!);
      if (RANK[verdict] < RANK[worst]) worst = verdict;
    }
  }

  // A clash says nothing. She picked her own clothes; the app is not her critic.
  if (worst === 'clash') return null;
  return NOTE_BY_VERDICT[worst];
}
