// Turning a stored `wardrobe_items.cutout_path` into something <Image> can load.
//
// WHY THIS IS NOT JUST A URL CONCATENATION: the `cutouts` bucket is PRIVATE (migration
// 0013 creates it with `public = false`) and its SELECT policy is
//   bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text
// so the bytes are only readable by the owning user, authenticated. A plain public URL
// would 400 forever, and passing the JWT as a header is not an option — React Native's
// <Image> takes a URI, and the native image loaders do not carry our auth. A SIGNED URL is
// the mechanism that fits: Supabase Storage mints a short-lived token-bearing URL, checked
// against the same RLS policy at mint time, that <Image> can then fetch anonymously.
//
// THE PATH IS NEVER CONSTRUCTED CLIENT-SIDE. It is read verbatim from the row the server
// returned. That is deliberate and it is the same lesson as the SSRF fix in 44812c5: a
// client-composed storage path is a request to read an arbitrary object. Here RLS would
// refuse a cross-tenant path anyway — but the honest reason it is safe is that we never
// name a path, we echo one the server already vouched for.
import type { SupabaseClient } from '@supabase/supabase-js';

const CUTOUTS_BUCKET = 'cutouts';

// Long enough that a scroll through a large closet does not re-sign mid-flight, short
// enough that a leaked URL is not a durable capability. Signed URLs are bearer tokens: the
// only thing limiting a leak is expiry.
export const CUTOUT_URL_TTL_SECONDS = 60 * 60;

// Returns null rather than throwing. A missing cutout is NORMAL, not exceptional: a garment
// added before its parse completed has `cutout_path === null`, and a signing failure
// (offline, expired session) should degrade to the placeholder well the grid already draws.
// A thrown error here would take down the whole closet screen over one unrenderable tile.
export async function signCutoutUri(
  client: SupabaseClient,
  cutoutPath: string | null,
): Promise<string | null> {
  if (cutoutPath === null || cutoutPath.length === 0) return null;

  const { data, error } = await client.storage
    .from(CUTOUTS_BUCKET)
    .createSignedUrl(cutoutPath, CUTOUT_URL_TTL_SECONDS);

  // `error` covers both "RLS said no" and "network died"; neither is worth distinguishing
  // to the caller, and neither message may reach the UI (the raw-error PII rule).
  if (error !== null || data === null) return null;
  return data.signedUrl;
}

// Sign a page of rows in one pass. Rows are signed CONCURRENTLY because a 50-item closet
// signing serially would be 50 sequential round-trips before the first tile paints.
// `Promise.all` is safe here specifically because signCutoutUri never rejects.
export async function signCutoutUris(
  client: SupabaseClient,
  rows: readonly { readonly id: string; readonly cutout_path: string | null }[],
): Promise<Readonly<Record<string, string>>> {
  const signed = await Promise.all(
    rows.map(async (row) => [row.id, await signCutoutUri(client, row.cutout_path)] as const),
  );
  // Only successful signings land in the map, so a caller's `uris[id]` being undefined is
  // the single "no image, draw the placeholder" condition — no null-vs-undefined split.
  return Object.fromEntries(signed.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}
