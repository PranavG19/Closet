// The REAL cutout storage-writer: uploads Photoroom's cutout bytes to the PRIVATE
// `cutouts` bucket and reports the stored path + true dimensions. This is the piece
// that was missing, so every real parse failed at the cutout call (502).
//
// IDENTITY — the whole point of this file. Migration 0013's policy on the bucket is
//   bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text
// so the upload MUST run as the OWNING user. We therefore send the CALLER'S OWN
// access token as the bearer, which makes Storage resolve auth.uid() to that user
// and evaluate the policy for real. We deliberately do NOT use service_role here:
// service_role bypasses RLS, so it would upload successfully even for a path in
// ANOTHER tenant's prefix — voiding the single control 0013 exists to establish and
// turning a path-composition bug into a silent cross-user write. Fail-closed under
// the user's token is strictly better than succeed-blindly under a bypass. (docs/06
// §6: "parse-photo reads the original and writes the cutout as app_user, never
// service_role"; §5: bytes never transit Edge as domain objects.)
//
// The `apikey` header is the project's PUBLIC anon key — it identifies the project
// to the API gateway and grants nothing on its own; the bearer JWT is what carries
// authority. Neither it nor any vendor body is ever logged.
import { requireEnv } from '../auth/env.js';
import {
  requestWithRetry,
  resolveTransportDeps,
  ProviderRequestError,
  type TransportDeps,
} from './http.js';
import type { CutoutScope, CutoutBytes, CutoutStorageWriter, StoredCutout } from './photoroom-cutout.adapter.js';

// Private bucket from migration 0013. Not configurable: the bucket name is half of
// the RLS predicate, so an env-swappable bucket could silently land bytes in a
// bucket with no policy at all.
const CUTOUTS_BUCKET = 'cutouts';

// The object name within the bucket. Segment 1 MUST be the owner (see above); the
// job id scopes a re-parse of the same photo to its own object.
export function cutoutObjectPath(scope: CutoutScope): string {
  return `${scope.userId}/${scope.parseJobId}/cutout.png`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
// signature(8) + chunk length(4) + "IHDR"(4) + width(4) + height(4) + depth(1) + colorType(1)
const IHDR_MIN_BYTES = 26;
// PNG colour types that carry a real alpha channel: 4 = grey+alpha, 6 = RGBA.
const ALPHA_COLOR_TYPES = new Set([4, 6]);

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

// Decode dimensions + the alpha guarantee from the PNG's own IHDR chunk. We read
// these from the BYTES rather than assuming them: `hasAlpha: true` asserted blindly
// would be a fabricated guarantee, and a cutout without an alpha channel is not a
// cutout. Returns null for anything that is not a well-formed PNG so the caller
// fails closed instead of storing garbage under a valid-looking path.
function decodePngHeader(bytes: ArrayBuffer): PngHeader | null {
  if (bytes.byteLength < IHDR_MIN_BYTES) return null;
  const view = new DataView(bytes);
  for (const [index, expected] of PNG_SIGNATURE.entries()) {
    if (view.getUint8(index) !== expected) return null;
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height, hasAlpha: ALPHA_COLOR_TYPES.has(view.getUint8(25)) };
}

export interface SupabaseStorageWriterDeps extends Partial<TransportDeps> {
  // The CALLER'S verified access token. Required — there is no service_role fallback
  // by design (a fallback would bypass the very policy this upload must satisfy).
  readonly accessToken: string;
  readonly supabaseUrl?: string;
  readonly anonKey?: string;
}

// Build a writer bound to ONE caller's token, so it can only ever write where that
// caller's own RLS policy permits.
export function makeSupabaseStorageWriter(deps: SupabaseStorageWriterDeps): CutoutStorageWriter {
  const transport = resolveTransportDeps(deps);

  return async function storeCutout(cutout: CutoutBytes, scope: CutoutScope): Promise<StoredCutout> {
    const supabaseUrl = deps.supabaseUrl ?? requireEnv('SUPABASE_URL');
    const anonKey = deps.anonKey ?? requireEnv('SUPABASE_ANON_KEY');

    const header = decodePngHeader(cutout.bytes);
    if (header === null) {
      // Fail closed BEFORE the upload: never persist bytes we cannot vouch for.
      throw new ProviderRequestError('cutout bytes are not a decodable png');
    }
    if (!header.hasAlpha) {
      throw new ProviderRequestError('cutout png carries no alpha channel');
    }

    const objectPath = cutoutObjectPath(scope);
    // The drain is passed INTO requestWithRetry so it runs inside the per-call timeout
    // (http.ts): Storage acking the headers and then stalling the response body must
    // not hang the parse with the job row stuck at 'processing'.
    await requestWithRetry(
      `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${CUTOUTS_BUCKET}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.accessToken}`,
          apikey: anonKey,
          'content-type': cutout.contentType ?? 'image/png',
          // A re-parse of the same photo (claim permits retrying a failed job) must
          // overwrite its OWN object rather than 409 forever. The owner's UPDATE
          // policy on this bucket is what permits it.
          'x-upsert': 'true',
        },
        body: cutout.bytes,
      },
      transport,
      // Drain the body so the connection is not left pending; the payload is vendor
      // metadata we neither trust nor log — the path we composed is the return value.
      (response) => response.arrayBuffer(),
    );

    return { imageUrl: objectPath, hasAlpha: header.hasAlpha, width: header.width, height: header.height };
  };
}
