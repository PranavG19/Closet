// A FORGED APPROVAL TAP CANNOT BE MINTED — the fixture for the bypass that survived the
// SECOND fix, and the sharpest one yet because everything about it is legitimate except her
// consent.
//
// Branding ScreenedPhoto closed the forged-verdict hole (see forged-verdict.fixture.ts): after
// it, a verdict could no longer be written by hand. But a screened photo is the SCREENER'S
// opinion, not HER decision, and nothing in the type carried the difference — so a second
// screen could import useAddGarment from the src/photo barrel, screen a photo legitimately,
// and upload it though she had never tapped approve on it. docs/06 §2 is explicit that her tap
// (not the classifier) is the structural guarantee, so that gap was the invariant failing while
// every test stayed green.
//
// The fix was a SECOND unexported `unique symbol` — TAPPED — minted only by tapApproved(),
// which features/onboarding/intake.ts calls for exactly the photos in her approval set. This
// fixture is the compile-time evidence: `screenPhoto` here is REAL (no forgery at that level,
// which is the point — the screening is genuine and it still is not enough), and only the tap
// is hand-written. tsc names the missing brand.
//
// The alias is kept for the same reason forged-verdict.fixture.ts keeps it: it is what defeats
// the source-text oracles in chokepoint.test.ts and screenSources.test.ts, so this fixture must
// prove the TYPE refuses the forgery with no regex able to see the call.
import * as shared from '@closet/shared';
import type { PickedPhoto, Sha256Hex } from '@closet/shared';

declare const picked: PickedPhoto;
declare const sha256Hex: Sha256Hex;

// Aliased so `/\bapprovePhoto\s*\(/` never matches — the type must carry this alone.
const mint = shared.approvePhoto;

export async function attempt(): Promise<void> {
  // LEGITIMATELY screened. This half is not a forgery: a real screener verdict, minted by the
  // real screenPhoto, carrying the real SCREENED brand.
  const screened = shared.screenPhoto(picked, 'candidate');

  await mint({
    // THE FORGERY, and the only defect in this call: a tap this code simply asserts by wrapping
    // a genuinely-screened photo in the shape TappedPhoto has. It is structurally perfect and
    // missing the unexported TAPPED brand, which is precisely "she never tapped it".
    tapped: { screened },
    sha256Hex,
  });
}
