// The guard standing between a tap and an IRREVERSIBLE purge. Tests are written
// REJECT-FIRST: the interesting property is that everything except the exact word is
// refused, so the list of near-misses below is the oracle.
import { describe, it, expect } from 'vitest';
import {
  DELETE_CONFIRMATION_WORD,
  confirmationToken,
  isDeleteConfirmed,
} from './deleteConfirmation.js';

// Near-misses a real user (or a stray render) could plausibly produce. Every one of
// these MUST fail — a loose match here is an accidentally-deleted account.
const REJECTED: readonly string[] = [
  '',
  ' ',
  'delete',
  'Delete',
  'DELET',
  'DELETEE',
  'DELETE ACCOUNT',
  'DEL ETE',
  'D E L E T E',
  'YES',
  'CONFIRM',
  'undefined',
  'null',
  'DELETE;',
  '"DELETE"',
  'ＤＥＬＥＴＥ', // full-width lookalike
];

describe('confirmationToken — rejects everything but the exact word', () => {
  for (const typed of REJECTED) {
    it(`rejects ${JSON.stringify(typed)}`, () => {
      expect(confirmationToken(typed)).toBeNull();
      expect(isDeleteConfirmed(typed)).toBe(false);
    });
  }

  it('is case-SENSITIVE: lowercase does not authorize the purge', () => {
    expect(confirmationToken('delete')).toBeNull();
    expect(confirmationToken('Delete')).toBeNull();
    expect(confirmationToken('DELETE')).toBe('DELETE');
  });
});

describe('confirmationToken — accepts the exact word', () => {
  it('accepts DELETE and returns the literal the client method requires', () => {
    // Oracle: the string literal the server's z.literal('DELETE') demands, written
    // out here independently of the module's own constant.
    expect(confirmationToken('DELETE')).toBe('DELETE');
    expect(isDeleteConfirmed('DELETE')).toBe(true);
  });

  it('tolerates surrounding whitespace only (a keyboard autospace is a typo)', () => {
    expect(confirmationToken(' DELETE')).toBe('DELETE');
    expect(confirmationToken('DELETE ')).toBe('DELETE');
    expect(confirmationToken('  DELETE  ')).toBe('DELETE');
    // A trailing newline is the same class of thing (a submit key), so trim() accepts
    // it. Pinned explicitly because it looks like a near-miss but is not one — the
    // word she typed is still exactly DELETE.
    expect(confirmationToken('DELETE\n')).toBe('DELETE');
  });

  it('the exported word matches the wire literal the endpoint requires', () => {
    expect(DELETE_CONFIRMATION_WORD).toBe('DELETE');
  });
});
