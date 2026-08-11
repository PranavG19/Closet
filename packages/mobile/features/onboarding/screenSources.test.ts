// WHERE THE SCREEN GETS ITS PHOTOS FROM — a structural check on AddGarmentScreen.tsx itself.
//
// WHY THIS EXISTS AS A SOURCE-TEXT TEST AND NOT A RENDER TEST: intake.ts is proven to exclude
// rejected photos from both `candidates` and `approvedPhotos`, but that proves nothing about
// the screen if the screen renders the PICKER'S OWN RESULT instead of the intake — a two-line
// change that would put an intimate photo on screen while every intake test stayed green. That
// is the gap docs/01:44's first clause lives in, and it cannot be closed by a render test here:
// there is no @testing-library/react-native, no jsdom, and a `.test.tsx` matches no vitest glob
// (it would be silently skipped and look green). It also cannot be closed by a lint rule —
// eslint.config.mjs is cage-locked, eslint-plugin-import is not installed, and there is no CI.
// So it is closed the way chokepoint.test.ts closes its invariant: by reading the file.
//
// It walks the FILESYSTEM rather than using `git grep`, for the reason recorded in this
// project's own notes: git grep only searches TRACKED files, so on a working tree where the
// offending file is new-and-unstaged it reports zero hits and the check passes vacuously.
//
// WHAT THIS ORACLE CANNOT DECIDE, and it is a short list with a sharp edge: IT READS EXACTLY
// ONE FILE. A reviewer defeated the earlier version by putting a `.forEach` upload beside the
// sanctioned loop — inside a file this test does read, but in a shape its patterns did not
// match. Tightening the patterns (as the loop-variable binding below does) narrows that, but
// the structural limits remain:
//
//   - A SECOND SCREEN, or any helper this one delegates to, is not read here at all. The
//     package-wide half of that is chokepoint.test.ts (which walks every file); this file's
//     scope is genuinely just AddGarmentScreen.tsx.
//   - ITERATION HAS MORE SHAPES THAN THE ONES COUNTED. The `for...of` count below does not see
//     `.forEach`, `.map`, `.flatMap`, a `while`, or a recursive walk. It catches the obvious
//     regression, not a determined one.
//   - IT PROVES NOTHING ABOUT RUNTIME. Text saying `approvedPhotos(intake)` is not evidence
//     that the value flowing to the mutation came from there. That is why the real enforcement
//     is the TYPE (an ApprovedPhoto's only constructor is the verdict-checking minter) and why
//     approvePhoto's call-site count lives in chokepoint.test.ts.
//
// It is a tripwire for the plausible accidental regression, not a proof. The invariant's real
// backstops are the branded type and the minter's verdict check.
//
// ALSO OUT OF SCOPE: whether the verdict feeding `admit` is any good (classifier recall — a
// device-ML oracle needing an independent human-curated labeled corpus, human-owned per
// docs/06 §8.3), and whether any of this RENDERS correctly (real-simulator screenshot,
// human-gated per CLAUDE.md rule 3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN_PATH = join(HERE, 'AddGarmentScreen.tsx');
const screenText = readFileSync(SCREEN_PATH, 'utf8');

// Comments are stripped for every assertion below: this file's header explains at length WHY
// the picker result is not rendered, and matching prose would make the check unmaintainable —
// any honest explanatory comment would fail it.
const codeText = screenText
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
  .join('\n');

