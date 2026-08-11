// The upload chokepoint — the ONLY code in packages/mobile that writes bytes to the
// `originals` bucket.
//
// THE ORACLE IS THE CAPTURED CALL, not the module's return value: every test asserts
// against the exact (path, body, options) the fake Storage received, with the expected
// key written out as an INDEPENDENT LITERAL. This file never calls sourcePhotoObjectKey
// to build an expectation, so a bug inside the composer (notably a {hash}/{sub}
// inversion) cannot make its own test agree.
//
// OUT OF SCOPE, stated plainly: classifier RECALL (does an on-device model really drop
// intimate / not-her photos) is a device-ML oracle needing a human-curated labeled
// corpus — docs/05:205 and docs/06 §8.3, human-owned safety go/no-go. Nothing here
// speaks to it. Also NOT provable in Node: that the uploaded bytes carry no EXIF/APP1
// marker (expo-image-manipulator is native — see the note in uploadApproved.ts).
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  approvePhoto,
  screenPhoto,
  tapApproved,
  type ApprovedPhoto,
  type TappedPhoto,
  type Sha256Hex,
} from '@closet/shared';
import { uploadApprovedPhoto, ORIGINALS_BUCKET, PhotoUploadError } from './uploadApproved.js';

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const OTHER_USER = 'ffffffff-1111-4222-8333-444444444444';

const PHOTO_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;

// Independent SHA-256 (node:crypto), and the hash the fixture will therefore carry. It is
// also the digest port the chokepoint's runtime backstop re-derives with — the same
// implementation the minter used, which is the sanctioned wiring (useAddGarment passes the
// port's own sha256Hex to both).
const nodeSha256Hex: Sha256Hex = async (bytes) =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');

const EXPECTED_HASH = createHash('sha256').update(Buffer.from(PHOTO_BYTES)).digest('hex');

// The expected key, hand-composed from the two independently-known parts. Deliberately
// NOT sourcePhotoObjectKey(...).
const EXPECTED_KEY = `${USER_ID}/${EXPECTED_HASH}/original`;

interface UploadCall {
  readonly bucket: string;
  readonly path: string;
  readonly body: unknown;
  readonly options: Record<string, unknown> | undefined;
}

// A Storage fake narrow enough to drive both outcomes, capturing every call.
function stubStorage(
  outcome: { readonly ok: true } | { readonly ok: false; readonly message: string },
): { client: SupabaseClient; calls: UploadCall[] } {
  const calls: UploadCall[] = [];
  const from = vi.fn((bucket: string) => ({
    upload: vi.fn(async (path: string, body: unknown, options?: Record<string, unknown>) => {
      calls.push({ bucket, path, body, options });
      return outcome.ok
        ? { data: { id: 'x', path, fullPath: `${bucket}/${path}` }, error: null }
        : { data: null, error: new Error(outcome.message) };
    }),
  }));
  return { client: { storage: { from } } as unknown as SupabaseClient, calls };
}

// A photo the screener passed AND she tapped. approvePhoto REQUIRES the TappedPhoto and
// refuses any verdict but `candidate`, so the brand means "the screener passed this AND she
// tapped it". Built through both real minters — each link carries its own unexported brand,
// so an object literal is neither. The verdict gate itself is graded in
// packages/shared/src/approvedPhoto.test.ts; here a passing verdict and a tap are just what
// it takes to obtain a real ApprovedPhoto to upload.
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
    sha256Hex: nodeSha256Hex,
  });
}

