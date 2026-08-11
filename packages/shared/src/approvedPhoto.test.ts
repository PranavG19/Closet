// The approval brand — the ONLY thing that makes a photo eligible for upload.
//
// THE ORACLE IS NOT THIS MODULE'S OUTPUT. The expected hash is computed with
// node:crypto's SHA-256 (a different implementation than the injected digest the
// minter calls), and the expected storage key is a hand-written literal. So a bug
// inside approvePhoto / sourcePhotoObjectKey cannot make its own test agree.
//
// WHAT THIS FILE CANNOT PROVE, stated so nobody reads more into a green run:
// classifier RECALL — whether an on-device model really catches intimate / not-her
// photos. That is a device-ML oracle needing a human-curated labeled corpus
// (docs/05 §163-174 + :205, docs/06 §8.3) and is explicitly out of scope. This file
// proves only that an unapproved photo has NO representable hash, hence no upload
// key and no parse request.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { approvePhoto, PhotoNotApprovable, sourcePhotoObjectKey, type Sha256Hex } from './approvedPhoto.js';
import {
  screenPhoto,
  tapApproved,
  type PhotoVerdict,
  type PickedPhoto,
  type ScreenedPhoto,
  type TappedPhoto,
} from './ports/PhotoIntakePort.js';
import { BoundaryParseError } from './parse.js';

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

// A stand-in for camera-roll bytes. Not a real JPEG: nothing here decodes an image.
const PHOTO_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;

// A SECOND, genuinely different photo's bytes. It has to be a whole second photo rather than
// a second `bytes` argument, because the minter no longer takes bytes at all — they come from
// inside the tap. That is the property under test everywhere below: content and consent cannot
// be separated, so "different content" means "a different photo she tapped".
const OTHER_PHOTO_BYTES = new Uint8Array([0x09, 0x09]).buffer;

// The INDEPENDENT oracle: a different SHA-256 implementation than the one under test.
function nodeSha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

// The digest port the app supplies on device (expo-crypto). Here: node:crypto, so
// the minter is exercised against a real hash rather than a canned string.
const realDigest: Sha256Hex = async (bytes) => nodeSha256Hex(bytes);

// A photo the classifier passed AND she tapped approve on. Built through the two real
// minters — screenPhoto then tapApproved — because both links carry an unexported
// `unique symbol` brand: an object literal cannot produce either, so there is no shorter
// way to write this fixture, which is exactly the property the brands exist to have.
// The verdict is what makes it mintable at all; the tap is what makes it hers.
function pickedFixture(id = 'photo-1', bytes: ArrayBuffer = PHOTO_BYTES): PickedPhoto {
  return {
    id,
    uri: `file:///tmp/${id}.jpg`,
    bytes,
    contentType: 'image/jpeg',
    source: 'hand_picked',
  };
}

function tappedFixture(verdict: PhotoVerdict = 'candidate', photo = pickedFixture()): TappedPhoto {
  return tapApproved(screenPhoto(photo, verdict));
}

async function approveFixture(): ReturnType<typeof approvePhoto> {
  return approvePhoto({ tapped: tappedFixture(), sha256Hex: realDigest });
}

describe('approvePhoto — the sole minter of an uploadable photo', () => {
  it('derives source_photo_hash as the SHA-256 of the bytes (independent oracle)', async () => {
    const approved = await approveFixture();
    // Computed by node:crypto here, not read back from the module under test.
    expect(approved.source_photo_hash).toBe(nodeSha256Hex(PHOTO_BYTES));
  });

  it('produces a hash the wire schema accepts — 64 lowercase hex, no path characters', async () => {
    const approved = await approveFixture();
    // SOURCE_PHOTO_HASH_RE is /^[A-Za-z0-9_-]{1,128}$/. Base64 would fail it ('+', '/',
    // '='), and a '/' would let one hash widen into a second path segment.
    expect(approved.source_photo_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.source_photo_hash).not.toMatch(/[/.:+=]/);
  });

  it('is CONTENT-addressed: the same bytes approved twice yield the same hash', async () => {
    // This is the per-photo idempotency key the whole parse design rests on
    // (UNIQUE(user_id, source_photo_hash)). A metadata-derived hash would break it on
    // a re-pick or a second device and burn a teaser-cap slot per duplicate.
    const a = await approveFixture();
    const b = await approveFixture();
    expect(a.source_photo_hash).toBe(b.source_photo_hash);
  });

  it('different bytes yield a different hash', async () => {
    // A DIFFERENT PHOTO, tapped for real — not the same tap with different bytes handed in
    // alongside it. That call no longer exists: the minter reads the bytes out of the tap, so
    // pairing one photo's consent with another photo's content is unrepresentable. The
    // distinctness proof is unweakened — the two hashes must differ — but it now has to be
    // driven the only way content can differ, through a second screened-and-tapped photo.
    const a = await approveFixture();
    const other = await approvePhoto({
      tapped: tappedFixture('candidate', pickedFixture('photo-2', OTHER_PHOTO_BYTES)),
      sha256Hex: realDigest,
    });
    expect(a.source_photo_hash).not.toBe(other.source_photo_hash);
    // Anchored to the independent oracle at BOTH ends, so this cannot pass on two wrong hashes
    // that merely happen to differ.
    expect(a.source_photo_hash).toBe(nodeSha256Hex(PHOTO_BYTES));
    expect(other.source_photo_hash).toBe(nodeSha256Hex(OTHER_PHOTO_BYTES));
  });

  it('carries the bytes and the content type through unchanged', async () => {
    const approved = await approveFixture();
    expect(new Uint8Array(approved.bytes)).toEqual(new Uint8Array(PHOTO_BYTES));
    expect(approved.contentType).toBe('image/jpeg');
  });

  it('REFUSES a digest that is not a valid source_photo_hash (parse-don’t-cast)', async () => {
    // A digest port returning base64, or an empty string, or a path-shaped value must
    // not become a branded hash — it would later be interpolated into a storage key.
    for (const bad of ['', 'a/b', 'not+base64/valid=', 'x'.repeat(129), '../etc']) {
      await expect(
        approvePhoto({ tapped: tappedFixture(), sha256Hex: async () => bad }),
      ).rejects.toBeInstanceOf(BoundaryParseError);
    }
  });
});