describe('AddGarmentScreen renders only what the gate admitted', () => {
  it('reads the screen at all (guards against a vacuous pass)', () => {
    // Every assertion below is on this text; if the read silently produced nothing they would
    // all pass for the wrong reason.
    expect(codeText.length).toBeGreaterThan(1000);
    expect(codeText).toContain('AddGarmentScreen');
  });

  it('maps over intake.candidates, and that is the ONLY thing it maps over to build tiles', () => {
    // The grid's data source. `intake.candidates` cannot contain a rejected photo (intake.ts
    // drops them entirely — proven in intake.test.ts).
    expect(codeText).toContain('intake.candidates.map(');
    const mapCalls = codeText.match(/\.map\(/g) ?? [];
    expect(mapCalls.length).toBe(1);
  });

  it('never keeps the raw picker result in state or renders from it', () => {
    // `pickPhotos()` and `screen()` results must flow ONLY into `admit`. A `setPicked(...)` or a
    // `picked.map(...)` would be the two-line change that bypasses the gate.
    expect(codeText).not.toMatch(/picked\s*\.\s*map\s*\(/);
    expect(codeText).not.toMatch(/screened\s*\.\s*map\s*\(/);
    expect(codeText).not.toMatch(/useState[^\n]*picked/i);
    // The one legal destination for the screened batch.
    expect(codeText).toMatch(/admit\(\s*current\s*,\s*screened\s*\)/);
  });

  // The loop that reaches the upload, and the name it binds each approved photo to. Captured
  // rather than hardcoded so the assertions below can tie the MINT to the LOOP VARIABLE — a
  // fixed name like `photo` would only prove the screen happens to use that identifier.
  const uploadLoop = /for\s*\(\s*const\s+(\w+)\s+of\s+approvedPhotos\(intake\)\s*\)/.exec(codeText);

  it('uploads ONLY from approvedPhotos — the only iteration that reaches the mutation', () => {
    // The upload half of docs/01:44. `approvedPhotos` filters the candidates by her tap, so a
    // rejected photo is not reachable from this loop. A `for (const c of intake.candidates)`
    // or `of picked` here would upload photos she never approved.
    expect(uploadLoop).not.toBeNull();
    const forOfLoops = codeText.match(/for\s*\(\s*const\s+\w+\s+of\s+/g) ?? [];
    expect(forOfLoops.length).toBe(1);
  });

  it('mints the branded ApprovedPhoto inside that loop, from the photo it is iterating', () => {
    // approvePhoto() is the sole constructor of the type the upload chokepoint accepts, and it
    // derives the hash FROM THE BYTES INSIDE THE TAP — so the hash a parse request carries
    // provably came from a photo that reached this loop, i.e. one she tapped.
    //
    // THIS ASSERTION CHANGED SHAPE, and the intent is the one that survived. It used to look for
    // `bytes: <loopvar>.screened.photo.bytes`, because the minter took the bytes as a SECOND,
    // independent argument. That argument is gone: a red team paired a legitimate tap with a
    // different photo's bytes and uploaded content she never approved, and the chokepoint's hash
    // re-check could not catch it (content-addressed over the foreign bytes, so it agreed with
    // itself). The bytes now come out of the tap, which makes the mismatch unrepresentable
    // instead of merely detectable — so there is no `bytes:` argument left to anchor, and looking
    // for one would fail on CORRECT code.
    //
    // What must still be true is what this always meant: the screen mints from THE PHOTO IT IS
    // ITERATING. So the anchor moves to the tap argument, and stays tied to the CAPTURED loop
    // variable rather than a hardcoded `candidate` — a fixed name would only prove the screen
    // happens to use that identifier.
    const bound = uploadLoop![1];
    // Scoped to the mint call's own argument list, so a `tapped:` appearing anywhere else in the
    // file cannot satisfy this. Lazy to the first `})` rather than "up to the next paren", so a
    // legitimate parenthesised argument value (`sha256Hex: makeDigest()`) does not make this fail
    // on CORRECT code — a test that breaks when the code is right is worse than no test.
    const mintCall = /approvePhoto\(\{([\s\S]*?)\}\)/.exec(codeText);
    expect(mintCall).not.toBeNull();
    expect(mintCall![1]).toMatch(new RegExp(`tapped:\\s*${bound}\\b`));
    // And NOTHING else photo-shaped travels with it. A re-introduced `bytes:`/`contentType:`
    // argument here is precisely the regression that re-opens the pairing bypass, so it is
    // asserted absent rather than left to review.
    expect(mintCall![1]).not.toMatch(/\bbytes\s*:/);
    expect(mintCall![1]).not.toMatch(/\bcontentType\s*:/);
    expect(codeText).toMatch(/mutateAsync\(\{\s*photo:\s*approved/);
  });

  it('hands the minter the TAPPED photo, so the verdict AND her tap are checked at the mint', () => {
    // approvePhoto now REQUIRES the TappedPhoto — which nests the ScreenedPhoto, so it still
    // throws on any verdict but `candidate` — and the tap brand is minted ONLY by intake.ts's
    // approvedPhotos filter over her approval set. That moved both checks out of this loop's
    // discipline and into the type: the gap a reviewer walked through when the minter took bare
    // bytes, and the later one where a second screen could mint from a photo she never tapped.
    // Passing the loop variable straight through is what makes both travel with the photo; a
    // screen that reached for `.screened` or `.photo` and dropped a level could not compile
    // against the minter.
    const bound = uploadLoop![1];
    expect(codeText).toMatch(new RegExp(`tapped:\\s*${bound}\\b`));
  });

  it('holds NO Storage client and names NO bucket — the chokepoint stays singular', () => {
    // src/photo/uploadApproved.ts is the only file in packages/mobile allowed to write bytes
    // (chokepoint.test.ts enforces it across the package; this is the same rule asserted at the
    // one screen most tempted to break it).
    expect(codeText).not.toContain('originals');
    expect(codeText).not.toMatch(/storage\s*\.\s*from/);
    expect(codeText).not.toContain('getSupabase');
  });

  it('never names source_photo_path — the 44812c5 defect', () => {
    // The server derives the path from the verified JWT sub. A client that names one is a
    // cross-tenant read and an SSRF sink no DB policy can stop, because a vendor performs the
    // fetch.
    expect(codeText).not.toContain('source_photo_path');
  });

  it('renders the set-aside count but never a set-aside photo', () => {
    // "Privacy is a visible feature, not fine print" (docs/01:138) — so the count is shown. It is
    // a NUMBER: the intake model holds no reference to the photos it dropped, so there is nothing
    // else this could render.
    expect(codeText).toContain('setAsideCount(intake)');
    expect(codeText).toMatch(/set aside/);
  });

  it('renders privacy copy from privacyPromise(), never a hardcoded on-device claim', () => {
    // The copy is a pure function of whether a screener actually runs, so the blocked
    // "screened on your device" claim (app-store-listing.md:233) cannot be typed into the screen
    // by hand.
    expect(codeText).toContain('privacyPromise(intakePort.screeningAvailable)');
    expect(codeText.toLowerCase()).not.toContain('we check your photos');
    expect(codeText.toLowerCase()).not.toContain('screened on your device');
  });

  it('renders no color literal — tokens only', () => {
    // There is no no-literal-colors CI gate in this repo (verified: scripts/gates/ has four
    // scripts and none of them is one), so the rule is held here for this screen.
    expect(codeText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(codeText).not.toMatch(/\brgba?\(/);
  });
});
