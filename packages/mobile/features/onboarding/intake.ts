// The Intake — the decision model behind add-garment, and the place this app's defining
// privacy constraint is actually decided.
//
// WHY A PURE MODULE (the basket.ts / draft.ts pattern): this repo has no render-test
// infrastructure — no @testing-library/react-native, no jsdom, and a `.test.tsx` matches no
// vitest glob, so a screen test would be silently skipped and look green. So every decision
// that could be wrong lives here, where a plain `.test.ts` really runs, and AddGarmentScreen
// is render + handlers only.
//
// THE INVARIANT THIS MODEL HOLDS, stated as the doc clause it comes from:
//
//   docs/01:44 — an intimate photo is "neither displayed as candidates nor uploaded". Those
//   are TWO obligations and this module holds both: a rejected photo is dropped from the
//   model entirely (so `candidates` cannot render it) and the approval set is intersected
//   with the candidates (so `approvedPhotos` cannot return it). Only an anonymous count of
//   what was set aside survives, because a "hidden but present" list is one `.concat()` away
//   from being rendered.
//
//   docs/06 §2 — "the structural guarantee is 'no upload without an explicit approval tap';
//   the classifier is a graded detection control." Nothing starts approved, and only
//   `approvedPhotos` feeds the upload seam — which additionally requires an ApprovedPhoto
//   brand that only the approval-tap handler can mint.
//
// WHAT IT DOES NOT DO, and must never be described as doing: classify. Whether a screener
// actually catches intimate / not-her photos is RECALL, a device-ML property graded against
// an independent human-curated labeled corpus and a hard launch blocker the human owns
// (docs/06 §8.3, LAUNCH-READINESS §6). This module consumes a verdict; it has no opinion on
// how good the verdict is. The `undetermined` case exists so an ABSENT screener — which is
// the state of the tree today — is a value the code branches on rather than an assumption.
import { tapApproved, type ScreenedPhoto, type TappedPhoto } from '@closet/shared';
import type { AddGarmentOutcome } from '../../src/photo/index.js';

export interface Intake {
  // The photos she may SEE, in the order they were admitted. A rejected photo is not in
  // here, and there is no other list it could be in.
  //
  // These stay SCREENED (verdict attached) rather than being flattened to PickedPhoto,
  // because approvePhoto() now requires the verdict: the minter checks it rather than
  // trusting the caller to have filtered. Dropping the verdict here would force the
  // screen to re-assert "this one passed", which is the discipline-by-convention the
  // brand exists to remove.
  readonly candidates: readonly ScreenedPhoto[];
  // Ids she has tapped approve on. A Set for the O(1) per-tile read on every render.
  readonly approved: ReadonlySet<string>;
  // How many photos were set aside, and NOTHING about which ones. The count is shown to her
  // so the gate is a visible feature rather than silent shrinkage of her camera roll
  // (docs/01:138 — "privacy is a visible feature, not fine print"), while carrying no
  // reference to a photo that must not be rendered.
  readonly setAside: number;
  // The ids of photos the screener set aside, so the count survives later passes. IDS ONLY —
  // opaque picker handles, no uri and no bytes, so no rejected photo is retained in any
  // renderable or uploadable form. `setAside` is exactly this set's size.
  readonly rejectedIds: ReadonlySet<string>;
}

export const EMPTY_INTAKE: Intake = {
  candidates: [],
  approved: new Set(),
  setAside: 0,
  rejectedIds: new Set(),
};

// Whether a screened photo may be OFFERED to her.
//
// The `undetermined` branch is the whole reason this is a function rather than
// `verdict === 'candidate'`, and it is the one real judgement call in this module:
//
//   - hand_picked: ADMIT. She opened the system picker and tapped this exact photo, so the
//     system UI was the selection. Dropping it would break the degraded path docs/01:46
//     requires ("declines full photo access → manual import → must still reach a reveal"),
//     and privacy-policy.md §2 explicitly offers hand-picking as an alternative to the scan.
//     With no classifier bound every verdict is `undetermined`, so this branch is the ONLY
//     working path in the tree today.
//   - library_scan: REFUSE. Bulk-enumerating the camera roll with no working screener puts
//     whatever is in it on screen, which is exactly the intimate photo docs/01:44 forbids
//     displaying. Absent an affirmative verdict there is no legal bulk path, so it fails
//     closed.
function mayOffer(entry: ScreenedPhoto): boolean {
  if (entry.verdict === 'rejected') return false;
  if (entry.verdict === 'candidate') return true;
  return entry.photo.source === 'hand_picked';
}

