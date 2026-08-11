// THE MINTER REFUSES A PHOTO THAT WAS NEVER SCREENED — the fixture for the gap a reviewer
// actually walked through.
//
// The earlier signature took bare bytes, so `approvePhoto` meant "somebody called the
// minter". A module could hand it EVERY picked photo, approved or not, and it compiled: the
// verdict lived nowhere in the type, so the check was every caller's discipline. Requiring a
// screened photo moves the check into the one function that can mint — and this fixture is the
// compile-time evidence that a bare PickedPhoto (a picker result with no verdict attached)
// cannot get there.
//
// Everything else in the call is correct, so the missing verdict is the ONLY defect.
import { approvePhoto, tapApproved } from '@closet/shared';
import type { PickedPhoto, Sha256Hex } from '@closet/shared';

// Straight off PhotoIntakePort.pickPhotos() — screening has not run on it.
declare const picked: PickedPhoto;
declare const sha256Hex: Sha256Hex;

// The bypass spelled the way someone holding a picker result would actually write it: shove
// the PickedPhoto in where a screened photo belongs. It goes through the REAL tapApproved,
// which is the sharper version of this fixture — even the sanctioned tap minter cannot accept
// an unscreened photo, so there is no "tap it first and screen it later" order. tsc names the
// missing `verdict`, which is the strongest available evidence that it is the VERDICT — not
// merely an argument count — that refused this.
export async function attempt(): Promise<void> {
  await approvePhoto({
    tapped: tapApproved(picked),
    sha256Hex,
  });
}

// And omitting the photo altogether is refused too — the minter has no "unscreened,
// untapped" mode to fall back to. `tapped` is the ONLY thing missing here, so the diagnostic
// names it: previously this call also passed `bytes`, whose excess-property error fired FIRST
// and masked the missing tap entirely.
export async function attemptOmitted(): Promise<void> {
  await approvePhoto({
    sha256Hex,
  });
}
