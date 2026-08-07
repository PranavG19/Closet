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
  type Phash,
} from './dedupe.js';
import { BoundaryParseError } from './parse.js';

// A Phash arbitrary: 64 random bits → 16-char hex → parsePhash (the real boundary).
const arbPhash: fc.Arbitrary<Phash> = fc
  .bigInt({ min: 0n, max: (1n << 64n) - 1n })
  .map((n) => parsePhash(n.toString(16).padStart(16, '0')));

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
      mutated: parsePhash(mutated.toString(16).padStart(16, '0')),
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
    const a = parsePhash('0000000000000000');
    const near = parsePhash('0000000000000001'); // 1 bit apart
    const far = parsePhash('ffffffffffffffff'); // 64 bits apart
    expect(dedupeCompare(a, near)).toBe('duplicate');
    expect(dedupeCompare(a, far)).toBe('keep-both');
  });
});

describe('parsePhash — parse-don\'t-cast boundary', () => {
  it('accepts a well-formed 16-char lowercase hex string', () => {
    expect(() => parsePhash('0123456789abcdef')).not.toThrow();
  });

  it('rejects wrong length', () => {
    expect(() => parsePhash('abc')).toThrow(BoundaryParseError);
    expect(() => parsePhash('0123456789abcdef0')).toThrow(BoundaryParseError);
  });

  it('rejects non-hex charset (incl. uppercase)', () => {
    expect(() => parsePhash('zzzzzzzzzzzzzzzz')).toThrow(BoundaryParseError);
    expect(() => parsePhash('0123456789ABCDEF')).toThrow(BoundaryParseError);
  });

  it('rejects non-string input', () => {
    expect(() => parsePhash(42)).toThrow(BoundaryParseError);
    expect(() => parsePhash(null)).toThrow(BoundaryParseError);
  });

  it('parsed hex round-trips back to the same 64-bit value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (n) => {
        const hex = n.toString(16).padStart(16, '0');
        expect(parsePhash(hex) as bigint).toBe(n);
      }),
    );
  });
});
