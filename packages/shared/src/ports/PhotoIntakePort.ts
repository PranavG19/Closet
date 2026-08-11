// PhotoIntakePort — the on-device seam in front of the camera roll. Everything that
// touches a real photo lives behind it: selecting photos, screening them, and hashing
// their bytes.
//
// WHY A PORT AND NOT A DIRECT SDK CALL — the same reason BillingPort exists, plus a
// harder one. `expo-image-picker`, `expo-file-system`, `expo-image-manipulator` and any
// on-device ML runtime are ALL absent from packages/mobile's dependencies, and adding one
// mutates pnpm-lock.yaml (a declared single-writer file). Behind this port the add-garment
// screen and its whole decision layer are renderable and unit-testable with no native
// module, and the adapter that binds the real picker lands as a separate change.
//
// THE ORDER IS NOT NEGOTIABLE AND IS WHY `screen` TAKES ALREADY-PICKED PHOTOS: photos are
// selected on the device, screened on the device, and only then offered to her for an
// approval tap. There is deliberately NO server-side gate — docs/06 §2 and
// privacy-policy.md §2 both say why: "a server-side filter would already have received the
// photo." So no method here transmits anything, and nothing in this file knows about the
// network.
//
// WHAT THIS PORT DOES NOT PROMISE: that the screener actually catches intimate or not-her
// photos. That is RECALL — a device-ML property graded against an independent labeled
// corpus, a make-or-break safety metric the human owns (docs/06 §8.3, docs/05 §out-of-scope,
// LAUNCH-READINESS §6). `PhotoVerdict` has an `undetermined` case precisely so an absent or
// unsure screener is a representable, handled state instead of a silent "looks fine".
import type { Sha256Hex } from '../approvedPhoto.js';

// How a photo got here. It is load-bearing, not bookkeeping: it is the difference between
// a photo SHE chose one at a time and a photo the app enumerated on her behalf, and the
// decision layer treats an unscreened photo from those two sources differently (see
// features/onboarding/intake.ts). Bulk enumeration without a working screener would render
// an intimate photo as a candidate, which is the one thing docs/01:44 forbids.
export type PhotoIntakeSource =
  // She picked this exact photo in the system picker, one tap at a time. The system UI is
  // the selection, so an unscreened hand-picked photo is still hers-by-choice.
  | 'hand_picked'
  // The app enumerated the library and produced this without her looking at it. Only legal
  // when a screener is actually running.
  | 'library_scan';

// A photo on the device, not yet approved and not uploadable. It carries BYTES rather than
// a URI because the hash that becomes the storage key must be a hash of the bytes that are
// actually uploaded — hashing a uri/size/mtime string would compile and be wrong (the same
// photo re-picked, or seen on a second device, would yield a different key and defeat the
// per-photo idempotency the whole parse design rests on).
//
// THE ADAPTER MUST HAND OVER EXIF-STRIPPED BYTES. iOS camera-roll files carry
// GPSLatitude/GPSLongitude, the `originals` bucket is retained indefinitely, and two paid
// vendors fetch the object by URL — so an un-stripped photo forwards a home address to
// third-party processors (LAUNCH-READINESS §7.7, §8.6b). Stripping needs an on-device
// re-encode, so it belongs HERE, before the bytes are hashed: after `approvePhoto` the hash
// is fixed and re-encoding would invalidate it.
export interface PickedPhoto {
  // Stable within one intake session; used as a React key and to match an approval tap to
  // a photo. Opaque — never sent anywhere.
  readonly id: string;
  readonly source: PhotoIntakeSource;
  // A local, device-only URI for rendering the thumbnail. Never transmitted.
  readonly uri: string;
  readonly bytes: ArrayBuffer;
  // Sent as the Storage object's content type. The object key carries no extension by
  // design, so this is the only thing that tells the vendors what the bytes are.
  readonly contentType: string;
}

// The screener's verdict, as a CLOSED set with an explicit "don't know".
export type PhotoVerdict =
  // Looks like a clothing / outfit photo worth offering her. Still needs her approval tap.
  | 'candidate'
  // Set aside. Intimate, a screenshot, no person in it, or best-effort not-her. A rejected
  // photo is dropped from the model entirely — never rendered, never hashed, never uploaded.
  | 'rejected'
  // No screener ran, or it could not decide. NOT a synonym for `candidate`: what happens
  // next depends on how the photo got here (see PhotoIntakeSource).
  | 'undetermined';

// The screening brand. NOT exported — that is the mechanism. Without it, ScreenedPhoto was a
// bare structural interface, and a reviewer showed that made the verdict requirement on
// approvePhoto worth much less than it looked: any file could write
// `{ photo, verdict: 'candidate' }` as an object literal and mint a brand from an unscreened
// photo, with zero casts. Requiring the verdict only moved the forgery one level out. Now the
// verdict itself is unforgeable, so the chain is screener -> verdict -> approval -> upload,
// with no structural shortcut into the middle of it.
declare const SCREENED: unique symbol;

// A photo a screener has actually looked at. The ONLY way to obtain one is screenPhoto()
// below — an object literal cannot have the brand, however well it matches structurally.
export interface ScreenedPhoto {
  readonly photo: PickedPhoto;
  readonly verdict: PhotoVerdict;
  readonly [SCREENED]: true;
}

