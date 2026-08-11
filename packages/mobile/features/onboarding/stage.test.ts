// Screen-state tests. `stage()` is the whole of AddGarmentScreen's branching, extracted so
// it is graded here rather than assumed: there is NO render-test infrastructure in this repo
// (no @testing-library/react-native, no jsdom, and `.test.tsx` matches no vitest glob — such
// a file is silently skipped and looks green), so a screen test would prove nothing. The
// screen is left as JSX with one early return per stage, the shape every other screen uses.
//
// The oracle for the ORDER is the existing screens: WardrobeScreen.tsx:94-109 and
// LaundryScreen.tsx:57-64 both early-return isPending → isError → empty → populated. The
// oracle for the two stages those screens do not have — `unavailable` and `review` — is
// docs/01 F1 (a privacy explanation must precede photo access) and docs/01:44 (approval
// happens over candidates, before any upload).
//
// THIS IS NOT VISUAL PROOF. That a stage renders correctly, that the copy fits, that the
// grid lays out — those need a real simulator screenshot and are human-gated (CLAUDE.md
// rule 3, docs/05 §out-of-scope). Nothing in this file observes a pixel.
import { describe, it, expect } from 'vitest';
import { STAGES, stage } from './stage.js';

// Every field false/0 — the state on first mount with a working port.
const BASE = {
  intakeAvailable: true,
  choosing: false,
  adding: false,
  candidateCount: 0,
} as const;

describe('stage — the branch order (the existing screens are the oracle)', () => {
  it('reports `unavailable` when no picker is bound, whatever else is true', () => {
    // A build with no picker dependency must render an honest unavailable state, not a button
    // that throws — the same shape the paywall uses for an unconfigured store. This DOMINATES:
    // there is no useful work to show while the seam does not exist.
    expect(stage({ ...BASE, intakeAvailable: false })).toBe('unavailable');
    expect(stage({ ...BASE, intakeAvailable: false, choosing: true })).toBe('unavailable');
    expect(stage({ ...BASE, intakeAvailable: false, candidateCount: 3 })).toBe('unavailable');
    expect(stage({ ...BASE, intakeAvailable: false, adding: true })).toBe('unavailable');
  });

  it('reports `adding` while an upload+parse is in flight, even with candidates on screen', () => {
    // Bytes are leaving the device. That must never be hidden behind a grid she can still tap:
    // a second tap during an upload is a second parse job and, for kind='full', a second
    // charge. `adding` therefore outranks `review`.
    expect(stage({ ...BASE, adding: true, candidateCount: 4 })).toBe('adding');
  });

  it('reports `choosing` while the system picker is open', () => {
    expect(stage({ ...BASE, choosing: true })).toBe('choosing');
  });

  it('`adding` outranks `choosing` — an in-flight upload is the more important truth', () => {
    expect(stage({ ...BASE, choosing: true, adding: true })).toBe('adding');
  });

  it('reports `intro` when nothing has been picked yet — the privacy moment', () => {
    // docs/01 F1 step 2: the privacy promise is explained BEFORE photo access, at the point it
    // happens. An empty screen that goes straight to a picker button has no room for it, so
    // `intro` is a real stage rather than a variant of `review` with zero items.
    expect(stage(BASE)).toBe('intro');
  });

  it('reports `review` once there are candidates to approve', () => {
    expect(stage({ ...BASE, candidateCount: 1 })).toBe('review');
  });

  it('falls BACK to `intro` when every candidate is gone', () => {
    // Reached when a whole batch is set aside: she picked photos, none may be offered, and the
    // screen must say so and let her pick again rather than show an empty grid.
    expect(stage({ ...BASE, candidateCount: 0 })).toBe('intro');
  });
});

describe('stage — totality', () => {
  it('returns a declared stage for all 16 combinations of its inputs', () => {
    // The function is total by construction (a chain of early returns), and this is what
    // proves no input falls through to undefined.
    const bools = [false, true];
    const counts = [0, 3];
    for (const intakeAvailable of bools) {
      for (const choosing of bools) {
        for (const adding of bools) {
          for (const candidateCount of counts) {
            const result = stage({ intakeAvailable, choosing, adding, candidateCount });
            expect(STAGES).toContain(result);
          }
        }
      }
    }
  });

  it('is deterministic — the same inputs give the same stage', () => {
    const input = { ...BASE, candidateCount: 2 };
    expect(stage(input)).toBe(stage(input));
  });
});
