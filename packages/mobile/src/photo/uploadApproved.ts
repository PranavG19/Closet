// THE UPLOAD CHOKEPOINT — the only code in packages/mobile that writes bytes to the
// `originals` bucket. If a second one appears, the app's defining privacy invariant is
// no longer structural (chokepoint.test.ts fails if one does).
//
// IT ACCEPTS ONLY AN ApprovedPhoto. That type's brand is a module-private
// `unique symbol` in @closet/shared, so approvePhoto() — the approval-tap handler's
// minter — is the only thing that can produce one. Calling this with a raw camera-roll
// asset, a URI, or a structurally-identical object literal is not a representable call:
// it does not compile. That is the enforcement (Rule 2), because nothing server-side can
// help — Storage RLS (0013) permits ANY object under the caller's own prefix and cannot
// distinguish approved bytes from unapproved ones.
//
// THE CLIENT NEVER NAMES A PATH IT SENDS ANYWHERE. It composes an upload key for its OWN
// prefix (RLS refuses anything else) and returns ONLY the hash. The server independently
// derives `source_photo_path` from the verified JWT `sub` (parse-photo.ts →
// sourcePhotoObjectKey). `source_photo_path` is absent from CreateParseJobRequest and
// .strict() rejects it. This is the 44812c5 lesson: a path a VENDOR fetches is outside
// every DB policy's reach, so a client-named one is a cross-tenant read and an SSRF sink.
// Both sides now call the SAME composer from @closet/shared, so the two cannot drift.
//
// STILL MISSING AND NOT FIXABLE HERE — EXIF/GPS. iOS camera-roll files carry
// GPSLatitude/GPSLongitude, `originals` is retained indefinitely, and both paid vendors
// fetch the object. Stripping it needs an on-device re-encode (expo-image-manipulator),
// which is not a declared dependency of this package, and its only honest oracle ("no
// APP1/Exif marker in the uploaded byte stream") needs a device run. This module uploads
// whatever bytes it is handed: the strip belongs in the step that PRODUCES the
// ApprovedPhoto, before approvePhoto() hashes them. See LAUNCH-READINESS §7.7 / §8.6b.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sourcePhotoObjectKey, type ApprovedPhoto, type Sha256Hex } from '@closet/shared';

// Private bucket from migration 0013. Not configurable, for the same reason the cutouts
// bucket is not: the bucket name is half of the RLS predicate.
export const ORIGINALS_BUCKET = 'originals';

// A typed failure the caller can branch on. It deliberately carries NO detail from the
// Storage error: that message can contain the object path and is not written in this
// product's voice (the raw-error PII rule).
export class PhotoUploadError extends Error {
  constructor() {
    super('photo_upload_failed');
    this.name = 'PhotoUploadError';
  }
}

// The bytes do not hash to the key they would be stored under. Either the brand was
// laundered (bytes swapped after minting) or the digest port is inconsistent. Both are
// bugs, never a user-facing condition, so the message carries no photo detail.
export class PhotoHashMismatch extends Error {
  constructor() {
    super('photo_hash_mismatch');
    this.name = 'PhotoHashMismatch';
  }
}

export interface UploadApprovedPhotoInput {
  readonly client: SupabaseClient;
  // The signed-in user's own id (the JWT `sub`, from useSession). It is the first key
  // segment; 0013 refuses a write under any other prefix, so a wrong value fails CLOSED
  // at the database rather than writing somewhere unexpected.
  readonly userId: string;
  readonly photo: ApprovedPhoto;
  // The same digest port the minter used. Passed in (not imported) for the same reason:
  // the device implementation is native, and the backstop must be able to disagree with
  // the hash it is checking.
  readonly sha256Hex: Sha256Hex;
}

// What the parse step needs, and NOTHING else. Returning a path would invite a caller to
// forward it as `source_photo_path`; there is no path here to forward.
export interface UploadedPhotoRef {
  readonly source_photo_hash: string;
}

export async function uploadApprovedPhoto(
  input: UploadApprovedPhotoInput,
): Promise<UploadedPhotoRef> {
  // RUNTIME BACKSTOP. The brand is a compile-time nominal type and buys nothing at
  // runtime, so re-derive the digest and refuse a photo whose bytes do not match its
  // hash. A reviewer laundered intimate bytes into a legitimately-minted ApprovedPhoto
  // with a plain object spread — no cast, compiled clean, passed every test. This check
  // is what makes that unrepresentable at the seam that actually transmits, because the
  // key is content-addressed: bytes that do not hash to the key cannot be uploaded
  // under it.
  const actualDigest = await input.sha256Hex(input.photo.bytes);
  if (actualDigest !== input.photo.source_photo_hash) throw new PhotoHashMismatch();

  const objectKey = sourcePhotoObjectKey({
    userId: input.userId,
    sourcePhotoHash: input.photo.source_photo_hash,
  });

  const { error } = await input.client.storage.from(ORIGINALS_BUCKET).upload(
    objectKey,
    input.photo.bytes,
    {
      // The key has no extension and both vendors fetch this object by URL from their own
      // servers; supabase-js would otherwise store it as text/plain;charset=UTF-8.
      contentType: input.photo.contentType,
      // The key is content-addressed, so a re-upload writes byte-identical content.
      // Without this, a legitimate re-parse gets a 409 Duplicate from Storage while the
      // parse-job side replays happily — an asymmetry that reads as a random failure.
      upsert: true,
    },
  );

  // Covers both "RLS said no" and "the network died". Neither is worth distinguishing to
  // the caller, and neither message may reach the UI.
  if (error !== null) throw new PhotoUploadError();

  return { source_photo_hash: input.photo.source_photo_hash };
}
