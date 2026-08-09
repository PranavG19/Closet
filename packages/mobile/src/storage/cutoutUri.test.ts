// The oracle is the DEGRADATION CONTRACT, not the happy path: a wardrobe screen must render
// even when image signing fails, because a closet with one unsignable garment is still a
// closet. Every case here is "what does the grid get when something goes wrong".
//
// This lives under src/ rather than features/ for a mechanical reason: the vitest `unit`
// project globs `packages/*/src/**/*.test.ts`, so a test under features/ is SILENTLY NOT RUN
// — it does not fail, it never executes. Signed-URL minting is also genuinely a storage seam
// rather than a wardrobe concern: suggestions and outfits need the same cutouts.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signCutoutUri, signCutoutUris } from './cutoutUri.js';

// A Supabase storage stub narrow enough to drive the two outcomes that matter.
function stubClient(
  outcome:
    | { readonly signedUrl: string }
    | { readonly error: string },
): { client: SupabaseClient; calls: { path: string; ttl: number }[] } {
  const calls: { path: string; ttl: number }[] = [];
  const createSignedUrl = vi.fn(async (path: string, ttl: number) => {
    calls.push({ path, ttl });
    return 'error' in outcome
      ? { data: null, error: new Error(outcome.error) }
      : { data: { signedUrl: outcome.signedUrl }, error: null };
  });
  const client = { storage: { from: () => ({ createSignedUrl }) } } as unknown as SupabaseClient;
  return { client, calls };
}

describe('signCutoutUri', () => {
  it('returns the signed URL for a real path', async () => {
    const { client } = stubClient({ signedUrl: 'https://x.supabase.co/signed?token=abc' });
    expect(await signCutoutUri(client, 'user-1/job-1/cutout.png')).toBe(
      'https://x.supabase.co/signed?token=abc',
    );
  });

  it('signs the path VERBATIM — never a client-composed one', async () => {
    // The path comes from the server-returned row. Rewriting it here would be the
    // client-composed-storage-path pattern that was a cross-tenant read + SSRF sink in
    // 44812c5, and it would also just miss the object.
    const { client, calls } = stubClient({ signedUrl: 'https://x/y' });
    await signCutoutUri(client, 'user-1/job-1/cutout.png');
    expect(calls[0]?.path).toBe('user-1/job-1/cutout.png');
  });

  it('returns null for a null path WITHOUT calling the store', async () => {
    // A garment added before its parse finished has cutout_path === null. That is normal,
    // not an error, and must not cost a round-trip.
    const { client, calls } = stubClient({ signedUrl: 'https://x/y' });
    expect(await signCutoutUri(client, null)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null for an empty path without calling the store', async () => {
    const { client, calls } = stubClient({ signedUrl: 'https://x/y' });
    expect(await signCutoutUri(client, '')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('RESOLVES NULL — never throws — when signing fails', async () => {
    // This is the whole contract. A throw here would take down the entire closet screen over
    // one unrenderable tile, whether the cause was RLS refusing or the network dying.
    const { client } = stubClient({ error: 'row-level security' });
    await expect(signCutoutUri(client, 'user-1/job-1/cutout.png')).resolves.toBeNull();
  });

  it('requests a bounded TTL, so a leaked URL is not a durable capability', async () => {
    const { client, calls } = stubClient({ signedUrl: 'https://x/y' });
    await signCutoutUri(client, 'p');
    expect(calls[0]?.ttl).toBeGreaterThan(0);
    // A signed URL is a bearer token; expiry is the only thing limiting a leak.
    expect(calls[0]?.ttl).toBeLessThanOrEqual(24 * 60 * 60);
  });
});

describe('signCutoutUris — a page of garments', () => {
  const rows = [
    { id: 'a', cutout_path: 'u/1/a.png' },
    { id: 'b', cutout_path: null },
    { id: 'c', cutout_path: 'u/1/c.png' },
  ];

  it('maps item id -> url and OMITS the rows with no cutout', async () => {
    // Omission (rather than an explicit null) is what makes `uris[id] === undefined` the
    // single "draw the placeholder" condition at the call site — no null-vs-undefined split.
    const { client } = stubClient({ signedUrl: 'https://x/y' });
    const uris = await signCutoutUris(client, rows);
    expect(Object.keys(uris).sort()).toEqual(['a', 'c']);
    expect(uris['b']).toBeUndefined();
  });

  it('returns an empty map — not a rejection — when every signing fails', async () => {
    const { client } = stubClient({ error: 'offline' });
    await expect(signCutoutUris(client, rows)).resolves.toEqual({});
  });

  it('handles an empty page', async () => {
    const { client } = stubClient({ signedUrl: 'https://x/y' });
    await expect(signCutoutUris(client, [])).resolves.toEqual({});
  });

  it('signs concurrently, not serially', async () => {
    // 50 sequential round-trips before the first tile paints would be a visibly slow closet.
    // Concurrency is observable as overlap: all calls start before any resolves.
    let inFlight = 0;
    let maxInFlight = 0;
    const createSignedUrl = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { data: { signedUrl: 'https://x/y' }, error: null };
    });
    const client = { storage: { from: () => ({ createSignedUrl }) } } as unknown as SupabaseClient;
    await signCutoutUris(client, [
      { id: 'a', cutout_path: 'a' },
      { id: 'b', cutout_path: 'b' },
      { id: 'c', cutout_path: 'c' },
    ]);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
