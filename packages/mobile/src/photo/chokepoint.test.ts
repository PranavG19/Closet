// THE SINGLE-CHOKEPOINT INVARIANT: exactly one file in packages/mobile may write bytes to
// the `originals` bucket. The branded ApprovedPhoto makes an unapproved upload
// unrepresentable *through that chokepoint*; this test is what stops a SECOND, unbranded
// upload path from being added beside it. Together they are the whole structural guarantee
// — there is no server-side backstop (Storage RLS permits any object under the caller's own
// prefix and cannot distinguish approved bytes from unapproved).
//
// IT WALKS THE FILESYSTEM, NOT git. `git grep` only searches TRACKED files, so on a working
// tree where the offending file is new-and-unstaged it reports zero hits and the test
// passes vacuously — a trap this project has already hit (recorded in its own notes as
// "git grep skips untracked files"). readdir sees every file regardless of git state.
//
// This is a real mechanical check because it CANNOT be a lint rule here: eslint.config.mjs
// is cage-locked, eslint-plugin-import is not installed, and there is no CI. Reported as a
// finding, not worked around.
//
// WHAT A SOURCE-TEXT ORACLE CANNOT DECIDE — read this before trusting a green run here.
// Two reviewers independently defeated the earlier version of this file, and the lesson was
// NOT "the regexes needed to be better". A regex over source text cannot resolve names, so
// there is a floor below which no amount of pattern-tightening reaches:
//
//   - COMPUTED OR INDIRECTED BUCKET NAMES. `from('orig' + 'inals')`, a name arriving as a
//     function parameter, a value read from config, or a property off an object literal all
//     reach the bucket while matching neither the literal nor the identifier. I confirmed the
//     concatenated form slips the check; it is not hypothetical.
//   - AN UPLOAD THROUGH AN ALIASED CLIENT. `performsStorageUpload` binds names assigned
//     directly from `storage.from(...)`; a handle passed into a helper, stored on an object,
//     or returned from a factory is invisible to it.
//   - ANY UPLOAD THAT IS NOT supabase-js. `fetch(storageUrl, {method:'POST'})` against the
//     Storage REST endpoint writes the same bytes to the same bucket and matches nothing here.
//   - CALLS FROM OUTSIDE packages/mobile, and anything reached through a dependency.
//   - WHETHER A HUMAN PRODUCED THE TAP. This ceiling MOVED, and only partway. The TAPPED brand
//     now makes "she tapped it" a type-level fact rather than a comment: approvePhoto requires a
//     TappedPhoto, whose only constructor is tapApproved, which intake.ts calls solely for the
//     ids in her approval set — so a second screen cannot forge consent (proven by compiling
//     forged-tap.fixture.ts and second-screen-mutation.fixture.ts, not by counting lines here).
//     What the brand CANNOT decide is who put the id in the approval set. I verified the gap
//     rather than assuming it: a fixture that deep-imports `features/onboarding/intake.js`,
//     builds an intake with no UI, calls `toggleApproval(intake, id)` in code, and drives
//     useAddGarment over the resulting real TappedPhotos COMPILES CLEAN (tsc exit 0). The
//     `features/onboarding/index.ts` barrel deliberately exports only the screen, but a barrel
//     is not an access control — the deep path is importable. So the brand proves a photo came
//     through `approvedPhotos`; it does not prove a finger caused it. Closing that needs real
//     module-boundary enforcement (a lint rule with name resolution), which is blocked on the
//     cage-locked eslint config — the same finding recorded at the bottom of this comment.
//   - WHETHER THE PHOTO WAS CORRECTLY SCREENED (classifier recall — device-ML, labeled
//     corpus, human-owned per docs/06 §8.3). Nothing in this file speaks to it.
//
// So this file is a TRIPWIRE for the plausible accidental regression — someone adding a
// second uploader the obvious way — and not a proof of the invariant. The proof, to the
// extent one exists, is the TYPE: unrepresentable.test.ts compiles fixtures showing an
// unapproved photo cannot reach the chokepoint at all, and the minter's verdict check plus
// the chokepoint's hash re-check are enforced in code rather than by pattern-matching. The
// honest gap is that "only one uploader exists" is asserted by reading text, and a
// sufficiently indirect uploader is invisible to that. A lint rule with real name resolution
// is the fix; it is blocked on the cage-locked eslint config, and that is a finding.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = resolve(HERE, '../..');

// The one file allowed to hold an `originals` upload.
const CHOKEPOINT = join('src', 'photo', 'uploadApproved.ts');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'ios', 'android', '.expo', 'screenshots']);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

