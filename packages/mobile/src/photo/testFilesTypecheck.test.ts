// THE TEST FILES THEMSELVES MUST TYPECHECK — closing a blind spot that silently rots fixtures.
//
// `packages/mobile/tsconfig.json` and `packages/shared/tsconfig.json` both carry
// `exclude: ["src/**/*.test.ts"]`, so `pnpm -w exec tsc --build` — and therefore `pnpm verify`'s
// typecheck step — NEVER typechecks a test file. Two consequences, both observed in this repo:
//
//   1. A fixture can drift out of shape and stay invisible until runtime. When `ApprovePhotoInput`
//      stopped accepting `bytes`, two fixtures kept passing it: extra object properties are
//      ignored at runtime, so 55 tests stayed green while the call shapes were wrong. `tsc --build`
//      reported exit 0 the whole time. Caught only by compiling the excluded files by hand.
//   2. An inline `@ts-expect-error` in a test file asserts NOTHING — an unsatisfied one is itself
//      error TS2578, and an uncompiled file emits no errors at all. That is why the compile-time
//      oracles in unrepresentable.test.ts spawn a real tsc over fixtures instead.
//
// WHY A TEST AND NOT A tsconfig CHANGE: the tsconfigs are cage-locked (CLAUDE.md — the agent
// cannot edit its own cage), and the exclusion is load-bearing anyway. Test files legitimately
// import devDependencies and use vitest globals that the emitted build must not depend on;
// including them in the build would change `dist`. So the fix is to typecheck them SEPARATELY,
// which is what this does. If the exclusion is ever removed, this test becomes redundant rather
// than wrong.
//
// It does NOT check packages/mobile/typecheck-fixtures/ — those are SUPPOSED to fail to compile,
// and unrepresentable.test.ts owns them.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

// Same budget as the sibling spawn-tsc oracle: a real compiler under a saturated CPU.
const TYPECHECK_TIMEOUT_MS = 120_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const TSC = join(REPO_ROOT, 'node_modules/.bin/tsc');

// Walk for *.test.ts under a package. Derived from the tree rather than listed, so a NEW test
// file is covered the moment it lands — a hardcoded list would leave exactly the newest (and
// least reviewed) file unchecked.
function testFilesUnder(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.test.ts')) found.push(full);
    }
  };
  walk(dir);
  return found;
}

// ONE spawn, both packages. A per-package split cost a second real compiler invocation for no
// benefit (a failure names its own file:line either way). Measured cost of the single spawn:
// 3.6s in isolation, but ~0 marginal wall-clock on `--project unit` (14.38s before, 12.12s
// after — it runs in parallel with the sibling spawn-tsc oracles, so run-to-run variance
// dominates). Well inside CLAUDE.md rule 4's 10% gate budget.
describe('the excluded test files still typecheck (tsc --build never sees them)', () => {
  it('every packages/{shared,mobile} test file compiles under the real strict flags', () => {
    const files = [
      ...testFilesUnder(resolve(REPO_ROOT, 'packages/shared/src')),
      ...testFilesUnder(resolve(REPO_ROOT, 'packages/mobile')),
    ];
    // ANTI-VACUITY: an empty file list would make the compile trivially succeed and this test
    // would report green while checking nothing — the same aggregate-emptiness trap that made
    // the import-map suite vacuous earlier in this project.
    expect(files.length).toBeGreaterThan(0);

    const result = spawnSync(
      TSC,
      [
        '--noEmit',
        '--strict',
        '--target', 'ES2022',
        '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext',
        '--skipLibCheck',
        // Mirrors packages/mobile/tsconfig.json: some test files sit beside .tsx modules and
        // pull them in transitively. Without it tsc emits TS6142, which would fail this test
        // for a reason unrelated to the code under test.
        '--jsx', 'react-jsx',
        ...files,
      ],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output, `Test files do not typecheck. tsc --build cannot see this because both\n` +
      `tsconfigs exclude src/**/*.test.ts, so these errors would otherwise surface only as a\n` +
      `confusing runtime failure — or not at all, since extra object properties are ignored at\n` +
      `runtime and a mis-shaped fixture can stay green.\n${output}`).toBe('');
    expect(result.status).toBe(0);
  }, TYPECHECK_TIMEOUT_MS);
});
