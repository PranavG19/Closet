// parse-don't-cast: the ONLY sanctioned way to turn untyped input into a typed
// domain value. A value is either parsed-and-validated here or it does not become
// a typed object at all — no `as`-cast ever launders unknown input across a boundary.
import { z } from 'zod';

// A structured, loggable parse failure. Carries the Zod issues and an optional
// boundary label so a caller gets a typed error instead of a raw ZodError.
export class BoundaryParseError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];
  readonly boundary: string | undefined;

  constructor(issues: readonly z.core.$ZodIssue[], boundary?: string) {
    const where = boundary ? ` at ${boundary}` : '';
    super(`boundary parse failed${where}: ${issues.length} issue(s)`);
    this.name = 'BoundaryParseError';
    this.issues = issues;
    this.boundary = boundary;
  }
}

// Throws BoundaryParseError on invalid input. No silent coercion, no `as`.
export function parseBoundary<T>(schema: z.ZodType<T>, input: unknown, boundary?: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BoundaryParseError(result.error.issues, boundary);
  }
  return result.data;
}

// Non-throwing variant for boundaries that convert failures into an errorResponse.
export function parseBoundarySafe<T>(
  schema: z.ZodType<T>,
  input: unknown,
  boundary?: string,
): { ok: true; value: T } | { ok: false; error: BoundaryParseError } {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: new BoundaryParseError(result.error.issues, boundary) };
  }
  return { ok: true, value: result.data };
}
