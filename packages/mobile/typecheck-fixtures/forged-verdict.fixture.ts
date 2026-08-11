// A FABRICATED VERDICT CANNOT BE MINTED — the fixture for the bypass that survived the first
// fix, found by an adversarial reviewer re-testing after the repair.
//
// Requiring `screened: ScreenedPhoto` on approvePhoto was not enough on its own. ScreenedPhoto
// was a bare structural interface, so the reviewer wrote `{ photo, verdict: 'candidate' }` as
// an object literal and minted a brand from a photo no screener had ever looked at — aliasing
// the minter (`const mint = shared.approvePhoto`) to slip the source-text call-site check too.
// tsc exit 0, whole suite green, ZERO casts. The verdict requirement had only moved the forgery
// one level out.
//
// The fix was to brand ScreenedPhoto with its own module-private `unique symbol`, so the only
// way to obtain one is screenPhoto(). This fixture is the compile-time evidence: the chain is
// now screener -> verdict -> approval -> upload with no structural shortcut into the middle.
//
// The alias is kept deliberately. It is what defeats the source-text oracles, so this fixture
// must prove the TYPE refuses the forgery even when no regex can see the call.
import * as shared from '@closet/shared';
import type { PickedPhoto, Sha256Hex } from '@closet/shared';

declare const picked: PickedPhoto;
declare const sha256Hex: Sha256Hex;

// Aliased so `/\bapprovePhoto\s*\(/` never matches — the type must carry this alone.
const mint = shared.approvePhoto;

export async function attempt(): Promise<void> {
  await mint({
    // The forgery, now spelled through the tap slot the minter actually takes: BOTH links
    // written by hand, so this is the strongest form of the original bypass — a verdict this
    // code simply asserts, wrapped in a tap this code simply asserts. tsc stops at the inner
    // one and names the unexported SCREENED brand, because there is no way to write it.
    tapped: { screened: { photo: picked, verdict: 'candidate' } },
    sha256Hex,
  });
}
