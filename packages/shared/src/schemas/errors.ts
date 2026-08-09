// THE error envelope, declared ONCE. Both sides of the wire import this: the server
// builds bodies with it (packages/functions/src/auth/respond.ts) and the mobile client
// parses them with it (packages/mobile/src/api/client.ts).
//
// It lives in `shared` because mobile cannot import `@closet/functions` — so before
// this file the two sides each hand-wrote the shape, and they DISAGREED. The server
// sent `{ error: { code, message } }` while the client parsed a flat
// `{ code?, message? }`. That specific mismatch was invisible for the worst possible
// reason: an all-optional Zod object SUCCEEDS on a body with none of its keys, so
// safeParse returned `{}` and every error silently became code 'error' / message
// 'Request failed.' — no throw, no log, every status indistinguishable on device.
//
// One declaration is the fix. A change to the envelope is now a compile error on the
// side that did not follow, rather than a runtime shrug.
import { z } from 'zod';

// `.strict()` so an extra top-level key is a parse failure rather than silently
// tolerated — the client should notice if the server starts sending a different shape.
export const ErrorEnvelope = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