// Every .ts/.tsx under packages/mobile, EXCLUDING test files, the type-check fixtures
// (which exist precisely to reference the chokepoint and assert it refuses them), and the
// screenshot harness. The harness is dev/E2E-only — it is registered ONLY under
// EXPO_PUBLIC_HARNESS=1 (see index.ts) and never enters the production bundle — and its
// fakeBackend.ts legitimately RETURNS source_photo_path as a canned SERVER response
// (ParseResultResponse.job is a ParseJobRow, which carries that field). This scan guards
// the CLIENT never SENDING a path (the 44812c5 defect); a fake server returning one is the
// opposite direction and correct. Excluding it keeps the gate honest rather than forcing the
// harness to ship a schema-invalid response that would then fail parseBoundary at render.
function productionFiles(): { readonly rel: string; readonly text: string }[] {
  return sourceFiles(MOBILE_ROOT)
    .map((full) => ({ rel: relative(MOBILE_ROOT, full), text: readFileSync(full, 'utf8') }))
    .filter(
      ({ rel }) =>
        !/\.test\.tsx?$/.test(rel) &&
        !rel.startsWith(`typecheck-fixtures${sep}`) &&
        !rel.startsWith(`harness${sep}`),
    );
}

// Lines with the leading `//` stripped out. Every assertion below is about CODE: comments
// mentioning the bucket or the forbidden field are expected and desirable (several files
// exist to explain why the field is absent), and matching them would make the check
// unmaintainable — any honest explanatory comment would fail it.
function codeLines(text: string): string[] {
  return text.split('\n').filter((line) => !line.trimStart().startsWith('//'));
}

