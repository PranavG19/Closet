// F4 — perceptual-hash near-duplicate compare. Pure, deterministic, O(1): a
// fixed-width bigint XOR + popcount over 64 bits. No I/O, no clock, no randomness.
// Parse once at the boundary (parsePhash), compare as bigint — never re-parse
// inside hammingDistance.
import { z } from 'zod';
import { parseBoundary } from './parse.js';

export const PHASH_BITS = 64;

const PHASH_MASK = (1n << BigInt(PHASH_BITS)) - 1n;

// ON-WIRE FORM: a DECIMAL-digit string, because that is the ONE form the system actually
// produces. `phash` is a `bigint` column (migration 0002) and every repo projects it as
// `phash::text` (wardrobe/parse-jobs/export repos), so Postgres emits a base-10 integer string
// (e.g. "9007199254740993"), NOT hex. The prior 16-char-hex schema matched NOTHING the DB
// returns — so findDuplicatePairs silently dropped every real row at its parse boundary and the
// only reason nothing failed is that there is no on-device pHash producer yet and the dedupe
// tests minted their own hex. Parse-don't-cast means this boundary must accept what the producer
// emits; the only producer today is the DB, emitting decimal. Up to 20 digits covers the full
// unsigned 64-bit range; the value is masked to 64 bits below, so a signed-bigint reinterpret
// (two's complement, e.g. a stored negative) still lands on the correct unsigned bit pattern.
const PhashDecimalSchema = z
  .string()
  .regex(/^-?[0-9]{1,20}$/, 'expected a base-10 integer phash string (bigint::text)');

// Branded so a raw string cannot masquerade as a validated Phash without parsing.
export type Phash = bigint & { readonly __phash: unique symbol };

// parse-don't-cast: validate it is a base-10 integer string, then narrow to the 64-bit domain.
// Masking with PHASH_MASK makes the result a canonical unsigned 64-bit value regardless of sign,
// so hammingDistance/dedupeCompare compare the same bit pattern the DB stored.
export function parsePhash(x: unknown): Phash {
  const decimal = parseBoundary(PhashDecimalSchema, x, 'parsePhash');
  return (BigInt(decimal) & PHASH_MASK) as Phash;
}

// popcount over the fixed 64-bit width.
function popcount64(value: bigint): number {
  let bits = value & PHASH_MASK;
  let count = 0;
  while (bits > 0n) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}

// Pure. Symmetric and d(x,x)=0 by construction (XOR is symmetric; x^x=0). Range 0..64.
export function hammingDistance(a: Phash, b: Phash): number {
  return popcount64(a ^ b);
}

export const DEDUPE_VERDICTS = ['duplicate', 'keep-both'] as const;
export type DedupeVerdict = (typeof DEDUPE_VERDICTS)[number];

// F4 threshold: at/below this many differing bits, two photos are the same garment.
export const DEDUPE_HAMMING_THRESHOLD = 10;

export function dedupeCompare(
  a: Phash,
  b: Phash,
  threshold: number = DEDUPE_HAMMING_THRESHOLD,
): DedupeVerdict {
  return hammingDistance(a, b) <= threshold ? 'duplicate' : 'keep-both';
}

// ---------------------------------------------------------------------------
// F4 wardrobe-wide candidate surfacing (docs/06 §3: "O(n²) Hamming compare over the phash the
// client already holds — trivial to low thousands of items. No server pass, no dedupe table.").
//
// The dedupe pick sheet consumes THIS: given the items the client already holds, surface the
// likely-duplicate PAIRS. It only ever SURFACES candidates — it never merges — so "keep both"
// stays structurally representable (docs/02 dedupe seam: never destructive without her tap).
// Pure/deterministic: no I/O, no clock, no randomness.
// ---------------------------------------------------------------------------

// The minimum an item needs to be compared: an identity + its (possibly absent) phash. Kept
// narrower than WardrobeItemRow so this pure fn does not depend on the full wire schema — the
// caller maps its rows down to this shape. `phash` is the on-wire string (or null when the
// parse pipeline has not produced one yet); this fn parses it at the boundary.
export interface DedupeCandidateItem {
  readonly id: string;
  readonly phash: string | null;
}

// A surfaced likely-duplicate pair, lower id first so the pair is order-stable and a caller can
// dedupe pairs by (a,b) without worrying about direction. `distance` lets the sheet order the
// most-confident duplicates first.
export interface DedupePair {
  readonly a: string;
  readonly b: string;
  readonly distance: number;
}

// Surface every likely-duplicate pair among `items`. Items with a null or malformed phash are
// skipped (no signal to compare — never guessed as a duplicate). Each unordered pair is compared
// exactly once. Result is sorted by ascending distance, then by (a,b) id, so the output is fully
// deterministic for a given input set regardless of input order.
export function findDuplicatePairs(
  items: readonly DedupeCandidateItem[],
  threshold: number = DEDUPE_HAMMING_THRESHOLD,
): DedupePair[] {
  // Parse phashes once, dropping items without a usable signal. A malformed stored phash is
  // treated as "no signal" (skipped) rather than throwing — one bad row must not blind the
  // whole closet's dedupe. parsePhash is the boundary for the values we DO compare.
  const parsed: { readonly id: string; readonly phash: Phash }[] = [];
  for (const item of items) {
    if (item.phash === null) continue;
    let phash: Phash;
    try {
      phash = parsePhash(item.phash);
    } catch {
      continue;
    }
    parsed.push({ id: item.id, phash });
  }

  const pairs: DedupePair[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const left = parsed[i]!;
      const right = parsed[j]!;
      const distance = hammingDistance(left.phash, right.phash);
      if (distance <= threshold) {
        // Order the pair by id so the surfaced pair is direction-stable.
        const [a, b] = left.id < right.id ? [left.id, right.id] : [right.id, left.id];
        pairs.push({ a, b, distance });
      }
    }
  }

  pairs.sort((p, q) => (p.distance !== q.distance ? p.distance - q.distance : p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
  return pairs;
}
