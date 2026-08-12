// Tier-1 (docs/05): property tests for F4 phash dedupe — identity, symmetry,
// range, keep-both reachability. Oracle = structural invariants over generated
// phashes, not curated examples.
//
// RED-FIRST NOTE (task-07 §5): before the real threshold landed, dedupeCompare was
// stubbed to `() => 'duplicate'` (always duplicate). The keep-both-reachability
// property FAILED (fast-check found high-distance pairs the stub mislabeled). The
// real threshold comparison then turned it green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PHASH_BITS,
  DEDUPE_HAMMING_THRESHOLD,
  parsePhash,
  hammingDistance,
  dedupeCompare,
  findDuplicatePairs,
  type Phash,
  type DedupeCandidateItem,
} from './dedupe.js';
import { BoundaryParseError } from './parse.js';

// A DECIMAL phash string — the REAL on-wire form (bigint::text from the repos), independent of
// parsePhash so the pairing tests exercise the actual string→bigint boundary findDuplicatePairs
// sees in production. Using decimal (not hex) is what makes these tests non-vacuous against the
// true wire contract.
const arbPhashDecimal: fc.Arbitrary<string> = fc
  .bigInt({ min: 0n, max: (1n << 64n) - 1n })
  .map((n) => n.toString(10));

// A Phash arbitrary: 64 random bits → decimal string → parsePhash (the real boundary).
const arbPhash: fc.Arbitrary<Phash> = fc
  .bigInt({ min: 0n, max: (1n << 64n) - 1n })
  .map((n) => parsePhash(n.toString(10)));

// A phash a controlled number of bits away from a base, for range/threshold laws.
// The flip COUNT is drawn uniformly over 0..64 (then that many distinct positions
// are chosen), so cases reliably land both at/below and above the threshold — the
// keep-both/duplicate reachability laws would otherwise rarely see high-distance
// pairs and could not bite an always-'duplicate' mutant.
const arbPhashPairWithFlips = fc
  .integer({ min: 0, max: 64 })
  .chain((flipCount) =>
    fc.tuple(
      arbPhash,
      fc.uniqueArray(fc.integer({ min: 0, max: 63 }), {
        minLength: flipCount,
        maxLength: flipCount,
      }),
    ),
  )
  .map(([base, positions]) => {
    let mutated = base as bigint;
    for (const p of positions) mutated ^= 1n << BigInt(p);
    return {
      base,
      mutated: parsePhash((mutated & ((1n << 64n) - 1n)).toString(10)),
      flips: positions.length,
    };
  });

describe('hammingDistance — structural laws', () => {
  it('identity: d(x,x) === 0', () => {
    fc.assert(
      fc.property(arbPhash, (x) => {
        expect(hammingDistance(x, x)).toBe(0);
      }),
    );
  });

  it('symmetry: d(a,b) === d(b,a)', () => {
    fc.assert(
      fc.property(arbPhash, arbPhash, (a, b) => {
        expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
      }),
    );
  });

  it('range: 0 ≤ d(a,b) ≤ PHASH_BITS', () => {
    fc.assert(
      fc.property(arbPhash, arbPhash, (a, b) => {
        const d = hammingDistance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(PHASH_BITS);
      }),
    );
  });

  it('equals the number of flipped bits (exact popcount)', () => {
    fc.assert(
      fc.property(arbPhashPairWithFlips, ({ base, mutated, flips }) => {
        expect(hammingDistance(base, mutated)).toBe(flips);
      }),
    );
  });
});

describe('dedupeCompare — verdict laws', () => {
  it('identity: dedupeCompare(x,x) === "duplicate"', () => {
    fc.assert(
      fc.property(arbPhash, (x) => {
        expect(dedupeCompare(x, x)).toBe('duplicate');
      }),
    );
  });

  it('symmetry: dedupeCompare(a,b) === dedupeCompare(b,a)', () => {
    fc.assert(
      fc.property(arbPhash, arbPhash, (a, b) => {
        expect(dedupeCompare(a, b)).toBe(dedupeCompare(b, a));
      }),
    );
  });

  it('keep-both reachability: distance beyond threshold → "keep-both"', () => {
    fc.assert(
      fc.property(arbPhashPairWithFlips, ({ base, mutated, flips }) => {
        if (flips > DEDUPE_HAMMING_THRESHOLD) {
          expect(dedupeCompare(base, mutated)).toBe('keep-both');
        }
      }),
    );
  });

  it('duplicate reachability: distance at/below threshold → "duplicate"', () => {
    fc.assert(
      fc.property(arbPhashPairWithFlips, ({ base, mutated, flips }) => {
        if (flips <= DEDUPE_HAMMING_THRESHOLD) {
          expect(dedupeCompare(base, mutated)).toBe('duplicate');
        }
      }),
    );
  });

  it('is not a constant — both verdicts are produced by some valid input', () => {
    const a = parsePhash('0'); // all bits 0
    const near = parsePhash('1'); // 1 bit apart
    const far = parsePhash('18446744073709551615'); // 2^64-1, all 64 bits set → 64 apart
    expect(dedupeCompare(a, near)).toBe('duplicate');
    expect(dedupeCompare(a, far)).toBe('keep-both');
  });
});

