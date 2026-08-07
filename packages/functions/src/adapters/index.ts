// Production port provider for parse-photo. Builds the REAL GPT-4o + Photoroom
// adapters, with the Photoroom adapter wired to the REAL Supabase Storage writer.
// Keys are read via requireEnv INSIDE each adapter's per-call path, so
// makeProviderPorts() itself is cheap and the "missing key" failure surfaces on the
// first provider call as a throw → the req-9 502 path.
//
// The storage writer is bound to THIS REQUEST'S caller token, which is why the
// provider takes a per-request context instead of being a constant: the cutout upload
// must run as the owning user so migration 0013's `auth.uid()` predicate is really
// evaluated (service_role would bypass it — see supabase-storage.writer.ts).
// The URL minter is bound to the same caller for the same reason: the ORIGINAL is
// read by the VENDOR's servers from a URL we hand over, which is outside 0013's reach
// entirely, so that URL must be minted here for one object this caller owns — never a
// string that came from the request body.
import type { ParsePorts, PortsRequestContext } from '../parse/parse-photo.js';
import { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
import { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';
import { makeSupabaseStorageWriter } from './supabase-storage.writer.js';
import { makeSupabaseSignedUrlReader } from './supabase-storage.reader.js';

export function makeProviderPorts({ accessToken, userId }: PortsRequestContext): ParsePorts {
  return {
    vision: makeOpenAIVisionAdapter(),
    cutout: makePhotoroomCutoutAdapter({
      storeCutout: makeSupabaseStorageWriter({ accessToken }),
    }),
    mintSourcePhotoUrl: makeSupabaseSignedUrlReader({ accessToken, userId }),
  };
}

export { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
export { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';
export { makeSupabaseStorageWriter, cutoutObjectPath } from './supabase-storage.writer.js';
export {
  makeSupabaseSignedUrlReader,
  sourcePhotoObjectKey,
  type SourcePhotoScope,
  type SourcePhotoUrlMinter,
} from './supabase-storage.reader.js';
