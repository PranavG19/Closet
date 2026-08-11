// THE APPROVAL BRAND — this app's defining privacy constraint, expressed as a type.
//
// docs/00 invariant 1 / docs/06 §2 / privacy-policy.md §2 all say the same thing: the
// approval tap "is the only thing that makes a photo eligible for upload", and there is
// deliberately NO server-side gate, because a server filter has already received the
// photo. The server therefore has no way to tell an approved photo from an unapproved
// one: Storage RLS (migration 0013) permits ANY object under `{user_id}/…` in
// `originals`, and parse-photo accepts any well-formed hash. There is no approval token
// or column in any migration, and adding one would not help — the bytes would already
// be uploaded by the time the server saw it.
//
// So "an unapproved photo cannot be uploaded" is enforceable ONLY as a device-side
// STRUCTURAL property, and this is where it is enforced (Rule 2 — make the unsafe thing
// unrepresentable, at the highest tier reachable on-device):
//
//   1. ApprovedPhoto is a NOMINAL type. Its brand key is a module-private
//      `unique symbol` that is never exported, so no object literal, no `satisfies`,
//      and no structural match anywhere else in the codebase can produce one. The only
//      way to obtain an ApprovedPhoto is to call approvePhoto().
//   2. approvePhoto REQUIRES the ScreenedPhoto and refuses any verdict but `candidate`,
//      so the brand means "the screener passed this AND she tapped it" rather than
//      "somebody called the minter". The verdict is checked here, once, instead of by
//      the discipline of every call site.
//   3. The upload chokepoint and the parse call both require an ApprovedPhoto, so an
//      unapproved photo has no representable upload key and no representable parse
//      request. The chokepoint ALSO re-derives the digest and refuses bytes that do not
//      hash to their key — the runtime backstop, because a brand is erased at runtime.
//
// WHAT THE BRAND DOES NOT BUY, proven by a reviewer rather than assumed: it is a
// compile-time nominal type and NOTHING at runtime (`declare const` + a cast; the built
// JS carries no symbol and the object is not sealed by the type system). Two launderings
// needed no cast at all — an object spread onto a legitimately-minted brand, and aliasing
// the fields through a mutable interface, since `readonly` is not checked on
// assignability. Object.freeze here kills the mutation route; the chokepoint's hash
// re-check kills the spread route. Neither is optional.
//
// WHAT THIS DOES NOT DO, and must never be described as doing: it does not classify.
// Whether a model actually catches intimate / not-her photos is RECALL, a device-ML
// property graded against an independent labeled corpus (docs/06 §8.3 — a make-or-break
// safety metric the human owns). This type makes the approval tap load-bearing; it says
// nothing about what she was shown before she tapped.
import { parseBoundary } from './parse.js';
import { SourcePhotoHash } from './schemas/common.js';
import { isMintedTap, type PhotoVerdict, type TappedPhoto } from './ports/PhotoIntakePort.js';

// The brand key. NOT exported — that is the whole mechanism. `unique symbol` gives a
// nominal type: `{ source_photo_hash: '…', bytes, contentType }` is NOT an ApprovedPhoto
// however well it matches structurally, because it cannot have this property.
declare const APPROVED: unique symbol;

// A photo she has explicitly approved for upload, and the only value the upload seam
// accepts. `bytes` are the exact bytes that will be uploaded, so the hash and the
// uploaded object cannot disagree.
export interface ApprovedPhoto {
  // The per-photo idempotency key AND a derived storage path segment. Validated as a
  // SourcePhotoHash at mint time, so it can never widen into a second path segment.
  readonly source_photo_hash: string;
  readonly bytes: ArrayBuffer;
  // Sent as the Storage object's content-type. supabase-js otherwise defaults to
  // `text/plain;charset=UTF-8`, and the key carries no extension — both paid vendors
  // fetch this object by URL from their own servers, so a wrong type surfaces as a
  // vendor error dressed as an outage.
  readonly contentType: string;
  readonly [APPROVED]: true;
}

// The hashing port. Injected rather than imported because the device implementation is
// expo-crypto (a native module a unit test cannot load) and the oracle for this module
// must be a DIFFERENT SHA-256 than the one under test.
//
// IT MUST RETURN LOWERCASE HEX, and the reason is a schema constraint, not a preference:
// SOURCE_PHOTO_HASH_RE is /^[A-Za-z0-9_-]{1,128}$/, so standard base64 ('+', '/', '=')
// FAILS it — and a '/' would let one hash widen into a second storage path segment.
// A non-conforming digest is refused by approvePhoto rather than truncated or re-encoded.
//
// NO DEVICE IMPLEMENTATION EXISTS YET, deliberately. `expo-crypto.digest()` returns an
// ArrayBuffer (not hex, so it needs a byte→hex step), and reading a camera-roll photo's
// bytes at all requires `expo-file-system`, which is NOT a declared dependency of
// packages/mobile — `require.resolve` from that package fails. Adding it mutates
// pnpm-lock.yaml, a declared single-writer file. So the adapter belongs to the task that
// adds the picker; this port is what it plugs into. Hashing asset METADATA (uri + size +
// mtime) instead would compile and be wrong: the hash would stop being content-addressed,
// so the same photo re-picked or seen on a second device would yield a different key,
// defeating the per-photo idempotency the whole parse design rests on.
export type Sha256Hex = (bytes: ArrayBuffer) => Promise<string>;

