// The hash is DERIVED inside approvePhoto, never accepted. Supplying one is an error,
// so a hash cannot exist for a photo that skipped approval.
//
// `tapped` is supplied so the excess hash property is the ONLY defect: otherwise the
// diagnostic would be the missing tap/verdict and this fixture would stop being evidence that
// the hash is un-supplyable.
import { approvePhoto } from '@closet/shared';
import type { TappedPhoto } from '@closet/shared';

declare const tapped: TappedPhoto;

// `bytes` is NOT passed here any more, and that is load-bearing rather than tidying: while it
// was, the excess-property diagnostic named `bytes` and NOT `source_photo_hash`, so this fixture
// compiled-with-an-error for the wrong reason and the assertion beside it (`error TS`) passed
// vacuously. The supplied hash is now the ONLY defect in the call.
export async function attempt(): Promise<void> {
  await approvePhoto({
    tapped,
    sha256Hex: async () => 'a'.repeat(64),
    source_photo_hash: 'deadbeef'.repeat(8),
  });
}
