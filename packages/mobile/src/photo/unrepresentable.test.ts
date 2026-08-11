// THE TYPE-LEVEL ORACLE: an unapproved photo has no representable upload path.
//
// This is the one assertion that makes the privacy invariant STRUCTURAL rather than a
// convention. Nothing server-side can enforce it (Storage RLS permits any object under
// the caller's own prefix; there is no approval token in any migration), and a runtime
// test that merely checks "the code calls the gate first" is a mirror oracle — it passes
// on code that also has a second, ungated upload path.
//
// WHY IT SPAWNS tsc INSTEAD OF USING @ts-expect-error. packages/mobile/tsconfig.json
// EXCLUDES `src/**/*.test.ts`, so `tsc --build` never typechecks this file. I verified
// that empirically: a test file containing an unsatisfied `@ts-expect-error` (which is
// itself error TS2578) produced ZERO diagnostics and `tsc --build` exited 0. So an
// inline `@ts-expect-error` here would assert NOTHING — it would be a comment. The only
// way to get a real compile-error signal is to compile a fixture in a child process and
// read the diagnostic, which is what this does.
//
// WHERE THE FIXTURES LIVE, AND WHY IT IS NOT src/. Three of them are SUPPOSED to fail to
// compile. packages/mobile/tsconfig.json includes `src/**/*.ts` and excludes only
// `*.test.ts`, so a fixture under src/ would be compiled by `pnpm -w exec tsc --build` and
// would break the repo's typecheck (I hit exactly that: three errors, all of them the
// intended ones). The fix is NOT to add an exclude to tsconfig.json — that file is
// cage-locked, and editing a gate config in the same diff as the code it unblocks is
// auto-rejected. So they live in packages/mobile/typecheck-fixtures/, outside every
// tsconfig include and every vitest glob, and are compiled ONLY by the child process below.
//
// OUT OF SCOPE: classifier recall. This proves the SHAPE of the seam (only an approved
// photo can be uploaded at all), never that the thing she approved was correctly
// screened — that needs a labeled on-device corpus and is human-owned (docs/06 §8.3).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Each case spawns a real tsc, which costs ~0.6s alone but several seconds when the whole
// unit project runs in parallel and the CPU is saturated. Vitest's 5s default made this
// suite flake (it timed out in a full run while passing in isolation), so the budget is
// explicit. This is a slow-but-honest oracle: there is no way to observe a COMPILE error
// from inside a process that already compiled.
const TYPECHECK_TIMEOUT_MS = 60_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const TSC = join(REPO_ROOT, 'node_modules/.bin/tsc');
const FIXTURES = resolve(HERE, '../../typecheck-fixtures');