describe('sourcePhotoObjectKey — ONE composer, shared by client and server', () => {
  // WHY THIS LIVES IN shared: before it did, the client had to re-compose
  // `{sub}/{hash}/original` by hand because mobile cannot import @closet/functions.
  // Two composers of one security-relevant string with no compile-time link is the
  // same shape as the {job_id}/{user_id} inversion this repo already ate.
  const HASH = 'PHOTOHASH1';
  // Independently authored literal — never a re-computation of the code under test.
  const EXPECTED_KEY = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d/PHOTOHASH1/original';

  it('composes {user_id}/{source_photo_hash}/original', () => {
    expect(sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH })).toBe(EXPECTED_KEY);
  });

  it('FIRST segment is the owning user_id — migration 0013’s predicate', () => {
    // (storage.foldername(name))[1] = auth.uid()::text. An inversion fails HERE.
    const key = sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH });
    expect(key.split('/')[0]).toBe(USER_ID);
    expect(key.split('/')[0]).not.toBe(HASH);
  });

  it('carries NO file extension', () => {
    // The content type travels as object metadata; an extension would be one more
    // client-shaped string inside a security-relevant name.
    const key = sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH });
    expect(key.endsWith('/original')).toBe(true);
    expect(key).not.toMatch(/\.(jpe?g|png)$/i);
  });
});

// THE VERDICT GATE. A reviewer refuted the original design: approvePhoto took bare bytes
// with no reference to a screening verdict, so the brand meant "somebody called the minter",
// not "she approved a screened photo". Four bypasses compiled and passed the whole suite —
// the loudest was a "background backup" module that fed EVERY picked photo, approved or not,
// straight to the minter and then to the upload seam. Requiring the ScreenedPhoto moves the
// check from every caller's discipline into the one function that can mint.
describe('approvePhoto — the verdict is checked at the mint, not by the caller', () => {
  it('REFUSES a rejected photo — the upload half of docs/01:44', async () => {
    await expect(
      approvePhoto({ tapped: tappedFixture('rejected'), sha256Hex: realDigest }),
    ).rejects.toBeInstanceOf(PhotoNotApprovable);
  });

  it('FAILS CLOSED on undetermined — an unknown verdict is not a passed one', async () => {
    await expect(
      approvePhoto({ tapped: tappedFixture('undetermined'), sha256Hex: realDigest }),
    ).rejects.toBeInstanceOf(PhotoNotApprovable);
  });

  it('names only the verdict in the error — never the photo uri or bytes (PII)', async () => {
    const thrown = await approvePhoto({
      tapped: tappedFixture('rejected'),
      sha256Hex: realDigest,
    }).catch((error: unknown) => error);
    const message = (thrown as Error).message;
    expect(message).toContain('rejected');
    expect(message).not.toContain('file:///');
    expect(message).not.toContain('photo-1');
  });

  it('FREEZES the minted photo, so bytes cannot be swapped after approval', async () => {
    const approved = await approveFixture();
    expect(Object.isFrozen(approved)).toBe(true);
  });
});

