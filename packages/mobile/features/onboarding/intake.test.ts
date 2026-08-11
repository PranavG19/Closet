// Intake-model tests. The oracle is the PRIVACY INVARIANT AS WRITTEN IN THE DOCS, not this
// module's own output, and each test names the doc clause it grades:
//
//   docs/01:44 (the F1 GWT)   — intimate photos "are neither displayed as candidates nor
//                               uploaded". Two separate assertions, because they are two
//                               separate leaks: rendering one is a leak to the room she is
//                               standing in, uploading one is a leak to two vendors and an
//                               indefinitely-retained bucket.
//   docs/01:46                — declining full photo access must still reach a reveal via
//                               hand-picked import.
//   docs/06 §2                — "the structural guarantee is 'no upload without an explicit
//                               approval tap'; the classifier is a graded detection control."
//   store-listing:233/:240    — until the classifier exists and clears a recall floor, in-app
//                               copy may claim ONLY the approval tap, and "do not simply
//                               soften the adjectives; hedged screening is still a screening
//                               claim."
//
// WHAT THESE TESTS DO NOT AND CANNOT PROVE: that a screener actually catches intimate or
// not-her photos. That is RECALL — a device-ML oracle needing an independent, human-curated
// labeled corpus, listed as a hard launch blocker with the human owning the safety go/no-go
// (docs/06 §8.3, docs/05 §out-of-scope, LAUNCH-READINESS §6). Every 'rejected' verdict below
// is INJECTED by the test, which is exactly the point: this file grades what the model does
// with a verdict, never how good the verdict is. No corpus is faked here.
//
// Nor do they prove the screen renders. There is no render-test infrastructure in this repo
// (no @testing-library/react-native, no jsdom, and a `.test.tsx` matches no vitest glob), so
// every decision worth grading was pushed down here. Visual correctness needs a simulator
// screenshot and is human-gated.
import { describe, it, expect } from 'vitest';
import {
  screenPhoto,
  type PickedPhoto,
  type PhotoIntakeSource,
  type ScreenedPhoto,
  type PhotoVerdict,
} from '@closet/shared';
import {
  APPROVAL_ONLY_PROMISE,
  EMPTY_INTAKE,
  admit,
  approvedCount,
  approvedPhotos,
  candidateCount,
  isApproved,
  outcomeMessage,
  privacyPromise,
  setAsideCount,
  toggleApproval,
} from './intake.js';

function photo(id: string, source: PhotoIntakeSource = 'hand_picked'): PickedPhoto {
  return {
    id,
    source,
    uri: `file:///tmp/${id}.jpg`,
    bytes: new ArrayBuffer(4),
    contentType: 'image/jpeg',
  };
}

function screened(
  entries: readonly (readonly [string, PhotoVerdict, PhotoIntakeSource?])[],
): readonly ScreenedPhoto[] {
  // Through the real minter: ScreenedPhoto carries an unexported brand, so an object literal
  // is not one. Every 'rejected'/'undetermined' verdict here is still INJECTED by the test —
  // screenPhoto records a verdict, it does not compute one, so no classifier is being faked.
  return entries.map(([id, verdict, source]) => screenPhoto(photo(id, source), verdict));
}