// Compile ONE fixture in isolation and return its diagnostics. The flags mirror
// tsconfig.base.json (strict, NodeNext) plus packages/mobile/tsconfig.json's `jsx` —
// the fixture must be judged under the same rules the real build uses.
//
// `--jsx react-jsx` is not cosmetic: a fixture that imports the src/photo BARREL pulls in
// PhotoIntakeProvider.tsx and ApiProvider.tsx transitively, and without the flag tsc emits
// TS6142 ("--jsx is not set") for those files. That would make a "does not compile" fixture
// exit non-zero for a reason that has nothing to do with the brand it is testing — a false
// green. I verified every other fixture in this directory produces byte-identical
// diagnostics with the flag on, so it strengthens the oracle rather than moving it.
function typecheck(fixture: string): { readonly code: number; readonly output: string } {
  const result = spawnSync(
    TSC,
    [
      '--noEmit',
      '--strict',
      '--target', 'ES2022',
      '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext',
      '--skipLibCheck',
      '--jsx', 'react-jsx',
      join(FIXTURES, fixture),
    ],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the upload seam requires an ApprovedPhoto — enforced by the compiler', () => {
  // THE CONTROL. Without this, every "it does not compile" test below could be passing
  // for an unrelated reason (a typo, a bad import, a missing dep) and I would never know.
  it('CONTROL: an approved photo DOES compile (so the failures below are meaningful)', () => {
    const { code, output } = typecheck('approved-ok.fixture.ts');
    expect(output).toBe('');
    expect(code).toBe(0);
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a raw object literal that matches ApprovedPhoto structurally', () => {
    // The brand is a module-private `unique symbol`, so a hand-built object with the
    // right hash/bytes/contentType is NOT an ApprovedPhoto. This is what makes
    // "upload something I never approved" unrepresentable rather than merely discouraged.
    const { code, output } = typecheck('raw-literal.fixture.ts');
    expect(code).not.toBe(0);
    // The diagnostic must name THE BRAND, not some unrelated compile error — otherwise
    // this test would also pass on a typo. tsc reports the missing brand property by
    // name, which is the strongest available evidence that nominality is what refused it.
    expect(output).toContain("Property '[APPROVED]' is missing");
    expect(output).toContain("required in type 'ApprovedPhoto'");
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a bare asset URI + hash (the shape a picker actually hands you)', () => {
    const { code, output } = typecheck('asset-uri.fixture.ts');
    expect(code).not.toBe(0);
    expect(output).toContain('error TS');
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a photo whose hash was supplied by the caller instead of derived', () => {
    // approvePhoto takes NO hash argument: the hash is computed from the bytes inside it,
    // so a hash only exists for a photo that went through approval. Passing one is an
    // excess-property / unknown-argument error.
    const { code, output } = typecheck('caller-supplied-hash.fixture.ts');
    expect(code).not.toBe(0);
    // Names the HASH specifically. It used to assert only `error TS`, and that was passing
    // vacuously: the fixture also passed a `bytes` argument, so the diagnostic tsc emitted was
    // about `bytes` and this fixture proved nothing about a supplied hash at all.
    expect(output).toContain("'source_photo_hash' does not exist in type 'ApprovePhotoInput'");
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES an UNSCREENED photo at the minter — the verdict is not optional', () => {
    // THE BYPASS A REVIEWER ACTUALLY COMPILED. When approvePhoto took bare bytes, the brand
    // meant "somebody called the minter": a module could feed it every picked photo, approved
    // or not, and it compiled clean and passed the whole suite, because the verdict appeared
    // nowhere in the type. Requiring a screened photo is what closed that, and this is the
    // compile-time evidence — a bare PickedPhoto off pickPhotos() cannot reach it, not even
    // through the sanctioned `tapApproved`, which itself demands an already-screened photo.
    const { code, output } = typecheck('unscreened-photo.fixture.ts');
    expect(code).not.toBe(0);
    // WHERE it is refused is now part of the claim. The bytes are no longer a separate argument
    // (they are read out of the tap), so the fixture fails EARLIER than it used to — at the
    // sanctioned `tapApproved`, which will not accept a photo no screener looked at. Naming the
    // parameter type is what makes this the SCREENING requirement rather than a generic
    // `error TS`: there is no "tap it first, screen it later" order to fall back to.
    expect(output).toContain(
      "Argument of type 'PickedPhoto' is not assignable to parameter of type 'ScreenedPhoto'",
    );
    // The diagnostic must name THE VERDICT, not an argument count: that is what distinguishes
    // "the screener's decision is missing" from any unrelated arity or typo error.
    expect(output).toContain("is missing the following properties from type 'ScreenedPhoto'");
    expect(output).toContain('verdict');
    // And omitting the photo entirely is refused too — there is no unscreened/untapped mode.
    expect(output).toContain("Property 'tapped' is missing");
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a FABRICATED verdict — the bypass that survived the first fix', () => {
    // Requiring `screened: ScreenedPhoto` was not sufficient by itself. ScreenedPhoto was a
    // bare structural interface, so a reviewer wrote `{ photo, verdict: 'candidate' }` as an
    // object literal and minted a brand from a photo no screener had looked at — with the
    // minter ALIASED (`const mint = shared.approvePhoto`) so the source-text call-site check
    // could not see it either. tsc exit 0, 107/107 green, zero casts. Branding ScreenedPhoto
    // with its own unexported `unique symbol` is what closed it, and the alias is kept in the
    // fixture on purpose: the TYPE has to refuse this with no regex helping.
    const { code, output } = typecheck('forged-verdict.fixture.ts');
    expect(code).not.toBe(0);
    // Must name the screening brand specifically — that is what makes the verdict unforgeable,
    // as opposed to some unrelated shape mismatch in the same call.
    expect(output).toContain('[SCREENED]');
    expect(output).toContain("required in type 'ScreenedPhoto'");
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a FORGED APPROVAL TAP — the screener passing is not her consenting', () => {
    // THE THIRD BYPASS, and the subtlest: after the verdict became unforgeable, a photo could
    // still be legitimately SCREENED and never TAPPED. `candidate` is the classifier's opinion;
    // docs/06 §2 says her tap is the structural guarantee, so a screened-but-untapped upload is
    // the invariant failing with every test green. The fixture screens the photo FOR REAL and
    // forges only the tap — so the screening half is genuine and still not sufficient.
    const { code, output } = typecheck('forged-tap.fixture.ts');
    expect(code).not.toBe(0);
    // Must name THE TAP BRAND. That is what distinguishes "her consent is missing" from an
    // unrelated shape error in the same call — and the fixture keeps the minter ALIASED, so the
    // type is the only thing refusing it.
    expect(output).toContain('[TAPPED]');
    expect(output).toContain("required in type 'TappedPhoto'");
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES a SECOND SCREEN driving the mutation through the barrel', () => {
    // `useAddGarment` and `AddGarmentVariables` are both exported from src/photo/index.ts, so a
    // second screen can reach the hook. What it cannot do is build the argument: the variables
    // require an ApprovedPhoto, and the only minter requires a TappedPhoto. This asserts both
    // refusals, which are the two ways a second screen would actually try.
    const { code, output } = typecheck('second-screen-mutation.fixture.ts');
    expect(code).not.toBe(0);
    // Route 1: skip the minter, hand the mutation a hand-built photo.
    expect(output).toContain('[APPROVED]');
    expect(output).toContain("required in type 'ApprovedPhoto'");
    // Route 2: use the real minter with a forged tap.
    expect(output).toContain('[TAPPED]');
    expect(output).toContain("required in type 'TappedPhoto'");
    // And the refusals must be about the BRANDS, not about JSX resolution of the .tsx modules
    // the barrel pulls in transitively — that would be a false green (see typecheck()).
    expect(output).not.toContain('TS6142');
  }, TYPECHECK_TIMEOUT_MS);

  it('REFUSES an upload with no digest port — the runtime backstop is not skippable', () => {
    // The brand is erased at runtime, so the chokepoint re-derives the digest and refuses
    // bytes that do not hash to their own key. A reviewer laundered foreign bytes into a
    // legitimately-minted ApprovedPhoto with a plain object spread — no cast needed — and that
    // re-check is the only thing that catches it. If `sha256Hex` were optional, a caller could
    // omit it and silently get the old unchecked behaviour back; this asserts it cannot.
    const { code, output } = typecheck('missing-digest-port.fixture.ts');
    expect(code).not.toBe(0);
    expect(output).toContain("Property 'sha256Hex' is missing");
    expect(output).toContain("required in type 'UploadApprovedPhotoInput'");
  }, TYPECHECK_TIMEOUT_MS);
});
