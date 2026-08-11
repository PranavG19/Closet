// The add-garment flow: ApprovedPhoto -> upload bytes -> parsePhoto({hash, kind}).
//
// A pure injectable function rather than a hook, for a mechanical reason recorded in
// docs/ORCHESTRATION.md and vitest.config.ts:26-45: there is NO render-test
// infrastructure in this repo (no @testing-library/react-native, no jsdom environment)
// and a `.test.tsx` matches no vitest glob, so it would be SILENTLY SKIPPED. So every
// decision that matters lives in a pure `.ts` module and this is what gets tested.
//
// THE ORACLE IS THE CAPTURED WIRE CALL plus the error contract that already exists in
// src/api/client.ts (ApiError{status, code}) and parse-photo.ts's errorResponse calls —
// not this module's own output. The codes are written out as literals here; they were
// read off the server, not re-exported from it.
//
// OUT OF SCOPE: classifier recall (device-ML, labeled corpus, human-owned) and EXIF
// absence in the uploaded bytes (native re-encode, needs a device).
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  approvePhoto,
  screenPhoto,
  tapApproved,
  type ApprovedPhoto,
  type TappedPhoto,
} from '@closet/shared';
import { addApprovedGarment, classifyParseFailure, type AddGarmentDeps } from './addGarment.js';
import { ApiError } from '../api/client.js';
import { PhotoUploadError } from './uploadApproved.js';

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const PHOTO_BYTES = new Uint8Array([0x0a, 0x0b, 0x0c]).buffer;
const EXPECTED_HASH = createHash('sha256').update(Buffer.from(PHOTO_BYTES)).digest('hex');

// A photo the screener passed AND she tapped. approvePhoto REQUIRES the TappedPhoto and
// refuses any verdict but `candidate`, so the only way to hold an ApprovedPhoto at all is to
// have gone through the screener AND her tap. Built through both real minters because each
// link carries its own unexported brand — an object literal is neither. The verdict gate is
// graded in packages/shared/src/approvedPhoto.test.ts; here it is the cost of a real fixture.
const TAPPED: TappedPhoto = tapApproved(
  screenPhoto(
    {
      id: 'photo-1',
      source: 'hand_picked',
      uri: 'file:///tmp/photo-1.jpg',
      bytes: PHOTO_BYTES,
      contentType: 'image/jpeg',
    },
    'candidate',
  ),
);

