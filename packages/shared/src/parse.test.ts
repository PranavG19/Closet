// Tier-1 (docs/05): parse.ts is the parse-don't-cast boundary. Oracle = fast-check
// over generated inputs + a red-first rejection suite.
//
// RED-FIRST NOTE: the rejection cases below were first run against a stub
// `parseBoundary = (_s, x) => x as T` (a raw cast that never validates); every
// rejection expectation FAILED (no throw, ok:true) — proving the tests
// discriminate real validation from a cast. Then the real parse.ts turned them green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { parseBoundary, parseBoundarySafe, BoundaryParseError } from './parse.js';

const SampleSchema = z.object({ id: z.string().uuid(), n: z.number(), tag: z.enum(['a', 'b']) });

const validArb = fc.record({
  id: fc.uuid(),
  n: fc.double({ noNaN: true, noDefaultInfinity: true }),
  tag: fc.constantFrom('a' as const, 'b' as const),
});

describe('parseBoundary — valid round-trip', () => {
  it('parse(x) deep-equals x for every generated valid value', () => {
    fc.assert(
      fc.property(validArb, (x) => {
        const out = parseBoundary(SampleSchema, x);
        expect(out).toEqual(x);
      }),
      { numRuns: 1000 },
    );
  });

  it('is pure — parsing the same frozen input twice yields equal, non-aliased outputs', () => {
    const frozen = Object.freeze({ id: '550e8400-e29b-41d4-a716-446655440000', n: 3, tag: 'a' });
    const a = parseBoundary(SampleSchema, frozen);
    const b = parseBoundary(SampleSchema, frozen);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('parseBoundary — rejection (red-first)', () => {
  it('throws BoundaryParseError with populated issues on a bad uuid', () => {
    const bad = { id: 'not-a-uuid', n: 1, tag: 'a' };
    expect(() => parseBoundary(SampleSchema, bad, 'req')).toThrow(BoundaryParseError);
    try {
      parseBoundary(SampleSchema, bad, 'req');
    } catch (err) {
      expect(err).toBeInstanceOf(BoundaryParseError);
      const e = err as BoundaryParseError;
      expect(e.issues.length).toBeGreaterThan(0);
      expect(e.boundary).toBe('req');
    }
  });

  it('parseBoundarySafe returns { ok: false } with the error, never throws', () => {
    const res = parseBoundarySafe(SampleSchema, { id: 'x', n: 'y', tag: 'z' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(BoundaryParseError);
      expect(res.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('parseBoundarySafe returns { ok: true, value } on valid input', () => {
    fc.assert(
      fc.property(validArb, (x) => {
        const res = parseBoundarySafe(SampleSchema, x);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.value).toEqual(x);
      }),
    );
  });
});