// THE APPROVAL-TAP BRAND. Also unexported, and it closes the last gap a reviewer found: after
// the verdict became unforgeable, a SECOND SCREEN could still import useAddGarment from the
// barrel and upload a screened photo she had never tapped — because no type carried "she tapped
// it". `candidate` is the screener's opinion; it is not her consent, and the docs are explicit
// that her tap (not the classifier) is the structural guarantee (docs/06 §2).
declare const TAPPED: unique symbol;

// A photo she has both been offered AND explicitly tapped approve on. Obtainable only from
// the intake's own approval bookkeeping (features/onboarding/intake.ts calls tapApproved for
// exactly the photos in its approval set), so a screen that never rendered the approval grid
// has no way to produce one.
export interface TappedPhoto {
  readonly screened: ScreenedPhoto;
  readonly [TAPPED]: true;
}

// THE ONLY constructor of a TappedPhoto. It takes an ALREADY-SCREENED photo, so the chain
// cannot be entered halfway: screenPhoto -> tapApproved -> approvePhoto -> upload.
//
// Like screenPhoto this records rather than decides — the intake module is what knows which
// ids are in her approval set. What the brand buys is that the recording cannot happen
// anywhere else, so "she tapped it" stops being a comment about call order.
export function tapApproved(screened: ScreenedPhoto): TappedPhoto {
  // The brand is erased at runtime, so a compile-time-only tap is forgeable by MERGING onto a
  // legitimate one: `Object.assign({}, legitTapped, { screened: forged })` type-checks with
  // zero casts, because the phantom brand is copied while the payload is replaced. A red team
  // did exactly that. WeakSet membership is the runtime half — it records the identity of the
  // objects this function actually produced, so a merged copy (a NEW object) is not in it.
  // FROZEN AT EVERY LEVEL the tap owns. WeakSet membership is object IDENTITY, and a red team
  // showed identity alone is not enough: alias a registered tap through a mutable interface
  // (`readonly` is not checked on assignability, so no cast is needed), reassign `.screened`,
  // and the SAME object — still in the WeakSet — now carries a photo she never approved. It
  // uploaded intimate bytes end to end, and the chokepoint's content-addressed hash re-check
  // agreed with itself. Freezing the tap and the screened record it wraps closes that: the
  // payload behind a registered identity can no longer change.
  //
  // `photo.bytes` is an ArrayBuffer whose CONTENTS are still writable — freeze does not extend
  // into a buffer. That is a genuine residual (see the note on approvePhoto): the defence there
  // is that the digest is taken from these exact bytes at mint time, so post-mint tampering
  // makes the hash disagree and the chokepoint refuses the upload.
  const tapped = Object.freeze({ screened: Object.freeze({ ...screened }) }) as TappedPhoto;
  MINTED_TAPS.add(tapped);
  return tapped;
}

// Identities minted here. A WeakSet, so it holds no strong reference and cannot leak a photo:
// entries vanish when the tap does, and it is unreachable from outside this module.
const MINTED_TAPS = new WeakSet<object>();

// Whether a value is a tap this module actually minted, rather than one merged or cast into
// shape. The verdict check alone cannot answer this: a forged tap can carry a genuinely
// screened photo whose verdict really is `candidate` — what is forged is the CONSENT.
export function isMintedTap(tapped: TappedPhoto): boolean {
  return MINTED_TAPS.has(tapped);
}

// THE ONLY constructor of a ScreenedPhoto — the seam a real classifier plugs into.
//
// It is deliberately trivial: it does not classify, it RECORDS a classification. The caller
// is the screener (or the adapter standing in for an absent one), and the brand is what makes
// "this verdict came from the screening step" a type-level fact rather than a convention.
//
// This is NOT a recall claim. Whether the verdict is CORRECT — whether a model really catches
// intimate / not-her photos — is a device-ML property graded against an independent labeled
// corpus (docs/06 §8.3, a hard launch blocker the human owns). This function makes the
// verdict's PROVENANCE structural; it says nothing about its accuracy.
export function screenPhoto(photo: PickedPhoto, verdict: PhotoVerdict): ScreenedPhoto {
  return { photo, verdict } as ScreenedPhoto;
}

export interface PhotoIntakePort {
  // Whether a real photo picker is bound at all. False in a build with no picker
  // dependency, which the screen renders as an honest "not available yet" state rather
  // than a button that throws — the same failure shape the paywall uses for an
  // unconfigured store.
  readonly available: boolean;

  // Whether a screener is actually running. FALSE means every verdict will be
  // `undetermined`, which in turn means the UI may claim ONLY the approval tap and must
  // not offer bulk library enumeration. It exists so the absence of the classifier is a
  // value the code branches on, instead of an assumption in a comment.
  readonly screeningAvailable: boolean;

  // Hand-pick import. The system picker IS the permission model on iOS 14+ (limited
  // access), so this path works for someone who declines full library access — the
  // degraded path docs/01:46 requires, which must still reach a reveal.
  pickPhotos(): Promise<readonly PickedPhoto[]>;

  // Screen photos already on the device. Returns one verdict per input photo, in the same
  // order, so the caller can never silently lose a photo between the two steps.
  screen(photos: readonly PickedPhoto[]): Promise<readonly ScreenedPhoto[]>;

  // SHA-256 of the bytes, lowercase hex. Lives on the port because the device
  // implementation is expo-crypto (a native module) and because `approvePhoto` — the only
  // constructor of an ApprovedPhoto — takes it as an argument rather than importing it.
  readonly sha256Hex: Sha256Hex;
}
