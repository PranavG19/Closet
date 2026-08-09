// The ORIGINAL-photo read seam: derives the storage key for an approved original and
// mints the SHORT-LIVED signed URL the paid providers fetch it from. This is the
// counterpart to supabase-storage.writer.ts (which writes the cutout), and it exists
// for the same reason: the storage path is a SECURITY BOUNDARY, not a naming detail.
//
// WHY THIS FILE EXISTS AT ALL. GPT-4o and Photoroom do not receive image bytes from
// us — they receive a URL and their OWN servers perform the fetch. So migration
// 0013's Storage RLS cannot protect the original: 0013 governs who may touch
// `storage.objects` as app_user/authenticated, and a vendor fetching a URL we handed
// it is neither. Anything a caller can name in a request body therefore becomes (a) a
// cross-tenant photo read, (b) an SSRF sink, and (c) unbounded spend on a URL of the
// attacker's choosing. The only structural fix is that a caller cannot name it: the
// key is DERIVED from the verified JWT `sub`, and the URL is composed here.
//
// Two independent controls, deliberately not one:
//   1. sourcePhotoObjectKey composes `{user_id}/{source_photo_hash}/original` from the
//      verified sub. `source_photo_path` is absent from CreateParseJobRequest, so
//      there is no client string to launder.
//   2. This reader is BOUND to one caller's id and REFUSES any key whose first
//      segment is not that id, re-validating it as a StorageObjectKey. It is the last
//      hop before a vendor-fetchable URL exists, so the check sits where it cannot be
//      bypassed by any future caller of the port — including one that reintroduces a
//      body-sourced path. The `{job_id}/{user_id}`-inversion class of bug fails
//      CLOSED here rather than resolving to another tenant's object.
//
// Authority is the CALLER'S own token, never service_role: signing runs through the
// same 0013 policy the upload did, so a key outside the caller's prefix is refused by
// the database rather than blessed by a bypass. Neither the token, the anon key, nor
// any vendor body is ever logged.
import { StorageObjectKey, parseBoundary } from '@closet/shared';
import { z } from 'zod';
import { requireEnv } from '../auth/env.js';
import {
  requestWithRetry,
  resolveTransportDeps,
  ProviderRequestError,
  type TransportDeps,
} from './http.js';

// Private bucket from migration 0013. Not configurable, for the same reason the
// cutouts bucket is not: the bucket name is half of the RLS predicate.
const ORIGINALS_BUCKET = 'originals';

// How long the vendor has to fetch the original. Long enough for a retried provider
// call, short enough that a leaked URL is worthless quickly.
const SIGNED_URL_TTL_SECONDS = 300;

export interface SourcePhotoScope {
  readonly userId: string;
  readonly sourcePhotoHash: string;
}

// The object key for an approved original. Segment 1 MUST be the owner (0013's
// predicate); the per-photo hash scopes one photo to one object, so a re-parse of the
// same photo resolves to the same key. `original` carries no extension: the content
// type travels as object metadata, and an extension would be one more client-shaped
// string in a security-relevant name.
export function sourcePhotoObjectKey(scope: SourcePhotoScope): string {
  return `${scope.userId}/${scope.sourcePhotoHash}/original`;
}

// Supabase's sign response. Parsed at the boundary — a vendor payload that is not
// this shape yields a BoundaryParseError, never a fabricated URL.
const SignResponse = z.object({ signedURL: z.string() });

// Mints the URL a paid provider will fetch the original from. Returns an absolute
// https URL composed HERE from our own base; the vendor never sees a client string.
export type SourcePhotoUrlMinter = (objectKey: string) => Promise<string>;

export interface SupabaseStorageReaderDeps extends Partial<TransportDeps> {
  // The CALLER'S verified access token. Required — no service_role fallback by
  // design (it would bypass the policy this read must satisfy).
  readonly accessToken: string;
  // The verified JWT `sub`. The reader refuses any key not under this prefix.
  readonly userId: string;
  readonly supabaseUrl?: string;
  readonly anonKey?: string;
  readonly ttlSeconds?: number;
}

// Build a minter bound to ONE caller, so it can only ever mint a URL for an object
// that caller's own RLS policy permits.
export function makeSupabaseSignedUrlReader(deps: SupabaseStorageReaderDeps): SourcePhotoUrlMinter {
  const transport = resolveTransportDeps(deps);

  return async function mintSourcePhotoUrl(objectKey: string): Promise<string> {
    // Control 2, before anything leaves the process. parseBoundary rejects a URL, a
    // traversal, a leading slash, a backslash, and an over-long value; the segment
    // check then pins the object to this caller.
    const key = parseBoundary(StorageObjectKey, objectKey, 'storage.originals.key');
    if (key.split('/')[0] !== deps.userId) {
      throw new ProviderRequestError('source photo key is outside the caller prefix');
    }

    const supabaseUrl = (deps.supabaseUrl ?? requireEnv('SUPABASE_URL')).replace(/\/+$/, '');
    const anonKey = deps.anonKey ?? requireEnv('SUPABASE_ANON_KEY');

    // The body read runs inside the per-call timeout (http.ts) — Storage sending
    // headers then stalling must not hang the parse.
    const vendorBody: unknown = await requestWithRetry(
      `${supabaseUrl}/storage/v1/object/sign/${ORIGINALS_BUCKET}/${key}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.accessToken}`,
          apikey: anonKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: deps.ttlSeconds ?? SIGNED_URL_TTL_SECONDS }),
      },
      transport,
      (response) => response.json(),
    );

    const { signedURL } = parseBoundary(SignResponse, vendorBody, 'storage.sign.result');
    // Supabase returns a path relative to /storage/v1. Anything else (notably an
    // absolute URL to a host we did not choose) fails CLOSED rather than becoming the
    // URL we hand a vendor — that would reintroduce the SSRF this file prevents.
    if (!signedURL.startsWith('/')) {
      throw new ProviderRequestError('signed url is not a storage-relative path');
    }
    return `${supabaseUrl}/storage/v1${signedURL}`;
  };
}
