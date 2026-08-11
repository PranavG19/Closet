// Which of the add-garment screen's states is showing. Extracted as a pure function for the
// same reason gate.ts (the session gate) is: the one piece of logic deciding what the whole
// screen shows should be unit-testable with no renderer, and here it is unusually
// consequential — one of the branches is "bytes are leaving the device right now".
//
// The order is the repo's established one (isPending → isError → empty → populated, per
// WardrobeScreen.tsx:94-109) with two stages the list screens do not need:
//
//   `unavailable` — no photo picker is bound in this build. It DOMINATES because there is no
//   useful work to show while the seam does not exist; the screen says so honestly rather
//   than offering a button that throws (the same failure shape as the paywall's unconfigured
//   store, and the opposite of the pre-existing `onPress={() => {}}` dead buttons).
//
//   `intro` — the privacy moment. docs/01 F1 step 2 requires the privacy promise explained
//   plainly BEFORE photo access, and docs/01:138 says "privacy is a visible feature, not fine
//   print". A screen that goes straight from empty to a picker button has nowhere to put it,
//   so this is a real stage, not `review` with zero items.
//
// There is no `error` stage: a failed add is rendered as a message ABOVE the candidate grid,
// not as a full-screen takeover, because her picked photos and their approvals must survive
// the failure — throwing away a whole approval pass because one upload failed would make her
// re-approve every photo.
export const STAGES = ['unavailable', 'adding', 'choosing', 'intro', 'review'] as const;
export type Stage = (typeof STAGES)[number];

export interface StageInput {
  // PhotoIntakePort.available — false in a build with no picker dependency.
  readonly intakeAvailable: boolean;
  // The system picker is open (or its promise is in flight).
  readonly choosing: boolean;
  // An upload + parse is in flight. Bytes are on the wire.
  readonly adding: boolean;
  readonly candidateCount: number;
}

export function stage(input: StageInput): Stage {
  if (!input.intakeAvailable) return 'unavailable';
  // Outranks `choosing` AND `review`: while bytes are uploading the grid must not stay
  // tappable. A second tap is a second parse job — and for kind='full' a second charge.
  if (input.adding) return 'adding';
  if (input.choosing) return 'choosing';
  // Zero candidates lands here from two directions: first mount, and a batch where every
  // photo was set aside. Both need the same thing — the explanation plus a way to pick again.
  if (input.candidateCount === 0) return 'intro';
  return 'review';
}