// A Storage write, in EITHER of the two shapes it can be written in.
//
// The first version of this check matched only the single chain `storage.from(x).upload(`,
// and a reviewer walked straight through it: split across two statements —
//   const bucket = client.storage.from(ORIGINALS_BUCKET);
//   await bucket.upload(key, bytes);
// — a second uploader passed all 473 tests. So the indirect form is matched too, by binding
// the names that a `storage.from(...)` result is assigned to and then looking for `.upload(`
// on any of them.
//
// It matches a STORAGE write specifically, not any method named `upload`: an injected
// `deps.upload(...)` seam (addGarment.ts) is not a byte write, and the thing that must stay
// singular is the call that actually reaches the bucket.
function performsStorageUpload(text: string): boolean {
  const code = codeLines(text).join('\n');
  if (/storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*upload\s*\(/s.test(code)) return true;
  // Names bound to a `storage.from(...)` result — `const bucket = client.storage.from(B)`.
  const handles = [...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*[^;]*?\bstorage\s*\.\s*from\s*\(/g)];
  return handles.some(([, name]) => new RegExp(`\\b${name}\\s*\\.\\s*upload\\s*\\(`).test(code));
}

// A reference to the originals bucket, by LITERAL or by the exported IDENTIFIER.
//
// The literal-only version of this check was the other half of the same hole: a file that
// imported `ORIGINALS_BUCKET` named the bucket without ever writing the string, so it read
// as clean. Both spellings count.
function namesOriginalsBucket(text: string): boolean {
  return codeLines(text).some(
    (line) => /['"`]originals['"`]/.test(line) || /\bORIGINALS_BUCKET\b/.test(line),
  );
}

describe('the originals-bucket upload chokepoint is singular', () => {
  it('finds the mobile sources at all (guards against a vacuous pass)', () => {
    // If the walk returned nothing, every assertion below would pass for the wrong reason.
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.rel)).toContain(CHOKEPOINT);
  });

  it('exactly ONE file performs a Storage upload — chained OR via a bucket handle', () => {
    // A second uploader means the branded type is no longer the only way bytes leave the
    // device, and the privacy invariant has silently become a convention again. Both
    // spellings count (see performsStorageUpload): matching only the single chain is what a
    // reviewer defeated by splitting the call across two statements.
    const uploaders = productionFiles()
      .filter(({ text }) => performsStorageUpload(text))
      .map(({ rel }) => rel);
    expect(uploaders).toEqual([CHOKEPOINT]);
  });

  it('no other file names the originals bucket IN CODE — literal or identifier', () => {
    // The barrel re-exports the constant, which is how the test above reads it. That is a
    // name, not a write: it hands out no client and cannot reach the bucket.
    const BARREL = join('src', 'photo', 'index.ts');
    const namers = productionFiles()
      .filter(({ text }) => namesOriginalsBucket(text))
      .map(({ rel }) => rel);
    expect(namers.sort()).toEqual([BARREL, CHOKEPOINT].sort());
  });

  it('approvePhoto has exactly ONE call site in packages/mobile', () => {
    // THE REAL GATE BOUNDARY, and the check this file was missing. `uploadApprovedPhoto`
    // being singular is not enough on its own: approvePhoto is what MINTS the brand, so a
    // second caller of it manufactures upload-eligible photos that the one chokepoint will
    // then happily accept. That is exactly the bypass a reviewer compiled — a module that
    // fed every picked photo to the minter and on to the upload seam, which passed the whole
    // suite because nothing counted the minters.
    //
    // The minter now requires a TappedPhoto, which nests a branded ScreenedPhoto, so a second
    // call site can launder neither an unscreened photo nor an untapped one — both are refused
    // by the TYPE (unrepresentable.test.ts compiles the fixtures). This count is therefore no
    // longer the thing holding the "she approved it" half; it is a tripwire against a second
    // minter appearing at all, which is still worth failing on because it is the shape every
    // previous bypass took.
    const callers = productionFiles()
      .filter(({ text }) => codeLines(text).some((line) => /\bapprovePhoto\s*\(/.test(line)))
      .map(({ rel }) => rel);
    expect(callers).toEqual([join('features', 'onboarding', 'AddGarmentScreen.tsx')]);

    // And that one file calls it once, not in a second loop beside the sanctioned one.
    const screen = productionFiles().find(({ rel }) => rel === callers[0]);
    const mints = codeLines(screen!.text).filter((line) => /\bapprovePhoto\s*\(/.test(line));
    expect(mints).toHaveLength(1);
  });

  it('tapApproved has exactly ONE use site in packages/mobile — intake.ts', () => {
    // THE CONSENT MINTER. `tapApproved` is the only constructor of a TappedPhoto, and
    // approvePhoto now requires one — so this function is where "she tapped it" is created.
    // A second use site would manufacture consent for a photo that was never in her approval
    // set, which is precisely the bypass the TAPPED brand was added to close: it would compile
    // clean, because the brand's whole point is that the sanctioned minter can attach it.
    //
    // It must be intake.ts's `approvedPhotos` filter, which is the only place with her approval
    // set in scope. A use in AddGarmentScreen.tsx, or in any second screen, would mean the tap
    // is being asserted by code rather than derived from her taps.
    //
    // IT COUNTS USES, NOT CALLS, and that distinction is not pedantry — it is a hole this check
    // fell into on its first draft. intake.ts writes `.map(tapApproved)`, point-free, so a
    // `/\btapApproved\s*\(/` pattern (the shape the approvePhoto check above uses) matched ZERO
    // files and the test failed against the sanctioned code. A minter passed as a value is
    // exactly as dangerous as one invoked directly, so the identifier is what gets counted, with
    // the import line excluded because naming an import is not using it.
    const usesMinter = (text: string): string[] =>
      codeLines(text).filter(
        (line) => /\btapApproved\b/.test(line) && !/^\s*import\b/.test(line),
      );

    const callers = productionFiles()
      .filter(({ text }) => usesMinter(text).length > 0)
      .map(({ rel }) => rel);
    expect(callers).toEqual([join('features', 'onboarding', 'intake.ts')]);

    const intake = productionFiles().find(({ rel }) => rel === callers[0]);
    expect(usesMinter(intake!.text)).toHaveLength(1);
  });

  it('screenPhoto is used ONLY by the port adapter — app code never asserts a verdict', () => {
    // The third minter. `screenPhoto` RECORDS a verdict, and the ONLY legitimate caller is the
    // adapter behind PhotoIntakePort.screen() — src/photo/photoIntakeNative.ts, which today
    // records `undetermined` for every photo because no ML runtime is bound. A use anywhere
    // else would be a verdict asserted by the app rather than produced by a screener: the
    // forged-verdict bypass, written the sanctioned way so no brand check could see it.
    //
    // Notably this must NOT be intake.ts or AddGarmentScreen.tsx. Those consume verdicts and
    // must never be able to manufacture one — a `screenPhoto(photo, 'candidate')` in the screen
    // would launder an unscreened photo through the whole chain with the brands intact.
    const ADAPTER = join('src', 'photo', 'photoIntakeNative.ts');
    const callers = productionFiles()
      .filter(({ text }) =>
        codeLines(text).some(
          (line) => /\bscreenPhoto\b/.test(line) && !/^\s*import\b/.test(line),
        ),
      )
      .map(({ rel }) => rel);
    expect(callers).toEqual([ADAPTER]);
  });

  it('no file uses a signed UPLOAD url (a second way to write bytes)', () => {
    // createSignedUploadUrl / uploadToSignedUrl would bypass the chokepoint entirely while
    // still landing bytes in the bucket.
    const offenders = productionFiles()
      .filter(({ text }) => /createSignedUploadUrl|uploadToSignedUrl/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('the chokepoint requires the branded type — it imports ApprovedPhoto', () => {
    const chokepoint = productionFiles().find(({ rel }) => rel === CHOKEPOINT);
    expect(chokepoint).toBeDefined();
    expect(chokepoint!.text).toContain('ApprovedPhoto');
  });

  it('NO mobile file sends source_photo_path as DATA (the 44812c5 defect)', () => {
    // The server derives the path from the verified sub. A client that names one is a
    // cross-tenant read + SSRF sink that Storage RLS cannot stop, because the fetch is
    // performed by a vendor. .strict() would 400 it, but it must not be written at all.
    //
    // Comment mentions are expected and desirable — several files explain WHY the field is
    // absent. What must not exist is the identifier used as an object key or property
    // access, i.e. `source_photo_path:` or `.source_photo_path`.
    const asData = /(^|[^\w.])source_photo_path\s*:|\.\s*source_photo_path\b/;
    const offenders = productionFiles()
      .filter(({ text }) => codeLines(text).some((line) => asData.test(line)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('mobile never imports @closet/db or @closet/functions', () => {
    // The package boundary that forced the key composer into @closet/shared in the first
    // place. Comments mentioning the packages are fine; an import is not.
    const offenders = productionFiles()
      .filter(({ text }) => /from\s+['"]@closet\/(db|functions)/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