async function approvedFixture(): Promise<ApprovedPhoto> {
  return approvePhoto({
    tapped: TAPPED,
    sha256Hex: async (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
  });
}

const PARSE_RESULT = { job: { id: 'job-1' }, items: [] } as const;

function makeDeps(
  overrides: {
    readonly upload?: AddGarmentDeps['upload'];
    readonly parsePhoto?: AddGarmentDeps['parsePhoto'];
  } = {},
): {
  deps: AddGarmentDeps;
  uploads: { userId: string; hash: string }[];
  parses: unknown[];
} {
  const uploads: { userId: string; hash: string }[] = [];
  const parses: unknown[] = [];
  const deps: AddGarmentDeps = {
    userId: USER_ID,
    upload:
      overrides.upload ??
      vi.fn(async (input) => {
        uploads.push({ userId: input.userId, hash: input.photo.source_photo_hash });
        return { source_photo_hash: input.photo.source_photo_hash };
      }),
    parsePhoto:
      overrides.parsePhoto ??
      vi.fn(async (request) => {
        parses.push(request);
        return PARSE_RESULT as never;
      }),
  };
  return { deps, uploads, parses };
}

describe('addApprovedGarment — the order and the payload', () => {
  it('uploads the bytes BEFORE calling parse', async () => {
    // parse-photo signs a URL for the object and hands it to two paid vendors that fetch
    // it themselves. Parsing before the bytes exist yields a 404 at sign time reported as
    // a deliberately non-diagnostic 502.
    const order: string[] = [];
    const { deps } = makeDeps({
      upload: vi.fn(async (input) => {
        order.push('upload');
        return { source_photo_hash: input.photo.source_photo_hash };
      }),
      parsePhoto: vi.fn(async () => {
        order.push('parse');
        return PARSE_RESULT as never;
      }),
    });

    await addApprovedGarment(deps, { photo: await approvedFixture(), kind: 'teaser' });
    expect(order).toEqual(['upload', 'parse']);
  });

  it('sends the HASH from the approved photo, and the kind', async () => {
    const { deps, parses } = makeDeps();
    await addApprovedGarment(deps, { photo: await approvedFixture(), kind: 'full' });
    expect(parses).toEqual([{ source_photo_hash: EXPECTED_HASH, kind: 'full' }]);
  });

  it('sends NO path, NO uri, NO bytes on the parse request — only hash + kind', async () => {
    // THE 44812c5 REGRESSION GUARD. `source_photo_path` is absent from
    // CreateParseJobRequest and .strict() would 400 it, but the structural point is that
    // this function never has a path to send: the server derives it from the verified sub.
    const { deps, parses } = makeDeps();
    await addApprovedGarment(deps, { photo: await approvedFixture(), kind: 'teaser' });

    const sent = parses[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['kind', 'source_photo_hash']);
    for (const forbidden of ['source_photo_path', 'path', 'uri', 'url', 'bytes', 'user_id']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
    // And nothing that merely LOOKS like a path slipped into the hash field.
    expect(String(sent.source_photo_hash)).not.toContain('/');
    expect(String(sent.source_photo_hash)).not.toContain('original');
  });

  it('uploads under the SESSION user id, not anything from the photo', async () => {
    const { deps, uploads } = makeDeps();
    await addApprovedGarment(deps, { photo: await approvedFixture(), kind: 'teaser' });
    expect(uploads).toEqual([{ userId: USER_ID, hash: EXPECTED_HASH }]);
  });

  it('does NOT call parse when the upload fails', async () => {
    // Spending a teaser-cap slot (or a paid full parse) on an object that is not there is
    // pure waste, and the 502 it produces is indistinguishable from a vendor outage.
    const parsePhoto = vi.fn(async () => PARSE_RESULT as never);
    const { deps } = makeDeps({
      upload: vi.fn(async () => {
        throw new PhotoUploadError();
      }),
      parsePhoto,
    });

    await expect(
      addApprovedGarment(deps, { photo: await approvedFixture(), kind: 'teaser' }),
    ).rejects.toBeInstanceOf(PhotoUploadError);
    expect(parsePhoto).not.toHaveBeenCalled();
  });
});

describe('addApprovedGarment — idempotency under retry', () => {
  it('re-running the SAME approved photo sends the SAME hash both times', async () => {
    // The hash is the per-photo idempotency key (UNIQUE(user_id, source_photo_hash)), and
    // it is minted once at APPROVE time — the moment she taps — never inside this call.
    // So a retry of this whole flow re-sends the same key: Storage upserts the same bytes
    // to the same object, and parse-photo replays rather than creating a second job or
    // burning a second teaser slot.
    const photo = await approvedFixture();
    const { deps, uploads, parses } = makeDeps();

    await addApprovedGarment(deps, { photo, kind: 'teaser' });
    await addApprovedGarment(deps, { photo, kind: 'teaser' });

    expect(uploads[0]?.hash).toBe(uploads[1]?.hash);
    expect(parses[0]).toEqual(parses[1]);
  });

  it('never mints or rewrites the hash it was given', async () => {
    // If this function hashed anything itself, a retry would produce a fresh key and
    // duplicate the work past the UNIQUE index.
    const photo = await approvedFixture();
    const { deps, parses } = makeDeps();
    await addApprovedGarment(deps, { photo, kind: 'teaser' });
    expect((parses[0] as { source_photo_hash: string }).source_photo_hash).toBe(
      photo.source_photo_hash,
    );
  });
});

describe('classifyParseFailure — each server code surfaces distinctly', () => {
  // The codes and statuses are the ones parse-photo.ts actually returns. They are written
  // out here as literals read off the server, so a server rename fails this test rather
  // than silently collapsing two conditions into one message on device.
  it.each([
    [402, 'entitlement_required', 'needs_membership'],
    [402, 'teaser_cap_reached', 'teaser_exhausted'],
    [409, 'parse_already_in_progress', 'already_parsing'],
    [429, 'parse_rate_limited', 'slow_down'],
    [502, 'parse_provider_failed', 'try_again'],
    [400, 'invalid_request', 'try_again'],
  ] as const)('maps %i %s to %s', (status, code, expected) => {
    expect(classifyParseFailure(new ApiError(status, code, 'server text'))).toBe(expected);
  });

  it('the two 402 paywall codes are NOT collapsed together', () => {
    // Same status, completely different product meaning: "subscribe to parse this" vs
    // "you have used all 10 free parses". A screen that treats them alike either nags a
    // member or hides the upsell from the person who has hit the cap.
    const entitlement = classifyParseFailure(new ApiError(402, 'entitlement_required', 'x'));
    const cap = classifyParseFailure(new ApiError(402, 'teaser_cap_reached', 'x'));
    expect(entitlement).not.toBe(cap);
  });

  it('409 already-parsing is TRANSIENT, distinct from a real failure', () => {
    // There is no parse-job read route, so the only recovery is resubmitting after the
    // claim lease and landing on the done-replay path. It must not read as a hard error.
    expect(classifyParseFailure(new ApiError(409, 'parse_already_in_progress', 'x'))).toBe(
      'already_parsing',
    );
    expect(classifyParseFailure(new ApiError(502, 'parse_provider_failed', 'x'))).toBe('try_again');
  });

  it('an upload failure is its own outcome, not a parse failure', () => {
    expect(classifyParseFailure(new PhotoUploadError())).toBe('upload_failed');
  });

  it('an unknown code falls back to a generic outcome rather than throwing', () => {
    expect(classifyParseFailure(new ApiError(500, 'something_new', 'x'))).toBe('try_again');
    expect(classifyParseFailure(new Error('offline'))).toBe('try_again');
    expect(classifyParseFailure(undefined)).toBe('try_again');
  });

  it('NEVER returns raw server text (it can carry PII)', () => {
    // The outcome is a closed set of tokens, so a raw server message cannot reach the UI
    // through this path even by accident.
    const leaky = new ApiError(502, 'parse_provider_failed', `failed for ${USER_ID} at /home/x`);
    const outcome: string = classifyParseFailure(leaky);
    expect(outcome).not.toContain(USER_ID);
    expect(outcome).not.toContain('/home/x');
    expect(outcome).toBe('try_again');
  });
});