describe('uploadApprovedPhoto — the key it writes to', () => {
  it('uploads to {user_id}/{source_photo_hash}/original in the originals bucket', async () => {
    const { client, calls } = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex });

    expect(calls).toHaveLength(1);
    // Against the independent literal.
    expect(calls[0]?.path).toBe(EXPECTED_KEY);
    expect(calls[0]?.bucket).toBe('originals');
    expect(ORIGINALS_BUCKET).toBe('originals');
  });

  it('puts the OWNER first in the key — migration 0013 refuses anything else', async () => {
    // 0013's predicate is (storage.foldername(name))[1] = auth.uid()::text. A
    // {hash}/{user_id} inversion is refused by RLS at upload time, and this is the
    // assertion that catches it before a device ever sees it.
    const { client, calls } = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex });

    const segments = calls[0]!.path.split('/');
    expect(segments[0]).toBe(USER_ID);
    expect(segments[1]).toBe(EXPECTED_HASH);
    expect(segments[2]).toBe('original');
    expect(segments).toHaveLength(3);
  });

  it('composes the key from the SESSION user id, never from anything caller-shaped', async () => {
    // Two users approving the SAME photo bytes must land in different prefixes.
    const photo = await approvedFixture();
    const a = stubStorage({ ok: true });
    const b = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client: a.client, userId: USER_ID, photo, sha256Hex: nodeSha256Hex });
    await uploadApprovedPhoto({ client: b.client, userId: OTHER_USER, photo, sha256Hex: nodeSha256Hex });

    expect(a.calls[0]?.path.split('/')[0]).toBe(USER_ID);
    expect(b.calls[0]?.path.split('/')[0]).toBe(OTHER_USER);
    expect(a.calls[0]?.path).not.toBe(b.calls[0]?.path);
  });

  it('the key carries NO file extension', async () => {
    const { client, calls } = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex });
    expect(calls[0]?.path).not.toMatch(/\.(jpe?g|png|heic)$/i);
  });
});

describe('uploadApprovedPhoto — what it returns to the parse step', () => {
  it('returns ONLY the hash — never a path', async () => {
    // THE LOAD-BEARING ASSERTION OF THIS WHOLE SEAM. The client must send the server a
    // hash and nothing else; the server DERIVES the path from the verified sub.
    // A returned path would invite a caller to forward it (CreateParseJobRequest is
    // .strict() and would 400, but the honest fix is that no path is available to send).
    const { client } = stubStorage({ ok: true });
    const result = await uploadApprovedPhoto({
      client,
      userId: USER_ID,
      photo: await approvedFixture(),
      sha256Hex: nodeSha256Hex,
    });

    expect(result).toEqual({ source_photo_hash: EXPECTED_HASH });
    expect(Object.keys(result)).toEqual(['source_photo_hash']);
    // No key/path/url under any name.
    expect(JSON.stringify(result)).not.toContain('original');
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });
});

describe('uploadApprovedPhoto — the upload options', () => {
  it('sets an explicit image content type', async () => {
    // supabase-js defaults to `text/plain;charset=UTF-8`, and the key has no extension.
    // Both paid vendors FETCH this object by URL from their own servers, so a text/plain
    // original surfaces as a vendor error dressed as a provider outage.
    const { client, calls } = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex });
    expect(calls[0]?.options?.contentType).toBe('image/jpeg');
  });

  it('upserts, so re-approving the same photo is idempotent rather than a 409', async () => {
    // The key is content-addressed, so a re-upload writes byte-identical content. Without
    // upsert a legitimate re-parse gets a Storage 409 Duplicate while the parse-job side
    // happily replays — an asymmetry that reads as a random failure.
    const { client, calls } = stubStorage({ ok: true });
    await uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex });
    expect(calls[0]?.options?.upsert).toBe(true);
  });

  it('uploads the approved bytes VERBATIM — the hash and the object cannot disagree', async () => {
    const { client, calls } = stubStorage({ ok: true });
    const photo = await approvedFixture();
    await uploadApprovedPhoto({ client, userId: USER_ID, photo, sha256Hex: nodeSha256Hex });
    expect(calls[0]?.body).toBe(photo.bytes);
  });
});

describe('uploadApprovedPhoto — failure is typed, and never leaks the raw message', () => {
  it('throws PhotoUploadError when Storage refuses', async () => {
    const { client } = stubStorage({ ok: false, message: 'new row violates row-level security' });
    await expect(
      uploadApprovedPhoto({ client, userId: USER_ID, photo: await approvedFixture(), sha256Hex: nodeSha256Hex }),
    ).rejects.toBeInstanceOf(PhotoUploadError);
  });

  it('does NOT carry the raw Storage message (it can hold a path / PII)', async () => {
    const secret = `row-level security violated for ${USER_ID}/private-thing`;
    const { client } = stubStorage({ ok: false, message: secret });
    const thrown = await uploadApprovedPhoto({
      client,
      userId: USER_ID,
      photo: await approvedFixture(),
      sha256Hex: nodeSha256Hex,
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(PhotoUploadError);
    expect((thrown as Error).message).not.toContain(secret);
    expect((thrown as Error).message).not.toContain(USER_ID);
  });
});