// THE TAP-IDENTITY BACKSTOP — and THIS ONE CANNOT BE A TYPECHECK FIXTURE.
//
// Every other bypass in this chain is refused by the compiler, and each has a fixture under
// packages/mobile/typecheck-fixtures/ that proves tsc rejects it. This one is different in kind:
// it COMPILES BY DESIGN. `Object.assign({}, legitTapped, { screened: forged })` is a legal
// TypeScript expression with zero casts — the phantom `[TAPPED]` brand is a compile-time-only
// property, so the spread copies it onto the merged object while the `screened` payload is
// replaced wholesale. tsc has nothing to complain about, and a "does not compile" fixture would
// exit 0 and assert the opposite of the truth. The oracle therefore HAS to be runtime, which is
// exactly what the WeakSet in tapApproved provides: it records the identity of the objects that
// function actually produced, and a merged copy is a NEW object that was never in it.
//
// A red team walked this exact forgery: the forged photo can be GENUINELY screened with a
// genuine `candidate` verdict, so the verdict check passes and cannot help. What is forged is
// her CONSENT, and consent is an identity fact, not a shape fact.
describe('approvePhoto — the tap must be one tapApproved actually minted (runtime oracle)', () => {
  it('REFUSES a tap forged by merging onto a legitimate one, and MINTS the real one', async () => {
    const legitTapped = tappedFixture('candidate', pickedFixture('photo-she-tapped'));
    // A real screening of a photo she never saw, let alone tapped: the verdict below is
    // `candidate` for real, so nothing about the SHAPE of this tap is wrong.
    const intimate = screenPhoto(pickedFixture('photo-never-tapped', OTHER_PHOTO_BYTES), 'candidate');

    // The forgery, written the way it actually compiles — no `as`, no ts-expect-error.
    const forgedTap = Object.assign({}, legitTapped, { screened: intimate });
    await expect(approvePhoto({ tapped: forgedTap, sha256Hex: realDigest })).rejects.toBeInstanceOf(
      PhotoNotApprovable,
    );

    // THE POSITIVE CONTROL, and it is not optional: without it this test would pass just as
    // happily if approvePhoto threw on EVERYTHING (a broken WeakSet, a reverted minter, an
    // exception thrown before the identity check). The legitimate tap must still resolve, and
    // must hash the photo SHE tapped rather than the forged one.
    const approved = await approvePhoto({ tapped: legitTapped, sha256Hex: realDigest });
    expect(approved.source_photo_hash).toBe(nodeSha256Hex(PHOTO_BYTES));
    expect(approved.source_photo_hash).not.toBe(nodeSha256Hex(OTHER_PHOTO_BYTES));
  });

  it('refuses a tap whose bytes were swapped, even keeping the SAME screened object', async () => {
    // The narrower version of the same laundering: keep the legitimately-screened photo and
    // replace only the bytes underneath it. The hash re-check at the upload chokepoint cannot
    // catch this one either — the key is content-addressed over the FOREIGN bytes, so it agrees
    // with itself. Identity is what refuses it.
    const legitTapped = tappedFixture('candidate', pickedFixture('photo-she-tapped'));
    const swapped = Object.assign({}, legitTapped, {
      screened: Object.assign({}, legitTapped.screened, {
        photo: { ...legitTapped.screened.photo, bytes: OTHER_PHOTO_BYTES },
      }),
    });
    await expect(approvePhoto({ tapped: swapped, sha256Hex: realDigest })).rejects.toBeInstanceOf(
      PhotoNotApprovable,
    );
  });
});

// THE TAP'S PAYLOAD CANNOT CHANGE BEHIND ITS IDENTITY.
//
// `isMintedTap` is a WeakSet membership test, so it proves only that THIS OBJECT came from
// tapApproved. A red team showed identity alone is not enough: alias a registered tap through
// a mutable interface (`readonly` is not checked on assignability, so no cast is needed),
// reassign `.screened`, and the same object — still in the WeakSet — carries a photo she never
// approved. It uploaded intimate bytes end to end, and the chokepoint's content-addressed hash
// re-check agreed with itself because the key was derived from the swapped bytes.
//
// These cannot be typecheck fixtures: both mutations COMPILE by design, so a "does not compile"
// fixture would exit 0 and assert the opposite of the truth. The oracle has to be runtime.
describe('a registered tap is immutable — identity is not enough on its own', () => {
  it('REFUSES an in-place swap of the screened photo (frozen, so the write throws)', async () => {
    const tapped = tapApproved(screenPhoto(pickedFixture('hers', PHOTO_BYTES), 'candidate'));
    const intimate = screenPhoto(pickedFixture('intimate', OTHER_PHOTO_BYTES), 'candidate');
    // The alias needs no cast — this is the exact shape the reviewer compiled.
    interface MutableTap {
      screened: ScreenedPhoto;
    }
    const alias: MutableTap = tapped;
    expect(() => {
      alias.screened = intimate;
    }).toThrow(TypeError);
    // POSITIVE CONTROL: the legitimate tap still mints, and hashes the photo SHE tapped —
    // without this the test could pass because everything throws.
    const approved = await approvePhoto({ tapped, sha256Hex: realDigest });
    expect(approved.source_photo_hash).toBe(nodeSha256Hex(PHOTO_BYTES));
  });

  it('REFUSES an Object.assign forgery — the phantom brand is copied, membership is not', async () => {
    const legit = tapApproved(screenPhoto(pickedFixture('hers', PHOTO_BYTES), 'candidate'));
    // Compiles with zero casts: the brand is erased at runtime, so merging onto a real tap
    // produces a value TypeScript accepts as a TappedPhoto. Only the WeakSet can tell.
    const forged = Object.assign({}, legit, {
      screened: screenPhoto(pickedFixture('intimate', OTHER_PHOTO_BYTES), 'candidate'),
    });
    await expect(approvePhoto({ tapped: forged, sha256Hex: realDigest })).rejects.toBeInstanceOf(
      PhotoNotApprovable,
    );
  });
});
