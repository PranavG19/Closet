// The byte→hex encoder, graded against TWO oracles neither of which is this module:
//
//   1. Node's own `crypto.createHash('sha256').digest('hex')`. A completely separate
//      implementation of the same transform, so agreement is real evidence rather than the
//      module confirming itself.
//   2. PUBLISHED SHA-256 TEST VECTORS (FIPS 180-4 / RFC 6234) — constants I did not compute,
//      which is what makes the first oracle non-circular: if both implementations were wrong
//      in the same way they would still agree with each other, but not with these.
//
// WHY THIS TINY FUNCTION GETS ITS OWN SUITE: its output becomes the Storage object key and
// the per-photo idempotency key. A dropped zero-pad shortens the hash by one character per
// byte below 0x10 — and SOURCE_PHOTO_HASH_RE has no length floor, so a malformed short hash
// PASSES validation, becomes a real key, and lets two different photos collide onto one
// object. That failure is silent data corruption, never an error. The vectors below include
// digests with leading-zero bytes for exactly that reason.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { makeSha256Hex, type DigestSurface } from './sha256Hex.js';

// The digest surface expo-crypto provides on device, backed here by Node so no native module
// is involved. This is the SURFACE under injection, not the thing being graded.
const nodeDigest: DigestSurface = async (bytes: ArrayBuffer): Promise<ArrayBuffer> => {
  const hashed = createHash('sha256').update(new Uint8Array(bytes)).digest();
  return hashed.buffer.slice(hashed.byteOffset, hashed.byteOffset + hashed.byteLength) as ArrayBuffer;
};

function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

const sha256Hex = makeSha256Hex(nodeDigest);

describe('makeSha256Hex — against published SHA-256 vectors', () => {
  // FIPS 180-4 / RFC 6234 published digests. Not computed here.
  const VECTORS: readonly (readonly [string, string])[] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ];

  for (const [input, expected] of VECTORS) {
    it(`matches the published digest for ${input === '' ? '(empty)' : `"${input.slice(0, 12)}…"`}`, async () => {
      expect(await sha256Hex(bytesOf(input))).toBe(expected);
    });
  }
});

describe('makeSha256Hex — against a second independent implementation', () => {
  it('agrees with node:crypto hex output over 200 varied inputs', async () => {
    // Deterministic inputs (no fast-check dependency needed): every byte length 0..199, each
    // filled with a rotating byte pattern, so the corpus contains plenty of bytes < 0x10 —
    // which is where the zero-pad bug hides.
    for (let length = 0; length < 200; length += 1) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 7 + length) % 256;
      const buffer = bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer;
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(await sha256Hex(buffer)).toBe(expected);
    }
  });

  it('is always exactly 64 lowercase hex characters', async () => {
    // The property a padStart bug breaks. Checked as a shape, independent of any one vector.
    for (let length = 0; length < 64; length += 1) {
      const bytes = new Uint8Array(length).fill(length);
      const hex = await sha256Hex(bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('makeSha256Hex — the output is legal as a storage path segment', () => {
  it('contains no character that could widen the key into a second segment', async () => {
    // The hash is interpolated into `{sub}/{hash}/original`, and it is re-validated against
    // SOURCE_PHOTO_HASH_RE inside approvePhoto. Hex satisfies that regex; base64 would not.
    const hex = await sha256Hex(bytesOf('a garment photo'));
    expect(hex).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(hex).not.toContain('/');
    expect(hex).not.toContain('.');
    expect(hex).not.toContain('=');
    expect(hex).not.toContain('+');
  });
});

describe('makeSha256Hex — refuses a digest it cannot trust', () => {
  it('throws on a TRUNCATED digest rather than returning a short key', async () => {
    // A short hex string still passes SOURCE_PHOTO_HASH_RE (no length floor), so without this
    // check a broken digest surface would silently produce a weak content-address and let two
    // photos collide onto one storage object.
    const truncating: DigestSurface = async () => new Uint8Array(8).buffer;
    await expect(makeSha256Hex(truncating)(bytesOf('x'))).rejects.toThrow(
      'sha256_digest_length_unexpected',
    );
  });

  it('throws on an OVER-LONG digest too', async () => {
    const overlong: DigestSurface = async () => new Uint8Array(64).buffer;
    await expect(makeSha256Hex(overlong)(bytesOf('x'))).rejects.toThrow(
      'sha256_digest_length_unexpected',
    );
  });
});
