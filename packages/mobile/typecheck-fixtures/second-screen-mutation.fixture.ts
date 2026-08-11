// A SECOND SCREEN CANNOT BUILD THE MUTATION'S VARIABLES — the barrel is not a way in.
//
// `useAddGarment` and `AddGarmentVariables` are both exported from the src/photo barrel, which
// is deliberate (AddGarmentScreen imports them from there) and was also the shape of a real
// bypass: a reviewer pointed out that any second screen could import the hook and drive the
// upload+parse mutation itself, never rendering the approval grid. What stops it is that
// `AddGarmentVariables.photo` is an `ApprovedPhoto`, whose brand is an unexported
// `unique symbol` — so the hook is reachable and its ARGUMENT is not constructible.
//
// This fixture is the compile-time evidence for the barrel route specifically: import the hook,
// then try to hand it a photo built by hand. Both defects are asserted at once, in the two
// places a second screen would actually try:
//
//   1. a hand-written ApprovedPhoto literal in the variables  -> missing [APPROVED]
//   2. a hand-written tap fed to the real minter              -> missing [TAPPED]
//
// WHAT THIS FIXTURE DOES NOT COVER, because it is not true: a second screen that deep-imports
// `features/onboarding/intake.js` and calls `toggleApproval` in code DOES compile, and that is
// recorded as an open finding in src/photo/chokepoint.test.ts rather than papered over here. The
// tap brand proves a value came through `approvedPhotos`; it cannot prove a human produced the
// tap that put the id in the approval set.
import { useAddGarment, type AddGarmentVariables } from '../src/photo/index.js';
import * as shared from '@closet/shared';
import type { PickedPhoto, Sha256Hex } from '@closet/shared';

declare const picked: PickedPhoto;
declare const sha256Hex: Sha256Hex;

// Aliased for the same reason the other forgery fixtures alias it: the TYPE must refuse this
// with no source-text call-site check able to see it.
const mint = shared.approvePhoto;

// ROUTE 1 — skip the minter entirely and hand the mutation a structurally-perfect photo.
export function forgeVariables(): AddGarmentVariables {
  return {
    photo: {
      source_photo_hash: 'a'.repeat(64),
      bytes: picked.bytes,
      contentType: 'image/jpeg',
    },
    kind: 'teaser',
  };
}

// ROUTE 2 — use the real minter, but forge her tap. The screening is genuine; only the consent
// is asserted by this code, which is exactly the second screen's position.
export async function driveMutation(): Promise<void> {
  const add = useAddGarment('u', sha256Hex);
  const screened = shared.screenPhoto(picked, 'candidate');
  const photo = await mint({
    tapped: { screened },
    sha256Hex,
  });
  await add.mutateAsync({ photo, kind: 'teaser' });
}
