// Photoroom background-removal adapter → CutoutPort. Calls Photoroom's segment
// (remove-background) API, then hands the returned cutout bytes to an INJECTED
// storage-writer that persists them and reports the stored path + dimensions. The
// resulting {imageUrl,hasAlpha,width,height} crosses the boundary through
// parseBoundary(CutoutResultSchema) — a bad/partial result (e.g. non-positive
// dimension) becomes a BoundaryParseError, never untyped data into the domain.
//
// The writer receives the identity SCOPE alongside the bytes so it can compose the
// RLS-satisfying path {user_id}/{parse_job_id}/cutout.png (migration 0013 binds path
// segment 1 to auth.uid()). The scope crosses the port on CutoutInput — see the WHY
// note on CutoutInput. The default writer still THROWS so a build that forgot to
// wire storage surfaces as a clean 502 rather than a fabricated cutout; the real
// writer is makeSupabaseStorageWriter (supabase-storage.writer.ts). No bucket URL is
// hardcoded in THIS file — the vendor call and the byte-persistence stay separable.
import { parseBoundary, CutoutResultSchema, type CutoutPort, type CutoutResult, type CutoutInput } from '@closet/shared';
import { requireEnv, envValue } from '../auth/env.js';
import {
  requestWithRetry,
  resolveTransportDeps,
  ProviderRequestError,
  type TransportDeps,
} from './http.js';

const DEFAULT_BASE_URL = 'https://sdk.photoroom.com/v1';

// What the deploy-wired storage step must return: where the cutout now lives plus
// the properties the domain needs. Kept unknown-until-validated at the boundary.
export interface StoredCutout {
  readonly imageUrl: string;
  readonly hasAlpha: boolean;
  readonly width: number;
  readonly height: number;
}

// The cutout Photoroom returned, ready to persist. `contentType` documents the
// alpha guarantee (a removed-background PNG is alpha-composited by definition).
export interface CutoutBytes {
  readonly bytes: ArrayBuffer;
  readonly contentType: string | null;
}

// The identity scope the path is composed from. Structurally a subset of CutoutInput
// so the adapter forwards it without re-deriving (or inventing) either field.
export type CutoutScope = Pick<CutoutInput, 'userId' | 'parseJobId'>;

export type CutoutStorageWriter = (cutout: CutoutBytes, scope: CutoutScope) => Promise<StoredCutout>;

// Default = unwired. A build with no storage writer throws clearly and parse-photo
// turns it into the req-9 502 (never a fake result).
function unwiredStorageWriter(): Promise<StoredCutout> {
  throw new Error('photoroom cutout storage-writer is not wired in this build');
}

export interface PhotoroomCutoutDeps extends Partial<TransportDeps> {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly storeCutout?: CutoutStorageWriter;
}

export function makePhotoroomCutoutAdapter(deps?: PhotoroomCutoutDeps): CutoutPort {
  const transport = resolveTransportDeps(deps);
  const baseUrl = deps?.baseUrl ?? envValue('PHOTOROOM_BASE_URL') ?? DEFAULT_BASE_URL;
  const storeCutout = deps?.storeCutout ?? unwiredStorageWriter;

  return {
    async removeBackground(input: CutoutInput): Promise<CutoutResult> {
      const apiKey = deps?.apiKey ?? requireEnv('PHOTOROOM_API_KEY');
      // Photoroom's segment API accepts a source image URL and returns cutout bytes.
      const params = new URLSearchParams({ image_url: input.imageUrl, format: 'png' });

      // The byte read is passed INTO requestWithRetry so it runs inside the per-call
      // timeout — a vendor that sends headers then stalls the body must not hang the
      // parse (http.ts). The content-type is read in the same callback because it is
      // only meaningful alongside the bytes it describes.
      const { contentType, bytes } = await requestWithRetry(
        `${baseUrl}/segment`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            accept: 'image/png, application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
        transport,
        async (response) => ({
          contentType: response.headers.get('content-type'),
          bytes: await response.arrayBuffer(),
        }),
      );

      if (bytes.byteLength === 0) {
        throw new ProviderRequestError('empty cutout response');
      }

      const stored = await storeCutout(
        { bytes, contentType },
        { userId: input.userId, parseJobId: input.parseJobId },
      );
      // Boundary: a bad/partial stored cutout → BoundaryParseError, never coerced.
      return parseBoundary(CutoutResultSchema, stored, 'photoroom-cutout.result');
    },
  };
}
