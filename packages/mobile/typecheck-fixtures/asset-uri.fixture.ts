// What a camera-roll picker actually hands you: a URI. It must not reach the upload.
//
// `sha256Hex` is supplied so the unapproved photo is the ONLY defect here.
import { uploadApprovedPhoto } from '../src/photo/uploadApproved.js';
import type { Sha256Hex } from '@closet/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

declare const client: SupabaseClient;
declare const sha256Hex: Sha256Hex;

export async function attempt(): Promise<void> {
  const asset = { uri: 'file:///var/mobile/Media/DCIM/IMG_0001.HEIC' };
  await uploadApprovedPhoto({ client, userId: 'u', photo: asset, sha256Hex });
}
