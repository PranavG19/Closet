// A structurally-identical object literal must NOT be accepted as an ApprovedPhoto.
//
// EVERY OTHER FIELD IS CORRECT ON PURPOSE — `sha256Hex` is supplied so the missing brand is
// the ONLY defect in this call. Without that, the diagnostic below could be the
// missing-digest-port error and this fixture would no longer be evidence about nominality.
import { uploadApprovedPhoto } from '../src/photo/uploadApproved.js';
import type { Sha256Hex } from '@closet/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

declare const client: SupabaseClient;
declare const sha256Hex: Sha256Hex;

export async function attempt(bytes: ArrayBuffer): Promise<void> {
  const notApproved = {
    source_photo_hash: 'a'.repeat(64),
    bytes,
    contentType: 'image/jpeg',
  };
  await uploadApprovedPhoto({ client, userId: 'u', photo: notApproved, sha256Hex });
}
