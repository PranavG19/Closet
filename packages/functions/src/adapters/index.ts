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
import type { ParsePorts, PortsRequestContext } from '../parse/parse-photo.js';
import { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
import { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';
import { makeSupabaseStorageWriter } from './supabase-storage.writer.js';

export function makeProviderPorts({ accessToken }: PortsRequestContext): ParsePorts {
  return {
    vision: makeOpenAIVisionAdapter(),
    cutout: makePhotoroomCutoutAdapter({
      storeCutout: makeSupabaseStorageWriter({ accessToken }),
    }),
  };
}

export { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
export { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';
export { makeSupabaseStorageWriter, cutoutObjectPath } from './supabase-storage.writer.js';
