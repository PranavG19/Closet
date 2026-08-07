// Independent oracle for the REAL cutout storage-writer. Fully injected fake
// transport — NO network, NO real bucket. The load-bearing assertion is the FIRST
// PATH SEGMENT: migration 0013's policy is
//   bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text
// so if segment 1 is not the owning user_id the upload is REFUSED by RLS (or, worse
// under a bypassing key, silently lands in another tenant's prefix). The expected
// path here is written out INDEPENDENTLY as a literal — it never calls
// cutoutObjectPath, so a bug inside the helper cannot make its own test agree.
import { describe, it, expect, vi } from 'vitest';
import { makeSupabaseStorageWriter } from './supabase-storage.writer.js';
import type { CutoutScope } from './photoroom-cutout.adapter.js';
import type { FetchFn } from './http.js';

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const JOB_ID = '7f8e9d0c-1b2a-4c3d-8e4f-5a6b7c8d9e0f';
const SCOPE: CutoutScope = { userId: USER_ID, parseJobId: JOB_ID };

// Independently authored, not derived from the code under test.
const EXPECTED_PATH = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d/7f8e9d0c-1b2a-4c3d-8e4f-5a6b7c8d9e0f/cutout.png';

const SUPABASE_URL = 'https://proj.supabase.co';
const ANON_KEY = 'anon-key-abc';
const ACCESS_TOKEN = 'caller-jwt-xyz';

// Build a minimal VALID PNG header: signature + IHDR with width/height/colorType.
// colorType 6 = RGBA (has alpha). This is real byte layout, not a stub, so the
// writer's decode is exercised rather than bypassed.
function pngBytes(width: number, height: number, colorType = 6): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const view = new DataView(buf);
  for (const [i, b] of [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].entries()) view.setUint8(i, b);
  view.setUint32(8, 13); // IHDR length
  for (const [i, ch] of [...'IHDR'].entries()) view.setUint8(12 + i, ch.charCodeAt(0));
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint8(24, 8); // bit depth
  view.setUint8(25, colorType);
  return buf;
}

const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

function okResponse(): Response {
  return new Response(JSON.stringify({ Key: 'cutouts/whatever' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWriter(fetchFn: FetchFn) {
  return makeSupabaseStorageWriter({
    accessToken: ACCESS_TOKEN,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    fetchFn,
    ...fastTransport,
  });
}

describe('supabase storage writer — the RLS-critical path', () => {
  it('composes {user_id}/{parse_job_id}/cutout.png and returns it as the stored path', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    const stored = await makeWriter(fetchFn)({ bytes: pngBytes(800, 1200), contentType: 'image/png' }, SCOPE);

    expect(stored.imageUrl).toBe(EXPECTED_PATH);
    // Dimensions come from the PNG's own IHDR, not from an assumption.
    expect(stored).toEqual({ imageUrl: EXPECTED_PATH, hasAlpha: true, width: 800, height: 1200 });
  });

  it('FIRST path segment is exactly the owning user_id (the 0013 predicate)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    const stored = await makeWriter(fetchFn)({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE);

    // This is what (storage.foldername(name))[1] evaluates to.
    expect(stored.imageUrl.split('/')[0]).toBe(USER_ID);
    // And the URL actually uploaded to carries the same owner-first prefix.
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${SUPABASE_URL}/storage/v1/object/cutouts/${EXPECTED_PATH}`);
  });

  it('uploads under the CALLER’s JWT (not a service_role key) so auth.uid() resolves to the owner', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    await makeWriter(fetchFn)({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE);

    const [, init] = fetchFn.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    // A service_role bearer would BYPASS the 0013 policy — assert it is absent.
    expect(JSON.stringify(headers)).not.toMatch(/service_role/);
  });

  it('a different owner gets a different prefix — one caller cannot land in another’s', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    const writer = makeWriter(fetchFn);
    const a = await writer({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE);
    const otherUser = 'ffffffff-1111-4222-8333-444444444444';
    const b = await writer({ bytes: pngBytes(10, 10), contentType: 'image/png' }, { ...SCOPE, userId: otherUser });

    expect(a.imageUrl.split('/')[0]).toBe(USER_ID);
    expect(b.imageUrl.split('/')[0]).toBe(otherUser);
    expect(a.imageUrl).not.toBe(b.imageUrl);
  });
});

describe('supabase storage writer — fails closed, never a bogus cutout', () => {
  it('rejects non-PNG bytes BEFORE uploading anything', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    const notPng = new TextEncoder().encode('<html>error page</html>').buffer as ArrayBuffer;

    await expect(
      makeWriter(fetchFn)({ bytes: notPng, contentType: 'image/png' }, SCOPE),
    ).rejects.toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects empty bytes rather than storing a zero-byte "cutout"', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    await expect(
      makeWriter(fetchFn)({ bytes: new ArrayBuffer(0), contentType: 'image/png' }, SCOPE),
    ).rejects.toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a PNG with no alpha channel (colorType 2) — not a cutout', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    await expect(
      makeWriter(fetchFn)({ bytes: pngBytes(10, 10, 2), contentType: 'image/png' }, SCOPE),
    ).rejects.toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a zero-dimension PNG (would violate the positive-int result schema)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse());
    await expect(
      makeWriter(fetchFn)({ bytes: pngBytes(0, 500), contentType: 'image/png' }, SCOPE),
    ).rejects.toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('propagates a vendor/storage 4xx as a throw (parse-photo turns it into 502)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response('denied', { status: 403 }));
    await expect(
      makeWriter(fetchFn)({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE),
    ).rejects.toBeTruthy();
  });

  it('missing SUPABASE_URL surfaces as a clear missing-env throw, not a bad URL', async () => {
    const previousUrl = process.env['SUPABASE_URL'];
    delete process.env['SUPABASE_URL'];
    try {
      const fetchFn = vi.fn<FetchFn>(async () => okResponse());
      const writer = makeSupabaseStorageWriter({
        accessToken: ACCESS_TOKEN,
        anonKey: ANON_KEY,
        fetchFn,
        ...fastTransport,
      });
      await expect(
        writer({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE),
      ).rejects.toThrow(/missing required env: SUPABASE_URL/);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previousUrl !== undefined) process.env['SUPABASE_URL'] = previousUrl;
    }
  });
});

describe('supabase storage writer — no secret or vendor body leaks', () => {
  it('never puts a key or token in the request URL, and never logs', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(globalThis.console, 'log').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    try {
      const fetchFn = vi.fn<FetchFn>(async () => okResponse());
      await makeWriter(fetchFn)({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE);

      const [url] = fetchFn.mock.calls[0]!;
      // Authority travels in headers ONLY — a URL lands in logs/proxies/referrers.
      expect(url).not.toContain(ACCESS_TOKEN);
      expect(url).not.toContain(ANON_KEY);
      // The writer emits nothing at all; parse-photo owns the one structured log line.
      expect(logged).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a storage error carries no vendor response body', async () => {
    const vendorBody = 'SECRET-BUCKET-DETAIL-should-not-propagate';
    const fetchFn = vi.fn<FetchFn>(async () => new Response(vendorBody, { status: 500 }));
    const writer = makeWriter(fetchFn);

    await writer({ bytes: pngBytes(10, 10), contentType: 'image/png' }, SCOPE).then(
      () => expect.unreachable('should have thrown'),
      (err: unknown) => {
        expect(String((err as Error).message)).not.toContain(vendorBody);
      },
    );
  });
});