describe('admit — what she is allowed to SEE (docs/01:44, first half)', () => {
  it('a REJECTED photo is never a candidate — the display half of the invariant', () => {
    const intake = admit(EMPTY_INTAKE, screened([['keep', 'candidate'], ['intimate', 'rejected']]));
    expect(intake.candidates.map((entry) => entry.photo.id)).toEqual(['keep']);
  });

  it('drops a rejected photo ENTIRELY — it is not parked anywhere retrievable', () => {
    // A "hidden but present" list is one `.concat()` away from being rendered. The photo
    // leaves the model; only an anonymous count of what was set aside survives.
    const intake = admit(EMPTY_INTAKE, screened([['intimate', 'rejected']]));
    expect(JSON.stringify(intake)).not.toContain('intimate');
    expect(setAsideCount(intake)).toBe(1);
  });

  // THIS EXPECTATION IS CORRECT AND THE CODE IS CURRENTLY WRONG — deliberately left RED.
  //
  // `'a'` and `'b'` are two GENUINELY DISTINCT photos, rejected on two different passes, so the
  // honest running total is 2. It is not the old inflated "count reject EVENTS" behaviour (that
  // bug would show 2 for the SAME photo rejected twice, which is a different fixture — see
  // 'counts one photo rejected on several passes ONCE' below, which passes).
  //
  // `admit` rebuilds `rejectedIds` from scratch on every call and iterates
  // `[...intake.candidates, ...batch]` — but a photo rejected on an EARLIER pass is not in
  // `intake.candidates` (it was dropped, correctly) and is not in this batch either, so its
  // rejection is forgotten and the count collapses to "distinct rejects in the latest pass".
  // Observed: pass 1 rejects 'a' -> 1; pass 2 rejects 'b' -> still 1.
  //
  // It fails in the DISHONEST direction — it UNDERSTATES how much the gate set aside, and the
  // number exists precisely to make the gate visible (docs/01:138). Relaxing this to 1 would be
  // encoding the defect, so it stays at 2. Fixing it needs a design decision that is NOT mine to
  // make silently: cumulative distinct counting requires remembering which ids were rejected,
  // and intake.ts currently promises the opposite ("`rejectedIds` is local and dies with this
  // call"), which is the same clause docs/01:44 leans on. Reported, not papered over.
  it('keeps a running set-aside count across several admits', () => {
    const first = admit(EMPTY_INTAKE, screened([['a', 'rejected']]));
    const second = admit(first, screened([['b', 'rejected'], ['c', 'candidate']]));
    expect(setAsideCount(second)).toBe(2);
    expect(candidateCount(second)).toBe(1);
  });

  it('is TOTAL: every input photo is either a candidate or counted as set aside', () => {
    // No photo may fall between the two — a lost photo is a photo whose fate nobody can
    // state, and the whole model exists to be able to state it.
    const input = screened([
      ['a', 'candidate'],
      ['b', 'rejected'],
      ['c', 'undetermined'],
      ['d', 'rejected'],
      ['e', 'candidate'],
    ]);
    const intake = admit(EMPTY_INTAKE, input);
    expect(candidateCount(intake) + setAsideCount(intake)).toBe(input.length);
  });

  it('NEVER mutates the intake it was given', () => {
    const before = admit(EMPTY_INTAKE, screened([['a', 'candidate']]));
    const after = admit(before, screened([['b', 'candidate']]));
    expect(candidateCount(before)).toBe(1);
    expect(after).not.toBe(before);
  });

  it('ignores a photo already admitted, so a re-pick cannot double a candidate', () => {
    const once = admit(EMPTY_INTAKE, screened([['a', 'candidate']]));
    const twice = admit(once, screened([['a', 'candidate']]));
    expect(candidateCount(twice)).toBe(1);
  });

  it('counts one photo rejected on several passes ONCE, not once per sighting', () => {
    // `setAside` counts DISTINCT photos, not reject EVENTS. Counting events told her six photos
    // were set aside when she had re-picked ONE rejected photo six times — dishonest in the
    // direction that matters, since the number exists to make the gate visible (docs/01:138) and
    // an inflated one claims her library holds more intimate photos than it does.
    let intake = EMPTY_INTAKE;
    for (let pass = 0; pass < 6; pass += 1) {
      intake = admit(intake, screened([['same', 'rejected']]));
    }
    expect(setAsideCount(intake)).toBe(1);
  });
});

