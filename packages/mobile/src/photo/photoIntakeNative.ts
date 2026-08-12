// THE ONLY file that would import a photo-picker / screener SDK. Everything else depends on
// PhotoIntakePort, which is why intake.ts and stage.ts are unit-testable without a device.
// Mirrors revenueCatNative.ts, and for the same structural reason.
//
// THE PICKER IS NOW BOUND (expo-image-picker + expo-image-manipulator + expo-file-system).
// `pickPhotos` opens the system library picker, RE-ENCODES each photo to strip EXIF/GPS
// BEFORE the bytes are read, and returns EXIF-stripped bytes + the re-encoded content type.
//
// THE SCREENER IS STILL ABSENT AND THAT IS DELIBERATE. `screeningAvailable` stays FALSE and
// every verdict is `undetermined` — because no on-device classifier exists, and shipping one
// requires a labeled intimate/not-her corpus graded against a recall floor, a hard launch
// blocker the OWNER owns (docs/06 §8.3, LAUNCH-READINESS §6). Keeping screening false is what
// holds the in-app copy to the approval-tap claim and BLOCKS bulk library enumeration
// (features/onboarding/intake.ts refuses an undetermined `library_scan` photo). So the
// privacy invariant is intact: the only photos that reach a reveal are ones SHE hand-picked
// and then tapped to approve. Wiring the picker does not weaken that — it makes the
// hand-picked path she already controls actually functional.
//
// EXIF STRIP IS A HARD REQUIREMENT, NOT A NICETY (privacy-policy.md:129, LAUNCH-READINESS
// §7.7/§8.6b): iOS camera-roll files carry GPSLatitude/GPSLongitude, `originals` is retained
// indefinitely, and both paid vendors fetch the object by URL — an un-stripped photo would
// forward a home address to two third-party processors. The re-encode drops the APP1/Exif
// block, and it MUST precede the hash: after `approvePhoto` the hash is fixed and re-encoding
// would invalidate the storage key. NOTE the device-run oracle this still needs: assert the
// uploaded byte stream carries no APP1/Exif marker — that is not assertable in Node.
//
// THE HASHER is expo-crypto (already a declared dependency, used in session/nativeProviders),
// bound via makeSha256Hex whose byte→hex step is graded against published SHA-256 vectors.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { PhotoIntakePort, PickedPhoto, ScreenedPhoto } from '@closet/shared';
import { screenPhoto } from '@closet/shared';
import { makeSha256Hex } from './sha256Hex.js';

// The re-encoded content type. The re-encode below always emits JPEG (SaveFormat.JPEG), so
// the object's declared type must say JPEG regardless of the source format — this is the only
// signal the vendors get about the bytes (the storage key carries no extension by design).
const REENCODED_CONTENT_TYPE = 'image/jpeg';
// JPEG quality for the EXIF-stripping re-encode. 0.9 keeps garment detail while dropping the
// metadata block; the point of the pass is the re-encode, not compression.
const REENCODE_QUALITY = 0.9;

// A per-session opaque id. Metro/Hermes has no global crypto.randomUUID, so mint via
// expo-crypto (the same reason SuggestionsScreen.mintClientId uses it).
function mintPhotoId(): string {
  return Crypto.randomUUID();
}

// Re-encode one picked asset to an EXIF-stripped JPEG, then read its bytes. Returns the
// device-only re-encoded uri (for the thumbnail) alongside the bytes that will be hashed and
// uploaded — the SAME bytes, so the content-addressed key matches what leaves the device.
async function toStrippedPhoto(uri: string): Promise<PickedPhoto> {
  // manipulate(...).renderAsync() applies the (empty) action list and materialises a new
  // image; saveAsync re-encodes to JPEG, which drops the APP1/Exif (incl. GPS) block.
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  const stripped = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: REENCODE_QUALITY });
  const bytes = await new File(stripped.uri).arrayBuffer();
  return {
    id: mintPhotoId(),
    source: 'hand_picked',
    uri: stripped.uri,
    bytes,
    contentType: REENCODED_CONTENT_TYPE,
  };
}

export function makePhotoIntakePort(): PhotoIntakePort {
  return {
    // The picker is bound, so the Add flow is functional.
    available: true,
    // No classifier exists anywhere in this repo. FALSE holds the in-app copy to the
    // approval-tap claim and makes bulk library enumeration refuse to offer candidates —
    // the privacy invariant, unchanged by wiring the picker.
    screeningAvailable: false,

    // Hand-pick import via the system library picker. On iOS 14+ limited access this works
    // WITHOUT requesting full-library permission — the system picker IS the permission model,
    // and the degraded path docs/01:46 requires must never be gated behind a permission
    // prompt, so no permission request is made here. Cancelling returns []. Each picked asset
    // is EXIF-stripped and byte-read before it is handed back.
    async pickPhotos(): Promise<readonly PickedPhoto[]> {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        // No base64 here — we re-encode to strip EXIF and read the stripped bytes ourselves,
        // so the picker's own (un-stripped) base64 would be the wrong bytes to hash.
      });
      if (result.canceled) return [];
      return Promise.all(result.assets.map((asset) => toStrippedPhoto(asset.uri)));
    },

    // No screener. Every verdict is `undetermined` — NOT `candidate`, which would be a lie
    // that reads as "screened and fine". The intake model admits an undetermined HAND-PICKED
    // photo (she chose it) and refuses an enumerated one; since pickPhotos only ever produces
    // hand_picked photos, this stays within the privacy invariant.
    async screen(photos: readonly PickedPhoto[]): Promise<readonly ScreenedPhoto[]> {
      return photos.map((photo) => screenPhoto(photo, 'undetermined'));
    },

    // REAL. expo-crypto's digest returns an ArrayBuffer; makeSha256Hex does the byte→hex step
    // (graded against published SHA-256 vectors).
    sha256Hex: makeSha256Hex((bytes: ArrayBuffer) =>
      Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    ),
  };
}
