// SHA-256 → lowercase hex, as a PURE INJECTABLE over a digest surface.
//
// Split from the native binding for the reason revenueCatPort.ts is split from
// revenueCatNative.ts: `expo-crypto` is a native module, so the decision logic here is only
// testable if the digest call is injected. And there IS decision logic — the byte→hex step —
// which is exactly where a silent, security-relevant bug lives (see the zero-pad note below).
//
// WHY HEX AND NOT BASE64: SOURCE_PHOTO_HASH_RE is /^[A-Za-z0-9_-]{1,128}$/, so standard
// base64's `+`, `/` and `=` all fail it — and a `/` would let one hash widen into a second
// Storage path segment, since this value is interpolated into `{sub}/{hash}/original`.

// The one method this needs from expo-crypto. Declared locally rather than imported so this
// module has no native dependency at all.
export interface DigestSurface {
  (bytes: ArrayBuffer): Promise<ArrayBuffer>;
}

// SHA-256 is 32 bytes → 64 hex characters. Asserted rather than assumed: a digest surface
// that returned a truncated buffer would produce a SHORTER hash that still passes
// SOURCE_PHOTO_HASH_RE (it has no length floor), so it would sail through validation and
// silently weaken the content-address that the whole per-photo idempotency design rests on.
const SHA256_BYTES = 32;

export function makeSha256Hex(digest: DigestSurface): (bytes: ArrayBuffer) => Promise<string> {
  return async (bytes: ArrayBuffer): Promise<string> => {
    const digested = new Uint8Array(await digest(bytes));
    if (digested.length !== SHA256_BYTES) {
      // Not a hash we are willing to use as a storage key. Fails loudly here rather than
      // producing a valid-looking short key.
      throw new Error('sha256_digest_length_unexpected');
    }
    return [...digested]
      // padStart(2, '0') is the load-bearing character of this file. Without it a byte below
      // 0x10 renders as one nibble ('a' rather than '0a'), so the hex string is short by one
      // character per such byte — and since SOURCE_PHOTO_HASH_RE has no length requirement,
      // the malformed hash is accepted, becomes the storage key, and two different photos can
      // collide onto one key. It fails as data corruption, never as an error.
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };
}