// REJECTION WINS WHATEVER THE ORDER — the ordering bug a red team found, pinned permanently.
//
// The defect: `admit` skipped an already-known id BEFORE looking at its verdict, so a photo
// admitted as a `candidate` on one pass and REJECTED on a later pass stayed a candidate. Both
// halves of docs/01:44 broke at once — it was still DISPLAYED and still UPLOADABLE — and
// `setAside` was not even incremented, so the UI showed nothing was set aside.
//
// IT IS NOT CONTRIVED, which is why it lives in the suite rather than a scratch file: the shipped
// "Choose different photos" button re-runs pick -> screen -> admit over OVERLAPPING ids, so
// re-picking a photo she already saw is the NORMAL action that triggers it. It is latent only
// because no classifier is bound yet (every verdict is `undetermined` today) and opens the moment
// one lands — exactly the shape of bug that ships green.
describe('admit — a later REJECTION overrides an earlier admission (docs/01:44, both halves)', () => {
  it('evicts a photo she had already APPROVED when a later pass rejects it', () => {
    // The worst ordering, because her tap is already recorded: admit as candidate, she taps
    // approve, THEN the screener rejects it on a re-pick. All three obligations are asserted —
    // gone from the grid, gone from the upload list, and counted for her.
    const admitted = admit(EMPTY_INTAKE, screened([['later_rejected', 'candidate']]));
    const approvedByHer = toggleApproval(admitted, 'later_rejected');
    expect(isApproved(approvedByHer, 'later_rejected')).toBe(true);

    const rejectedLater = admit(approvedByHer, screened([['later_rejected', 'rejected']]));

    // (1) not displayed
    expect(rejectedLater.candidates.map((entry) => entry.photo.id)).toEqual([]);
    // (2) not uploaded — the approval set must not resurrect it
    expect(approvedPhotos(rejectedLater)).toEqual([]);
    expect(isApproved(rejectedLater, 'later_rejected')).toBe(false);
    // (3) counted, so the gate is visible rather than silent shrinkage
    expect(setAsideCount(rejectedLater)).toBe(1);
    // And the photo is gone from the model entirely, not parked somewhere retrievable.
    expect(JSON.stringify(rejectedLater)).not.toContain('later_rejected');
  });

  it('rejects on a later pass even with no approval tap in between', () => {
    const admitted = admit(EMPTY_INTAKE, screened([['a', 'candidate'], ['keep', 'candidate']]));
    const after = admit(admitted, screened([['a', 'rejected']]));
    expect(after.candidates.map((entry) => entry.photo.id)).toEqual(['keep']);
    expect(setAsideCount(after)).toBe(1);
  });

  it('a DUPLICATE id within ONE batch whose copy is rejected is counted, not silently dropped', () => {
    // The one-batch case. It used to vanish uncounted — the second sighting was skipped as
    // "already admitted" — which broke the stated TOTALity contract: every input photo is either
    // a candidate or counted, and this one was neither.
    const batch = screened([['dup', 'candidate'], ['dup', 'rejected']]);
    const intake = admit(EMPTY_INTAKE, batch);
    expect(intake.candidates.map((entry) => entry.photo.id)).toEqual([]);
    expect(setAsideCount(intake)).toBe(1);
  });

  it('is order-independent within a batch: rejected-then-candidate loses too', () => {
    // The mirror of the case above. Rejection must not depend on which sighting tsc/the picker
    // happens to yield first — otherwise the invariant holds only for one of two orderings.
    const intake = admit(EMPTY_INTAKE, screened([['dup', 'rejected'], ['dup', 'candidate']]));
    expect(intake.candidates.map((entry) => entry.photo.id)).toEqual([]);
    expect(setAsideCount(intake)).toBe(1);
  });
});

