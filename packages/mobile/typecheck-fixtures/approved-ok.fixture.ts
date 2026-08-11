// CONTROL fixture: the sanctioned path MUST compile. If this ever fails, the
// "does not compile" fixtures beside it prove nothing.
//
// It mirrors AddGarmentScreen's confirm handler: a TappedPhoto — one the screener passed and
// she then tapped approve on, which is what `approvedPhotos(intake)` yields — goes into the
// minter (which checks the verdict itself), and the SAME digest port goes to both the minter
// and the upload chokepoint's hash re-check.
//
// THE SANCTIONED CALL IS NOW EXACTLY TWO ARGUMENTS: the tap and the digest port. The bytes are
// deliberately NOT among them — they are read out of the tap, because two independent inputs
// let a caller pair a legitimate tap with a foreign photo's bytes, which compiled and which the
// chokepoint's hash re-check could not catch (the key is content-addressed over the foreign
// bytes, so it agreed with itself). This fixture passing `bytes` is what made it stop
// compiling, and a broken CONTROL silently voids every "does not compile" fixture beside it.
import { approvePhoto } from '@closet/shared';
import type { TappedPhoto, Sha256Hex } from '@closet/shared';
import { uploadApprovedPhoto } from '../src/photo/uploadApproved.js';
import type { SupabaseClient } from '@supabase/supabase-js';

declare const client: SupabaseClient;
// The intake's approval-set output and the device digest port. Declared rather than
// constructed: this fixture is about the SHAPE of the sanctioned call, not about producing a
// real hash — and `declare` is the only way to hold a TappedPhoto without an intake, which is
// itself the property the tap brand has.
declare const tapped: TappedPhoto;
declare const sha256Hex: Sha256Hex;

export async function ok(): Promise<void> {
  const photo = await approvePhoto({ tapped, sha256Hex });
  await uploadApprovedPhoto({ client, userId: 'u', photo, sha256Hex });
}