// Fold a batch of screened photos into the intake.
//
// TOTAL over the batch: every photo is either admitted as a candidate or counted as set
// aside — except one already admitted, which is ignored because it was already accounted
// for on its first pass (a re-pick of the same photo must not double a candidate or inflate
// the set-aside count).
export function admit(intake: Intake, batch: readonly ScreenedPhoto[]): Intake {
  // REJECTION WINS, WHATEVER THE ORDER. The previous version skipped an already-known id
  // before looking at its verdict, so a photo admitted as a `candidate` on one pass and
  // REJECTED on a later pass stayed a candidate — displayed, tappable, and uploadable, with
  // both halves of docs/01:44 broken and `setAside` not even incremented, so the UI showed
  // nothing. A red team found it, and it is not contrived: the shipped "Choose different
  // photos" button re-runs pick -> screen -> admit over an overlapping id, so re-picking the
  // same photo is the NORMAL action that triggers it. It is latent only because no classifier
  // is bound yet (every verdict is `undetermined` today); it opens the moment one lands.
  // Seeded from prior passes so a rejection is remembered after its photo is gone.
  const rejectedIds = new Set<string>(intake.rejectedIds);
  const offered = new Map<string, ScreenedPhoto>();

  // Prior candidates first, then this batch, so a later verdict supersedes an earlier one.
  for (const entry of [...intake.candidates, ...batch]) {
    const id = entry.photo.id;
    if (rejectedIds.has(id)) continue;
    if (!mayOffer(entry)) {
      rejectedIds.add(id);
      // EVICT. A photo already on screen must disappear when a later pass rejects it.
      offered.delete(id);
      continue;
    }
    // Keep the FIRST accepted sighting, so her grid order does not shuffle under her.
    if (!offered.has(id)) offered.set(id, entry);
  }

  // setAside counts DISTINCT rejected photos CUMULATIVELY, and getting this right needed two
  // corrections in opposite directions:
  //   · It must not count reject EVENTS. The original incremented per sighting, so one photo
  //     re-picked six times told her six photos were set aside. The number exists to make the
  //     gate visible (docs/01:138); inflating it claims her library holds more intimate photos
  //     than it does.
  //   · It must not forget earlier passes. My first rewrite derived the count from THIS call's
  //     rejections only, so a photo rejected on pass 1 stopped being counted on pass 2 — an
  //     UNDER-count, which is the more dishonest direction: it hides how much was filtered.
  // So the ids are carried in `rejectedIds`, deduped by construction, and the count is their
  // size. THE IDS ARE NOT A PHOTO: an id is an opaque picker handle with no uri and no bytes,
  // so nothing here can be rendered or uploaded — which is what docs/01:44's "neither
  // displayed nor uploaded" actually requires. A retained ScreenedPhoto would be one
  // `.concat()` from the grid; a retained id is not.
  const candidates = [...offered.values()];
  const setAside = rejectedIds.size;

  // Her approvals are intersected with what is still offered, so an evicted photo cannot
  // survive in the approval set and be resurrected by approvedPhotos().
  const stillOffered = new Set(candidates.map((candidate) => candidate.photo.id));
  const approved = new Set([...intake.approved].filter((id) => stillOffered.has(id)));

  return { candidates, approved, setAside, rejectedIds };
}

export function isApproved(intake: Intake, id: string): boolean {
  return intake.approved.has(id);
}

// THE APPROVAL TAP. Returns a NEW intake (never mutates) so React sees a changed reference —
// mutating the Set in place is the classic "selection doesn't update" bug, and here it would
// mean her tap appears not to register on the one control that decides what leaves the phone.
//
// An id that is not a candidate is a NO-OP that preserves identity. That is not defensive
// noise: the id of a rejected photo is knowable (it came back from the picker), so
// "approve something that was set aside" is the reachable attack on this model, and the
// answer is that there is nothing to approve.
export function toggleApproval(intake: Intake, id: string): Intake {
  const isCandidate = intake.candidates.some((candidate) => candidate.photo.id === id);
  if (!isCandidate) return intake;

  const approved = new Set(intake.approved);
  if (!approved.delete(id)) approved.add(id);
  return {
    candidates: intake.candidates,
    approved,
    setAside: intake.setAside,
    rejectedIds: intake.rejectedIds,
  };
}