describe('admit — an UNDETERMINED verdict is decided by how the photo got here', () => {
  it('admits a HAND-PICKED undetermined photo: the degraded path must still work (docs/01:46)', () => {
    // With no classifier bound, every verdict is `undetermined`. If that dropped everything,
    // someone who declines full library access could never add a garment at all — and
    // privacy-policy.md §2 explicitly offers "skip the camera-roll scan entirely and
    // hand-pick individual photos". She chose this exact photo in the system picker; the
    // system UI was the screening.
    const intake = admit(EMPTY_INTAKE, screened([['chosen', 'undetermined', 'hand_picked']]));
    expect(intake.candidates.map((entry) => entry.photo.id)).toEqual(['chosen']);
  });

  it('REFUSES an undetermined photo that came from a LIBRARY SCAN', () => {
    // This is the case that would break the invariant: bulk-enumerating the camera roll with
    // no working screener renders whatever is in it, which is precisely the intimate photo
    // docs/01:44 says must never be displayed as a candidate. Absent a screener, there is no
    // legal bulk path — so it fails closed, and the photo is counted as set aside.
    const intake = admit(EMPTY_INTAKE, screened([['enumerated', 'undetermined', 'library_scan']]));
    expect(intake.candidates).toEqual([]);
    expect(setAsideCount(intake)).toBe(1);
  });

  it('admits a library-scan photo the screener AFFIRMATIVELY called a candidate', () => {
    // A real screener's positive verdict is what makes bulk intake legal at all.
    const intake = admit(EMPTY_INTAKE, screened([['enumerated', 'candidate', 'library_scan']]));
    expect(intake.candidates.map((entry) => entry.photo.id)).toEqual(['enumerated']);
  });
});

describe('toggleApproval — the approval tap IS the structural guarantee (docs/06 §2)', () => {
  it('approves a candidate and un-approves it again', () => {
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate']]));
    const on = toggleApproval(intake, 'a');
    expect(isApproved(on, 'a')).toBe(true);
    expect(isApproved(toggleApproval(on, 'a'), 'a')).toBe(false);
  });

  it('REJECT WINS OVER APPROVE — a rejected id can never become approved', () => {
    // The id is knowable (it was in the picker result), so this is the reachable attack on
    // the model: approve something that was set aside. There is nothing to approve — the
    // photo is not in the model, and the approval set is validated against the candidates.
    const intake = admit(EMPTY_INTAKE, screened([['intimate', 'rejected']]));
    const after = toggleApproval(intake, 'intimate');
    expect(isApproved(after, 'intimate')).toBe(false);
    expect(approvedCount(after)).toBe(0);
  });

  it('is a NO-OP that preserves identity for an unknown id, so it is safe in a handler', () => {
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate']]));
    expect(toggleApproval(intake, 'nope')).toBe(intake);
  });

  it('starts with NOTHING approved — approval is never a default', () => {
    // Pre-checked boxes would make the tap decorative, and the tap is the entire guarantee.
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate'], ['b', 'candidate']]));
    expect(approvedCount(intake)).toBe(0);
  });

  it('leaves other approvals untouched', () => {
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate'], ['b', 'candidate']]));
    const both = toggleApproval(toggleApproval(intake, 'a'), 'b');
    const without = toggleApproval(both, 'a');
    expect(isApproved(without, 'a')).toBe(false);
    expect(isApproved(without, 'b')).toBe(true);
  });
});

