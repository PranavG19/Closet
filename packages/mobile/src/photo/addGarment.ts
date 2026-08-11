// The add-garment flow: ApprovedPhoto -> upload bytes -> parsePhoto({hash, kind}).
//
// Written as a PURE INJECTABLE FUNCTION, not a hook, and deliberately so: this repo has no
// render-test infrastructure (no @testing-library/react-native, no jsdom) and a
// `.test.tsx` matches no vitest glob, so it would be silently skipped. Everything that can
// be decided is decided here, where a plain `.test.ts` really runs. The react-query
// wrapper is a thin shell over this (see useAddGarment.ts).
//
// TWO INVARIANTS THIS FILE EXISTS TO HOLD:
//
// 1. THE CLIENT NEVER SENDS A PATH. It sends `{source_photo_hash, kind}` and nothing else.
//    The server derives `source_photo_path` from the verified JWT `sub`. This is not
//    merely validated (CreateParseJobRequest is .strict() and would 400) — this function
//    has no path value to send in the first place. A path a VENDOR fetches sits outside
//    every DB policy's reach, which is why 44812c5 removed it from the wire.
//
// 2. THE HASH IS MINTED AT APPROVE TIME, NEVER HERE. It arrives on the ApprovedPhoto,
//    computed at the moment she tapped approve. That is the same rule as client_id for a
//    wear-log (CLAUDE.md): if this function derived the key, a retry would mint a fresh one
//    and duplicate the work past UNIQUE(user_id, source_photo_hash) — burning a teaser-cap
//    slot, or a real charge, per retry. Because the key is stable, a retry upserts the same
//    object and parse-photo replays.
import type { CreateParseJobRequest, ParseJobKind, ApprovedPhoto } from '@closet/shared';
import type { ParseResultResponse } from '../api/schemas.js';
import { ApiError } from '../api/client.js';
import { PhotoUploadError, type UploadedPhotoRef } from './uploadApproved.js';

// What the upload seam needs from this flow. The Supabase client is deliberately NOT part
// of it: the wiring closes over the client (see useAddGarment.ts), so this module never
// holds one — which is what keeps the upload chokepoint singular and lets the whole flow
// test with no Supabase runtime.
export interface AddGarmentUploadInput {
  readonly userId: string;
  readonly photo: ApprovedPhoto;
}

// The two seams, injected so this whole flow tests with no Supabase runtime and no network.
export interface AddGarmentDeps {
  // The signed-in user's own id (JWT `sub`) — the first segment of the upload key.
  readonly userId: string;
  readonly upload: (input: AddGarmentUploadInput) => Promise<UploadedPhotoRef>;
  readonly parsePhoto: (request: CreateParseJobRequest) => Promise<ParseResultResponse>;
}

export interface AddGarmentInput {
  // ONLY an approved photo. The brand makes any other value fail to compile — see
  // unrepresentable.test.ts. This is the app's privacy invariant expressed as a type.
  readonly photo: ApprovedPhoto;
  readonly kind: ParseJobKind;
}

export async function addApprovedGarment(
  deps: AddGarmentDeps,
  input: AddGarmentInput,
): Promise<ParseResultResponse> {
  // Bytes FIRST. parse-photo signs a URL for this object and hands it to two paid vendors
  // whose own servers perform the fetch, so parsing before the object exists produces a
  // 404 at sign time surfaced as a deliberately non-diagnostic 502.
  const uploaded = await deps.upload({ userId: deps.userId, photo: input.photo });

  // Only the hash crosses. No path, by construction.
  return deps.parsePhoto({ source_photo_hash: uploaded.source_photo_hash, kind: input.kind });
}

// The CLOSED set of outcomes a screen may render. A closed token set (the same shape as
// AuthErrorCode in src/session/AuthPort.ts) is what keeps raw server text — which can
// carry a storage path or an id — off the screen entirely.
export type AddGarmentOutcome =
  | 'upload_failed'
  | 'needs_membership'
  | 'teaser_exhausted'
  | 'already_parsing'
  | 'slow_down'
  | 'try_again';

// Maps a thrown value onto one outcome. The codes are the ones parse-photo.ts returns;
// each is distinguished because they mean genuinely different things to her:
//   - entitlement_required     -> she must subscribe for a full parse
//   - teaser_cap_reached       -> her 10 free parses are gone (SAME 402 status, different
//                                product meaning — collapsing the two either nags a member
//                                or hides the upsell from someone who hit the cap)
//   - parse_already_in_progress-> TRANSIENT: this photo is being parsed right now. There is
//                                no parse-job read route, so the only recovery is
//                                resubmitting after the 10-minute claim lease and landing
//                                on the done-replay path. Not a hard error.
//   - parse_rate_limited       -> purely "wait" (the server sends retry-after; ApiError
//                                does not carry headers today, so the UI cannot show the
//                                exact window — noted, not worked around)
export function classifyParseFailure(thrown: unknown): AddGarmentOutcome {
  if (thrown instanceof PhotoUploadError) return 'upload_failed';
  if (!(thrown instanceof ApiError)) return 'try_again';

  switch (thrown.code) {
    case 'entitlement_required':
      return 'needs_membership';
    case 'teaser_cap_reached':
      return 'teaser_exhausted';
    case 'parse_already_in_progress':
      return 'already_parsing';
    case 'parse_rate_limited':
      return 'slow_down';
    default:
      // Includes parse_provider_failed and invalid_request. Both are "something went
      // wrong, try again" to her; the distinction is a server-side diagnostic, and the
      // raw message is never surfaced.
      return 'try_again';
  }
}
