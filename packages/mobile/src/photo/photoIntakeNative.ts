// THE ONLY file that would import a photo-picker / screener SDK. Everything else depends on
// PhotoIntakePort, which is why intake.ts and stage.ts are unit-testable without a device.
// Mirrors revenueCatNative.ts, and for the same structural reason.
//
// NOT BOUND TO ANY NATIVE MODULE, and that is a REPORTED CHOICE, not an oversight.
// packages/mobile's dependencies are: @closet/shared, google-signin, supabase-js,
// react-query, expo, expo-apple-authentication, expo-crypto, expo-secure-store, react,
// react-native, safe-area-context, url-polyfill. Every module this seam needs is absent:
//
//   expo-image-picker      — pick photos
//   expo-file-system       — read the picked file's BYTES (require.resolve from this package
//                            fails MODULE_NOT_FOUND; it resolves only transitively inside
//                            `expo`, so importing it here would break at runtime, not build)
//   expo-image-manipulator — re-encode to strip EXIF/GPS
//   an on-device ML runtime (tflite / onnx / coreml / mlkit) — the screener
//
// Adding any of them mutates pnpm-lock.yaml, which docs/ORCHESTRATION.md declares a strict
// single-writer file (a parallel dep-installing task has already collided over it once,
// b389a64). The task brief for this work says explicitly: do not add an npm dependency; define
// the port and leave the adapter unimplemented with a clear TODO. So this reports
// `available: false`, which the screen renders as an honest unavailable state — the same
// correct failure mode as the unconfigured paywall, and the opposite of the pre-existing
// `onPress={() => {}}` dead buttons in WardrobeScreen/OutfitsScreen.
//
// THE HASHER, HOWEVER, IS REAL. expo-crypto IS already a declared dependency and already used
// (src/session/nativeProviders.ts), so sha256Hex is bound to the actual native digest — via
// makeSha256Hex, whose byte→hex step is graded against published SHA-256 vectors. Only the
// bytes-reading half is missing.
//
// TO FINISH WIRING THIS (blocked on a dependency decision, which is the owner's call):
//   1. Add expo-image-picker, expo-file-system, expo-image-manipulator to
//      packages/mobile/package.json BY HAND, then `pnpm install --lockfile-only`. (`pnpm add`
//      aborts the package.json write in this repo — the prepare script's lefthook install
//      fails on a global core.hooksPath. Same note as revenueCatNative.ts step 1.)
//   2. pickPhotos: ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images',
//      allowsMultipleSelection: true }). The SYSTEM PICKER IS the degraded path docs/01:46
//      requires — on iOS 14+ limited access it works without full-library permission, so
//      hand-picking must never be gated behind a permission request.
//   3. STRIP EXIF BEFORE HASHING, not after: ImageManipulator.manipulateAsync(uri, [],
//      { format: Jpeg, compress: 0.9 }) re-encodes and drops the APP1/Exif block. This is a
//      HARD requirement, not a nicety — iOS camera-roll files carry GPSLatitude/GPSLongitude,
//      `originals` is retained indefinitely (privacy-policy.md:129), and both paid vendors
//      fetch the object by URL, so an un-stripped photo forwards her home address to two
//      third-party processors (LAUNCH-READINESS §7.7, §8.6b). It must precede the hash because
//      after approvePhoto the hash is fixed and re-encoding would invalidate the storage key.
//      ITS ORACLE NEEDS A DEVICE RUN: assert the uploaded byte stream carries no APP1/Exif
//      marker. That is not assertable in Node and must not be declared done on a Node-side test.
//   4. Read bytes: FileSystem.readAsStringAsync(uri, { encoding: Base64 }) then decode to an
//      ArrayBuffer (supabase-js's own docs say React Native must upload an ArrayBuffer, not a
//      Blob/File/FormData).
//   5. screen(): the classifier. IT IS HUMAN-GATED AND MUST NOT BE SELF-GRADED. docs/06 §8.3
//      makes recall a make-or-break safety metric; LAUNCH-READINESS §6 lists the labeled
//      intimate/not-her corpus as a hard launch blocker with the human owning the go/no-go and
//      curating the corpus. Until it exists, `screeningAvailable` stays FALSE, which is what
//      keeps the UI's copy to the approval-tap claim only and blocks bulk library enumeration
//      (features/onboarding/intake.ts refuses an undetermined library_scan photo).
import type { PhotoIntakePort, PickedPhoto, ScreenedPhoto } from '@closet/shared';
import * as Crypto from 'expo-crypto';
import { screenPhoto } from '@closet/shared';
import { makeSha256Hex } from './sha256Hex.js';

export function makePhotoIntakePort(): PhotoIntakePort {
  return {
    // No picker SDK => no import path. The screen shows the unavailable state.
    available: false,
    // No classifier exists anywhere in this repo. This flag being false is what holds the
    // in-app copy to the approval-tap claim (content/store/app-store-listing.md:233 blocks any
    // "screened on your device" wording until the classifier clears a recall floor) and what
    // makes bulk library enumeration refuse to offer candidates.
    screeningAvailable: false,

    // Unreachable from the UI (no picker means no import button), but must not lie if called:
    // nothing was picked.
    async pickPhotos(): Promise<readonly PickedPhoto[]> {
      return [];
    },

    // No screener. Every verdict is `undetermined` — NOT `candidate`, which would be a lie
    // that reads as "screened and fine". The intake model decides what to do with an
    // undetermined verdict based on how the photo arrived: a hand-picked one is admitted (she
    // chose it in the system picker), an enumerated one is refused.
    async screen(photos: readonly PickedPhoto[]): Promise<readonly ScreenedPhoto[]> {
      return photos.map((photo) => screenPhoto(photo, 'undetermined'));
    },

    // REAL. expo-crypto is already a declared dependency; `digest` returns an ArrayBuffer, and
    // makeSha256Hex does the byte→hex step (graded against published SHA-256 vectors).
    sha256Hex: makeSha256Hex((bytes: ArrayBuffer) =>
      Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    ),
  };
}
