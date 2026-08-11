// THE CHOKEPOINT REFUSES AN UPLOAD IT CANNOT HASH-CHECK.
//
// The brand is erased at runtime, so `uploadApprovedPhoto` re-derives the digest from the
// bytes and refuses any photo whose bytes do not hash to its own key (PhotoHashMismatch).
// A reviewer laundered foreign bytes into a legitimately-minted ApprovedPhoto with a plain
// object spread — no cast, compiled clean, passed every test — and that runtime re-check is
// the only thing that catches it. Making `sha256Hex` REQUIRED is what stops the backstop
// from being silently skippable: an optional port would let a caller omit it and get the
// old, unchecked behaviour back with no diagnostic.
//
// So the photo here is a genuinely-approved one and the digest port is the only thing
// missing — this fixture fails to compile for exactly one reason.
import { uploadApprovedPhoto } from '../src/photo/uploadApproved.js';
import type { ApprovedPhoto } from '@closet/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

declare const client: SupabaseClient;
// Legitimately minted (only approvePhoto can produce this type at all).
declare const photo: ApprovedPhoto;

export async function attempt(): Promise<void> {
  await uploadApprovedPhoto({ client, userId: 'u', photo });
}