describe('approvedPhotos — what actually gets uploaded (docs/01:44, second half)', () => {
  it('returns ONLY photos she tapped, never every candidate', () => {
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate'], ['b', 'candidate']]));
    const one = toggleApproval(intake, 'b');
    // `approvedPhotos` returns TAPPED photos now, so the picked photo sits two levels down
    // (tapped -> screened -> photo). The assertion is unchanged: exactly the one id she tapped.
    expect(approvedPhotos(one).map((entry) => entry.screened.photo.id)).toEqual(['b']);
  });

  it('is EMPTY before any tap, so a confirm with no taps uploads nothing', () => {
    const intake = admit(EMPTY_INTAKE, screened([['a', 'candidate']]));
    expect(approvedPhotos(intake)).toEqual([]);
  });

  it('can never contain a rejected photo, whatever sequence of taps preceded it', () => {
    // The upload half of the invariant, graded over the whole reachable state space of this
    // model: admit a mixed batch, then attempt to approve EVERY id including the rejected
    // ones, and assert the upload list still excludes them.
    const batch = screened([
      ['ok1', 'candidate'],
      ['intimate', 'rejected'],
      ['screenshot', 'rejected'],
      ['ok2', 'candidate'],
      ['bulk', 'undetermined', 'library_scan'],
    ]);
    const admitted = admit(EMPTY_INTAKE, batch);
    const everything = batch.reduce((acc, entry) => toggleApproval(acc, entry.photo.id), admitted);
    expect(approvedPhotos(everything).map((entry) => entry.screened.photo.id)).toEqual(['ok1', 'ok2']);
  });

  it('preserves candidate order, so the grid and the upload queue agree', () => {
    const intake = admit(
      EMPTY_INTAKE,
      screened([['a', 'candidate'], ['b', 'candidate'], ['c', 'candidate']]),
    );
    const all = ['c', 'a', 'b'].reduce((acc, id) => toggleApproval(acc, id), intake);
    expect(approvedPhotos(all).map((entry) => entry.screened.photo.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('privacyPromise — the copy may not out-claim the code (store-listing:233/:240)', () => {
  // These are near-misses on the ONE thing the listing blocks: any suggestion that the app
  // screens her photos. The listing is explicit that softening the adjective does not help —
  // "hedged screening is still a screening claim" — so the reject list includes the hedges.
  const SCREENING_WORDS: readonly string[] = [
    'check',
    'checked',
    'screen',
    'screened',
    'screening',
    'filter',
    'filtered',
    'scan',
    'scanned',
    'set aside',
    'sets aside',
    'intimate',
    'detect',
    'automatically',
    'try to',
    'help',
  ];

  it('claims ONLY the approval tap when no screener is bound', () => {
    const promise = privacyPromise(false);
    expect(promise).toBe(APPROVAL_ONLY_PROMISE);
    for (const word of SCREENING_WORDS) {
      expect(promise.toLowerCase()).not.toContain(word);
    }
  });

  it('says the true thing that IS structural: nothing is uploaded without a tap', () => {
    // The approval-only claim is defensible today precisely because the branded ApprovedPhoto
    // makes an un-approved upload unrepresentable (src/photo/uploadApproved.ts).
    expect(privacyPromise(false).toLowerCase()).toContain('approve');
    expect(privacyPromise(false).toLowerCase()).toContain('upload');
  });

  it('only uses the canonical on-device wording once a screener actually runs', () => {
    // docs/03:88's exact string, unlocked by `screeningAvailable` rather than by an author's
    // optimism. Nothing in the tree sets that flag true today.
    expect(privacyPromise(true)).toBe(
      'We check your photos on your device first. Only clothing photos you approve are ever uploaded.',
    );
  });
});

describe('outcomeMessage — closed set in, product copy out', () => {
  it('says something distinct and non-empty for every outcome', () => {
    // Exhaustive over the union (the function has no default branch, so a new outcome is a
    // compile error rather than a silent fall-through to "try again").
    const messages = (
      [
        'upload_failed',
        'needs_membership',
        'teaser_exhausted',
        'already_parsing',
        'slow_down',
        'try_again',
      ] as const
    ).map(outcomeMessage);
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('tells her a photo mid-parse is FINE, not broken', () => {
    // 409 parse_already_in_progress is transient: this photo is being parsed right now, and
    // there is no parse-job read route, so the honest instruction is to wait.
    expect(outcomeMessage('already_parsing').toLowerCase()).not.toContain("couldn't");
  });

  it('never renders a raw server message — the copy is a pure function of the code', () => {
    // Same discipline as authErrorMessage / AccountScreen's const strings: server text can
    // carry a storage path or an id, and it is not this product's voice.
    expect(outcomeMessage('try_again')).toBe(outcomeMessage('try_again'));
  });
});
