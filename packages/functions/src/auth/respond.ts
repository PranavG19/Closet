// respond — the two response shapes every handler returns. A JSON success and a
// structured error envelope. The error body is a fixed shape `{ error: { code,
// message } }` with a SAFE, caller-facing message only — never raw DB/exception
// text (PII rule). BoundaryParseError from @closet/shared maps to a 400 without
// leaking the parsed input or the Zod issue paths to the client.
import { BoundaryParseError, type ErrorEnvelope } from '@closet/shared';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// A curated set of client-safe codes. `message` is a fixed, non-sensitive string;
// it never carries a DB error, a stack, or the offending input.
//
// The body is typed as shared's ErrorEnvelope — the SAME declaration the mobile client
// parses with. The envelope used to be declared independently on each side and they
// disagreed (flat vs nested), which was invisible because an all-optional Zod object
// parses successfully against a body with none of its keys. Typing against the shared
// schema makes that drift a compile error.
export function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorEnvelope = { error: { code, message } };
  return jsonResponse(status, body);
}

// Map a thrown value to a safe response. A boundary parse failure is the caller's
// fault → 400 with a generic message (the Zod issues are NOT echoed to the wire).
// Anything else is an unexpected server fault → 500 with no detail. Neither path
// puts the raw error text on the wire.
export function errorFromThrown(thrown: unknown): Response {
  if (thrown instanceof BoundaryParseError) {
    return errorResponse(400, 'invalid_request', 'Request failed validation.');
  }
  return errorResponse(500, 'internal_error', 'An unexpected error occurred.');
}
