// F4 — perceptual-hash near-duplicate compare. Pure, deterministic, O(1): a
// fixed-width bigint XOR + popcount over 64 bits. No I/O, no clock, no randomness.
// Parse once at the boundary (parsePhash), compare as bigint — never re-parse
// inside hammingDistance.
import { z } from 'zod';
import { parseBoundary } from './parse.js';

export const PHASH_BITS = 64;

// On-wire form: a 16-char lowercase hex string (a 64-bit hash).
const PhashHexSchema = z.string().regex(/^[0-9a-f]{16}$/, 'expected 16-char lowercase hex phash');

// Branded so a raw string cannot masquerade as a validated Phash without parsing.
export type Phash = bigint & { readonly __phash: unique symbol };

// parse-don't-cast: validate charset/length, then narrow to the bigint domain.
export function parsePhash(x: unknown): Phash {
  const hex = parseBoundary(PhashHexSchema, x, 'parsePhash');
  return BigInt(`0x${hex}`) as Phash;
}

const PHASH_MASK = (1n << BigInt(PHASH_BITS)) - 1n;

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
