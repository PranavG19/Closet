// Photoroom background-removal adapter → CutoutPort. Calls Photoroom's segment
// (remove-background) API, then hands the returned cutout bytes to an INJECTED
// storage-writer that persists them and reports the stored path + dimensions. The
// resulting {imageUrl,hasAlpha,width,height} crosses the boundary through
// parseBoundary(CutoutResultSchema) — a bad/partial result (e.g. non-positive
// dimension) becomes a BoundaryParseError, never untyped data into the domain.
//
// DEPLOY-WIRING SEAM (docs/06 §5): docs say parse-photo writes the cutout to
// Storage at {user_id}/{parse_job_id}/... That path is composed from identity the
// CutoutInput deliberately does NOT carry (only imageUrl crosses the port), so the
// actual byte-upload + path composition + image-dimension decode is a deploy-wired
// concern behind `storeCutout`. The default writer THROWS (like the old
// unwiredPorts) so an unconfigured deploy surfaces as a clean 502 rather than a
// fabricated cutout — the real writer (Supabase Storage bucket via a repo/storage
// seam) is supplied at deploy time. No bucket URL is hardcoded here.
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

export type CutoutStorageWriter = (cutout: CutoutBytes) => Promise<StoredCutout>;

// Default = unwired. Deploy supplies the real writer; until then a cutout attempt
// throws clearly and parse-photo turns it into the req-9 502 (never a fake result).
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

      const response = await requestWithRetry(
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
      );

      const contentType = response.headers.get('content-type');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0) {
        throw new ProviderRequestError('empty cutout response');
      }

      const stored = await storeCutout({ bytes, contentType });
      // Boundary: a bad/partial stored cutout → BoundaryParseError, never coerced.
      return parseBoundary(CutoutResultSchema, stored, 'photoroom-cutout.result');
    },
  };
}
