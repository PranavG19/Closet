// Production port provider for parse-photo. Builds the REAL GPT-4o + Photoroom
// adapters. Keys are read via requireEnv INSIDE each adapter's per-call path, so
// makeProviderPorts() itself is cheap and the "missing key" failure surfaces on the
// first provider call as a throw → the req-9 502 path (exactly like the old
// unwiredPorts, but real when configured).
//
// The Photoroom adapter's storage-writer is left as its default (unwired) here: the
// real Supabase Storage byte-upload is a deploy-wiring step (see the adapter's
// DEPLOY-WIRING SEAM note). Deploy supplies a configured makePhotoroomCutoutAdapter
// with a real `storeCutout` when the bucket + Storage seam land.
import type { ParsePorts } from '../parse/parse-photo.js';
import { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
import { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';

export function makeProviderPorts(): ParsePorts {
  return {
    vision: makeOpenAIVisionAdapter(),
    cutout: makePhotoroomCutoutAdapter(),
  };
}

export { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
export { makePhotoroomCutoutAdapter } from './photoroom-cutout.adapter.js';