describe('findDuplicatePairs — wardrobe-wide candidate surfacing', () => {
  // An item arbitrary: an id + either a real DECIMAL phash (the wire form) or null (unparsed).
  // Ids are unique within a set (real wardrobe rows have unique ids), so we index-suffix them.
  const arbItems: fc.Arbitrary<DedupeCandidateItem[]> = fc
    .array(fc.option(arbPhashDecimal, { nil: null }), { maxLength: 12 })
    .map((phashes) => phashes.map((phash, i) => ({ id: `item-${i}`, phash })));

  it('every surfaced pair agrees with dedupeCompare = "duplicate" (distance ≤ threshold)', () => {
    fc.assert(
      fc.property(arbItems, (items) => {
        const byId = new Map(items.map((it) => [it.id, it.phash]));
        for (const pair of findDuplicatePairs(items)) {
          const a = parsePhash(byId.get(pair.a)!);
          const b = parsePhash(byId.get(pair.b)!);
          expect(hammingDistance(a, b)).toBeLessThanOrEqual(DEDUPE_HAMMING_THRESHOLD);
          expect(dedupeCompare(a, b)).toBe('duplicate');
          expect(pair.distance).toBe(hammingDistance(a, b));
        }
      }),
    );
  });

  it('completeness: NO keep-both pair (distance > threshold) is ever surfaced', () => {
    fc.assert(
      fc.property(arbItems, (items) => {
        const surfaced = new Set(findDuplicatePairs(items).map((p) => `${p.a}|${p.b}`));
        // Brute-force the truth set independently and check the two agree exactly.
        const withHash = items.filter((it) => it.phash !== null);
        for (let i = 0; i < withHash.length; i++) {
          for (let j = i + 1; j < withHash.length; j++) {
            const left = withHash[i]!;
            const right = withHash[j]!;
            const d = hammingDistance(parsePhash(left.phash!), parsePhash(right.phash!));
            const [a, b] = left.id < right.id ? [left.id, right.id] : [right.id, left.id];
            const key = `${a}|${b}`;
            if (d <= DEDUPE_HAMMING_THRESHOLD) expect(surfaced.has(key)).toBe(true);
            else expect(surfaced.has(key)).toBe(false);
          }
        }
      }),
    );
  });

  it('input-order-invariant: shuffling the items yields the same pairs', () => {
    fc.assert(
      fc.property(arbItems, fc.integer({ min: 0, max: 1_000 }), (items, seed) => {
        // A deterministic shuffle driven by the seed (no Math.random — pure).
        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (seed * (i + 1) + 7) % (i + 1);
          const tmp = shuffled[i]!;
          shuffled[i] = shuffled[j]!;
          shuffled[j] = tmp;
        }
        expect(findDuplicatePairs(shuffled)).toEqual(findDuplicatePairs(items));
      }),
    );
  });

  it('items with null or malformed phash never appear in any pair', () => {
    const items: DedupeCandidateItem[] = [
      { id: 'good-1', phash: '0' },
      { id: 'good-2', phash: '1' }, // 1 bit from good-1 → duplicate
      { id: 'null-1', phash: null },
      { id: 'bad-1', phash: 'notanumber' }, // malformed → skipped, not thrown
      { id: 'bad-2', phash: '12.5' }, // non-integer → malformed → skipped
    ];
    const pairs = findDuplicatePairs(items);
    const seen = new Set(pairs.flatMap((p) => [p.a, p.b]));
    expect(seen.has('null-1')).toBe(false);
    expect(seen.has('bad-1')).toBe(false);
    expect(seen.has('bad-2')).toBe(false);
    // the two good ones DO surface
    expect(pairs).toContainEqual({ a: 'good-1', b: 'good-2', distance: 1 });
  });

  it('threshold boundary: a pair at exactly the threshold surfaces; one bit beyond does not', () => {
    // Base 0; flip exactly THRESHOLD bits for the "at boundary" item, THRESHOLD+1 for "beyond".
    const flip = (count: number): string => {
      let bits = 0n;
      for (let p = 0; p < count; p++) bits |= 1n << BigInt(p);
      return bits.toString(10); // DECIMAL wire form (bigint::text), not hex
    };
    const items: DedupeCandidateItem[] = [
      { id: 'base', phash: flip(0) },
      { id: 'at', phash: flip(DEDUPE_HAMMING_THRESHOLD) },
      { id: 'beyond', phash: flip(DEDUPE_HAMMING_THRESHOLD + 1) },
    ];
    const pairs = findDuplicatePairs(items);
    const keys = new Set(pairs.map((p) => `${p.a}|${p.b}`));
    // base↔at is exactly at the threshold → MUST surface (kills the `<` off-by-one mutant).
    expect(keys.has('at|base')).toBe(true);
    expect(pairs.find((p) => p.a === 'at' && p.b === 'base')?.distance).toBe(DEDUPE_HAMMING_THRESHOLD);
    // base↔beyond is one bit past → MUST NOT surface.
    expect(keys.has('base|beyond')).toBe(false);
  });

  it('identical phashes always surface as a duplicate pair (distance 0)', () => {
    const items: DedupeCandidateItem[] = [
      { id: 'a', phash: '12345678901234567' },
      { id: 'b', phash: '12345678901234567' },
    ];
    expect(findDuplicatePairs(items)).toEqual([{ a: 'a', b: 'b', distance: 0 }]);
  });

  it('never pairs an item with itself, and pair count ≤ n(n-1)/2', () => {
    fc.assert(
      fc.property(arbItems, (items) => {
        const pairs = findDuplicatePairs(items);
        const n = items.filter((it) => it.phash !== null).length;
        expect(pairs.length).toBeLessThanOrEqual((n * (n - 1)) / 2);
        for (const p of pairs) expect(p.a).not.toBe(p.b);
      }),
    );
  });

  it('sorted by ascending distance then id (deterministic output ordering)', () => {
    fc.assert(
      fc.property(arbItems, (items) => {
        const pairs = findDuplicatePairs(items);
        for (let i = 1; i < pairs.length; i++) {
          const prev = pairs[i - 1]!;
          const cur = pairs[i]!;
          const ordered =
            prev.distance < cur.distance ||
            (prev.distance === cur.distance && (prev.a < cur.a || (prev.a === cur.a && prev.b <= cur.b)));
          expect(ordered).toBe(true);
        }
      }),
    );
  });

  it('parses the ACTUAL wire form the repos emit (bigint::text decimal), not hex', () => {
    // Regression guard for the wire-contract bug: phash is a `bigint` column projected as
    // `phash::text`, so production values are LONG DECIMAL strings (these are the real harness
    // fixture values). The prior hex-only parsePhash rejected every one of them, so
    // findDuplicatePairs silently dropped all real items. These must parse and compare.
    const items: DedupeCandidateItem[] = [
      { id: 'a', phash: '1234567890123456789' },
      { id: 'b', phash: '1234567890123456789' }, // identical → must surface as distance 0
      { id: 'c', phash: '2234567890123456789' }, // a different real value
    ];
    const pairs = findDuplicatePairs(items);
    // a and b are byte-identical → a duplicate pair at distance 0 (proves decimal parsing works).
    expect(pairs).toContainEqual({ a: 'a', b: 'b', distance: 0 });
    // Every surfaced pair has a real numeric distance in range (nothing was dropped at parse).
    for (const p of pairs) {
      expect(p.distance).toBeGreaterThanOrEqual(0);
      expect(p.distance).toBeLessThanOrEqual(PHASH_BITS);
    }
  });

  it('empty / single-item / all-null inputs surface no pairs', () => {
    expect(findDuplicatePairs([])).toEqual([]);
    expect(findDuplicatePairs([{ id: 'x', phash: '0' }])).toEqual([]);
    expect(findDuplicatePairs([{ id: 'x', phash: null }, { id: 'y', phash: null }])).toEqual([]);
  });
});