export function candidateCount(intake: Intake): number {
  return intake.candidates.length;
}

export function setAsideCount(intake: Intake): number {
  return intake.setAside;
}

export function approvedCount(intake: Intake): number {
  return approvedPhotos(intake).length;
}

// The photos that will actually be uploaded — derived by FILTERING THE CANDIDATES, never by
// mapping over the approved ids. The direction matters: iterating the id set and looking each
// one up would make the set the source of truth, and an id that is no longer a candidate
// would need a separate guard. Filtering the candidate list makes "approved but not a
// candidate" unrepresentable in the output, and preserves candidate order so the grid she
// looked at and the upload queue agree.
// Returns TAPPED photos, and this function is the ONLY place the tap brand is minted. That is
// what closes the last bypass a reviewer walked through: after the verdict became unforgeable,
// a second screen could still import useAddGarment from the barrel and upload a screened photo
// she had never tapped, because nothing in the type system carried her consent. Now the minter
// requires a TappedPhoto, and the only way to get one is through this filter over HER approval
// set — so a screen that never rendered the approval grid cannot reach the upload seam at all.
export function approvedPhotos(intake: Intake): readonly TappedPhoto[] {
  return intake.candidates
    .filter((candidate) => intake.approved.has(candidate.photo.id))
    .map(tapApproved);
}

// THE ONLY CLAIM THE SHIPPED CODE CAN BACK TODAY, and it is deliberately narrower than the
// canonical string below.
//
// content/store/app-store-listing.md:233 marks "photos are screened on your device first" as
// BLOCKED — "there is no classifier. Shipping this describes a safeguard that does not
// exist." :240 adds the trap to avoid: "do not simply soften the adjectives — 'screening' is
// the claim, and hedged screening is still a screening claim." So this string does not hedge
// about screening; it says nothing about screening at all. What it does say is structurally
// true: `uploadApprovedPhoto` accepts only a branded ApprovedPhoto, whose sole constructor is
// the approval-tap handler, so an un-approved upload does not compile.
export const APPROVAL_ONLY_PROMISE =
  'Nothing is uploaded until you approve it. Photos you don’t approve never leave your phone.';

// docs/03:88's canonical privacy string, verbatim. It is NOT invented copy and it is NOT
// reachable today: it is gated on `screeningAvailable`, which PhotoIntakePort reports and
// nothing in the tree sets true, so the on-device claim unlocks when the classifier lands and
// clears its recall floor — not when an author feels good about it.
const CANONICAL_ON_DEVICE_PROMISE =
  'We check your photos on your device first. Only clothing photos you approve are ever uploaded.';

export function privacyPromise(screeningAvailable: boolean): string {
  return screeningAvailable ? CANONICAL_ON_DEVICE_PROMISE : APPROVAL_ONLY_PROMISE;
}

// Outcome code -> the copy she reads. A pure function over a closed set, with NO default
// branch, so adding an outcome is a compile error rather than a silent fall-through. Same
// discipline as authErrorMessage: a raw server message never reaches a screen, because it can
// carry a storage path or an id and it is not this product's voice.
export function outcomeMessage(outcome: AddGarmentOutcome): string {
  switch (outcome) {
    case 'upload_failed':
      return "We couldn't send that photo. Check your connection and try again.";
    case 'needs_membership':
      return 'Your whole closet unlocks with membership.';
    case 'teaser_exhausted':
      return "You've used your free previews. Join to add the rest of your closet.";
    case 'already_parsing':
      // Transient, and genuinely fine: this exact photo is being worked on right now. There
      // is no parse-job read route, so the honest instruction is to wait rather than an error.
      return "We're already working on that photo. Give it a moment.";
    case 'slow_down':
      return "That's a lot of photos at once. Try again in a little while.";
    case 'try_again':
      return "That didn't go through. Please try again.";
  }
}
