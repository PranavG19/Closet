// Oracle for the server page-size clamp. Cheap to test and worth testing, because this
// function is now the SINGLE gate between a caller-supplied `limit` and a SQL LIMIT clause
// on every paginated read — it used to exist as three independent copies (both repos and
// the wardrobe handler), and the handler clamped a second time against its own constants.
//
// The assertions below are the ones that would actually have caught a bad rewrite: the
// default/maximum confusion (an unspecified page must not become the largest possible
// query), and totality (every input, including the ones Zod would have already rejected,
// lands on an integer inside the range rather than reaching Postgres as NaN or -1).
import { describe, expect, it } from 'vitest';
import { clampLimit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.js';

describe('clampLimit', () => {
  it('an unspecified limit is the DEFAULT, not the maximum', () => {
    // The distinction that matters: `undefined` means "she did not ask for a page size",
    // and answering that with MAX_PAGE_SIZE would make every unparameterised list the
    // heaviest query the API can serve.
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(MAX_PAGE_SIZE);
  });

  it('passes through anything inside the range untouched', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(37)).toBe(37);
    expect(clampLimit(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('caps at MAX_PAGE_SIZE — a caller cannot ask for the whole table', () => {
    expect(clampLimit(MAX_PAGE_SIZE + 1)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(100_000)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX_PAGE_SIZE);
  });

  it('is TOTAL: every input yields an integer in [1, MAX_PAGE_SIZE]', () => {
    // Zod rejects most of these at the boundary before they reach a repo, but the repos are
    // also called directly (parse worker, webhook, tests) where no Zod schema intervenes, so
    // the clamp must not be able to emit a fractional or negative LIMIT.
    const hostile = [
      0,
      -1,
      -100_000,
      0.5,
      50.9,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
    ];
    for (const input of hostile) {
      const clamped = clampLimit(input);
      expect(Number.isInteger(clamped), `clampLimit(${String(input)}) = ${clamped}`).toBe(true);
      expect(clamped).toBeGreaterThanOrEqual(1);
      expect(clamped).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    }
  });

  it('floors a fractional limit — a LIMIT clause cannot be fractional', () => {
    expect(clampLimit(50.9)).toBe(50);
    expect(clampLimit(MAX_PAGE_SIZE + 0.5)).toBe(MAX_PAGE_SIZE);
    // MEASURED, not assumed: I mutated the implementation to `Math.floor(Math.min(...))`
    // (swapping the order) and this suite stayed green. That is an EQUIVALENT mutant, not a
    // coverage gap — for any integer cap M, `floor(min(x, M)) === min(floor(x), M)`. What is
    // load-bearing is that a floor happens at all (dropping it is caught by these two
    // assertions); where it sits relative to the min is free.
  });
});