describe('parsePhash — parse-don\'t-cast boundary (DECIMAL bigint::text form)', () => {
  it('accepts a base-10 integer string (the form the repos emit)', () => {
    expect(() => parsePhash('0')).not.toThrow();
    expect(() => parsePhash('9007199254740993')).not.toThrow();
    expect(() => parsePhash('18446744073709551615')).not.toThrow(); // 2^64-1, 20 digits
  });

  it('rejects a non-numeric / non-integer string', () => {
    expect(() => parsePhash('notanumber')).toThrow(BoundaryParseError);
    expect(() => parsePhash('12.5')).toThrow(BoundaryParseError);
    expect(() => parsePhash('0xdeadbeef')).toThrow(BoundaryParseError);
    expect(() => parsePhash('')).toThrow(BoundaryParseError);
  });

  it('rejects more than 20 digits (beyond the 64-bit range the wire form can hold)', () => {
    expect(() => parsePhash('123456789012345678901')).toThrow(BoundaryParseError);
  });

  it('rejects non-string input', () => {
    expect(() => parsePhash(42)).toThrow(BoundaryParseError);
    expect(() => parsePhash(null)).toThrow(BoundaryParseError);
  });

  it('a decimal string in the 64-bit range round-trips to the same value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (n) => {
        expect(parsePhash(n.toString(10)) as bigint).toBe(n);
      }),
    );
  });
});