export interface ApprovePhotoInput {
  // The photo she TAPPED, carrying the screener's verdict inside it. Requiring this — rather
  // than loose bytes, or even a bare ScreenedPhoto — is what makes the brand mean "the
  // screener passed it AND she tapped it" instead of "somebody called the minter". Both
  // links are unforgeable: TappedPhoto and ScreenedPhoto each carry their own unexported
  // brand, so neither can be written as an object literal. A `rejected` verdict is refused
  // below regardless.
  readonly tapped: TappedPhoto;
  readonly sha256Hex: Sha256Hex;
}

// Thrown when the minter is handed a photo the screener set aside. A throw rather than a
// null return: a caller that ignores a null would upload; a throw cannot be ignored by
// accident, and there is no legitimate recovery — a rejected photo is simply not eligible.
export class PhotoNotApprovable extends Error {
  constructor(verdict: PhotoVerdict) {
    // The verdict only, never the photo's uri or bytes (PII).
    super(`photo is not approvable: verdict=${verdict}`);
    this.name = 'PhotoNotApprovable';
  }
}

// THE ONLY constructor of an ApprovedPhoto.
//
// It takes the ScreenedPhoto rather than bare bytes so that the verdict is checked HERE,
// at the one place the brand can be minted, instead of by the discipline of every caller.
// A reviewer proved the earlier bare-bytes signature was bypassable: any file could call
// approvePhoto() over an arbitrary array of picked photos, approved or not, and it
// compiled and passed every test — the "call this from the approval-tap handler and
// nowhere else" comment was the only thing standing in the way, which is exactly the
// convention this type exists to replace.
//
// FAIL CLOSED: only `candidate` mints. `rejected` throws, and so does `undetermined` —
// an unknown verdict is not a synonym for a passed one (see PhotoVerdict). The screener
// being absent entirely (screeningAvailable === false) therefore cannot silently produce
// uploadable photos; that path must go through an explicit hand-pick decision.
//
// The digest is re-parsed through SourcePhotoHash: a digest port returning base64
// (`+`, `/`, `=`) or a path-shaped value must not become a branded hash, because this
// value is later interpolated into a Storage object key. parse-don't-cast — the single
// `as` below is the brand attachment itself, which is the one place a nominal type can
// be created at all, and it happens only AFTER validation.
export async function approvePhoto(input: ApprovePhotoInput): Promise<ApprovedPhoto> {
  // RUNTIME BACKSTOP for the tap itself. The brand is compile-time only, and Object.assign
  // onto a legitimate tap forges it with no cast, so identity is checked rather than shape.
  if (!isMintedTap(input.tapped)) throw new PhotoNotApprovable('undetermined');
  if (input.tapped.screened.verdict !== 'candidate') {
    throw new PhotoNotApprovable(input.tapped.screened.verdict);
  }
  // The bytes come FROM the tapped photo. They are deliberately NOT a separate parameter:
  // a red team showed that two independent inputs are a bearer ticket, not a per-photo one.
  // `approvePhoto({tapped: legitimatelyTapped, bytes: neverScreenedPhoto.bytes})` compiled
  // with zero casts and uploaded intimate bytes she never approved, and the chokepoint's
  // hash re-check could not catch it — the key is content-addressed over the FOREIGN bytes,
  // so it agreed with itself. Sourcing the bytes from the tap makes the mismatch
  // unrepresentable instead of merely detectable.
  const photo = input.tapped.screened.photo;
  const digest = await input.sha256Hex(photo.bytes);
  const source_photo_hash = parseBoundary(SourcePhotoHash, digest, 'approvePhoto.source_photo_hash');
  // Frozen so the bytes cannot be swapped after minting. A reviewer laundered foreign
  // bytes through a legitimately-minted brand two ways (an object spread, and aliasing
  // the fields through a mutable interface — `readonly` is not checked on assignability,
  // so neither needed a cast). Freezing kills the mutation route at runtime; the hash
  // re-check at the upload chokepoint kills the spread route.
  return Object.freeze({
    source_photo_hash,
    bytes: photo.bytes,
    contentType: photo.contentType,
  }) as ApprovedPhoto;
}

export interface SourcePhotoScope {
  readonly userId: string;
  readonly sourcePhotoHash: string;
}

// THE object key for an approved original — ONE composer, used by both sides.
//
// It lives in `shared` (not `functions`) for a specific reason: mobile MUST NOT import
// @closet/functions, so while this lived only server-side the client had to re-compose
// the identical security-relevant string by hand with no compile-time link. Two
// composers of one path is exactly the shape of the `{job_id}/{user_id}` inversion this
// repo already ate, and one character of drift here (`original.jpg`, a trailing slash)
// yields a 404 at sign time reported as a deliberately non-diagnostic 502.
//
// Segment 1 MUST be the owner: migration 0013's predicate is
// `(storage.foldername(name))[1] = auth.uid()::text`. On the SERVER the userId is the
// verified JWT `sub`; on the CLIENT it is the session's own user id and RLS refuses
// anything else. `original` carries no extension by design.
export function sourcePhotoObjectKey(scope: SourcePhotoScope): string {
  return `${scope.userId}/${scope.sourcePhotoHash}/original`;
}
