// The account-deletion confirmation guard, as a PURE function so the one check
// standing between a tap and an IRREVERSIBLE purge is unit-testable with no
// renderer and no network.
//
// Lives under src/ (not features/auth) so it is importable by any surface without a
// cross-feature import, and so its test lands in the `unit` vitest project
// (packages/*/src/**/*.test.ts).
//
// She must TYPE the word. A two-tap confirm is too easy to fumble for something
// with no undo — this endpoint permanently purges every row she owns.

// The exact word the endpoint requires (mirrors DeleteAccountRequest's literal).
export const DELETE_CONFIRMATION_WORD = 'DELETE';

// The typed literal the client method accepts. Producing this value is the ONLY way
// to call deleteAccount(), so an unconfirmed delete is unrepresentable in the types
// — not merely guarded against at runtime.
export type DeleteConfirmationToken = typeof DELETE_CONFIRMATION_WORD;

// Returns the token iff the typed text is an exact match, else null.
//
// Trailing/leading whitespace is trimmed (a keyboard autospace after the last
// letter is a typo, not a different intent) but the comparison is otherwise EXACT
// and case-SENSITIVE: "delete" does not authorize the purge. Deliberately strict —
// a loose match here is the difference between a considered decision and an
// accident.
export function confirmationToken(typed: string): DeleteConfirmationToken | null {
  return typed.trim() === DELETE_CONFIRMATION_WORD ? DELETE_CONFIRMATION_WORD : null;
}

// Convenience predicate for enabling the destructive button.
export function isDeleteConfirmed(typed: string): boolean {
  return confirmationToken(typed) !== null;
}
