// Independent oracle for the source-photo URL minter — the last hop before a
// vendor-fetchable URL for the ORIGINAL exists. Fully injected fake transport: NO
// network, NO real bucket.
//
// The load-bearing assertions are (a) the derived key's FIRST SEGMENT is the owner
// (migration 0013's predicate is (storage.foldername(name))[1] = auth.uid()::text) and
// (b) a key outside the caller's prefix, or one shaped like a URL/traversal, NEVER
// reaches the transport. Expected paths are written out as INDEPENDENT LITERALS — this
// file never calls sourcePhotoObjectKey to build an expectation, so a bug inside the
// helper (notably a {hash}/{user_id} inversion) cannot make its own test agree.
import { describe, it, expect, vi } from 'vitest';
import { BoundaryParseError } from '@closet/shared';
import { makeSupabaseSignedUrlReader, sourcePhotoObjectKey } from './supabase-storage.reader.js';
import type { FetchFn } from './http.js';

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const OTHER_USER = 'ffffffff-1111-4222-8333-444444444444';
const HASH = 'PHOTOHASH1';

// Independently authored, not derived from the code under test.
const EXPECTED_KEY = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d/PHOTOHASH1/original';

const SUPABASE_URL = 'https://proj.supabase.co';
const ANON_KEY = 'anon-key-abc';
const ACCESS_TOKEN = 'caller-jwt-xyz';
const SIGNED_PATH = '/object/sign/originals/x?token=sig';

const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

function signResponse(signedURL: string = SIGNED_PATH): Response {
  return new Response(JSON.stringify({ signedURL }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeMinter(fetchFn: FetchFn, userId = USER_ID) {
  return makeSupabaseSignedUrlReader({
    accessToken: ACCESS_TOKEN,
    userId,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    fetchFn,
    ...fastTransport,
  });
}

describe('sourcePhotoObjectKey — the derived key is owner-first', () => {
  it('composes {user_id}/{source_photo_hash}/original', () => {
    // Compared against the hand-written literal, NOT a re-computation.
    expect(sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH })).toBe(EXPECTED_KEY);
  });

  it('FIRST segment is exactly the owning user_id (the 0013 predicate), not the hash', () => {
    const key = sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH });
    // This is what (storage.foldername(name))[1] evaluates to. A {hash}/{user_id}
    // inversion fails HERE.
    expect(key.split('/')[0]).toBe(USER_ID);
    expect(key.split('/')[0]).not.toBe(HASH);
  });

  it('two callers with the SAME photo hash get different prefixes', () => {
    const a = sourcePhotoObjectKey({ userId: USER_ID, sourcePhotoHash: HASH });
    const b = sourcePhotoObjectKey({ userId: OTHER_USER, sourcePhotoHash: HASH });
    expect(a.split('/')[0]).toBe(USER_ID);
    expect(b.split('/')[0]).toBe(OTHER_USER);
    expect(a).not.toBe(b);
  });
});

describe('signed-url minter — happy path', () => {
  it('signs the caller-owned object and returns an absolute URL on OUR base', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse());
    const url = await makeMinter(fetchFn)(EXPECTED_KEY);

    expect(url).toBe(`${SUPABASE_URL}/storage/v1${SIGNED_PATH}`);
    const [requested] = fetchFn.mock.calls[0]!;
    expect(requested).toBe(`${SUPABASE_URL}/storage/v1/object/sign/originals/${EXPECTED_KEY}`);
  });

  it('signs under the CALLER’s JWT (not service_role) so auth.uid() resolves to the owner', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse());
    await makeMinter(fetchFn)(EXPECTED_KEY);

    const [, init] = fetchFn.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    // A service_role bearer would BYPASS 0013 entirely — assert it is absent.
    expect(JSON.stringify(headers)).not.toMatch(/service_role/);
  });
});

describe('signed-url minter — fails closed, no vendor fetch of a foreign object', () => {
  it('REFUSES a key in another tenant’s prefix and never calls the transport', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse());
    // The exact cross-tenant attack: a key naming victim B while the caller is A.
    const victimKey = `${OTHER_USER}/${HASH}/original`;

    await expect(makeMinter(fetchFn)(victimKey)).rejects.toBeTruthy();
    // No signed URL was ever minted, so no vendor could fetch B's photo.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['an https scheme (SSRF)', 'https://evil.example/x.jpg'],
    ['a metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['a traversal', `${USER_ID}/../${OTHER_USER}/${HASH}/original`],
    ['a leading slash', `/${USER_ID}/${HASH}/original`],
    ['a backslash', `${USER_ID}\\${HASH}\\original`],
    ['an over-long key', `${USER_ID}/${'a'.repeat(600)}/original`],
  ])('refuses %s at the boundary, transport untouched', async (_label, key) => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse());
    await expect(makeMinter(fetchFn)(key)).rejects.toBeInstanceOf(BoundaryParseError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a vendor-returned ABSOLUTE url (would re-open the SSRF it prevents)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse('https://attacker.example/leak'));
    await expect(makeMinter(fetchFn)(EXPECTED_KEY)).rejects.toBeTruthy();
  });

  it('refuses a vendor payload missing signedURL rather than fabricating a URL', async () => {
    const fetchFn = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify({ nope: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(makeMinter(fetchFn)(EXPECTED_KEY)).rejects.toBeInstanceOf(BoundaryParseError);
  });

  it('propagates a storage 403 as a throw (parse-photo turns it into 502)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response('denied', { status: 403 }));
    await expect(makeMinter(fetchFn)(EXPECTED_KEY)).rejects.toBeTruthy();
  });

  it('missing SUPABASE_URL surfaces as a clear missing-env throw, not a bad URL', async () => {
    const previous = process.env['SUPABASE_URL'];
    delete process.env['SUPABASE_URL'];
    try {
      const fetchFn = vi.fn<FetchFn>(async () => signResponse());
      const minter = makeSupabaseSignedUrlReader({
        accessToken: ACCESS_TOKEN,
        userId: USER_ID,
        anonKey: ANON_KEY,
        fetchFn,
        ...fastTransport,
      });
      await expect(minter(EXPECTED_KEY)).rejects.toThrow(/missing required env: SUPABASE_URL/);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env['SUPABASE_URL'] = previous;
    }
  });
});

describe('signed-url minter — no secret leaks', () => {
  it('never puts the token or anon key in the request URL', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => signResponse());
    await makeMinter(fetchFn)(EXPECTED_KEY);

    const [url] = fetchFn.mock.calls[0]!;
    // Authority travels in headers ONLY — a URL lands in logs/proxies/referrers.
    expect(url).not.toContain(ACCESS_TOKEN);
    expect(url).not.toContain(ANON_KEY);
  });
});
