// DEPLOY GATE: every bare import specifier reachable from a deployed Edge function must be
// resolvable by supabase/import_map.json.
//
// THE BUG THIS CATCHES, which shipped undetected: `zod` was a bare specifier in 36 files under
// packages/*/dist — the exact JS Deno loads — and had NO entry in the import map. Node resolves
// bare specifiers by walking node_modules; DENO DOES NOT. It resolves them only through the
// import map, so every one of the 12 deployed functions would have failed at module load with
// "Relative import path 'zod' not prefixed with /, ./ or ../". Not a runtime edge case — a
// total boot failure of the entire backend, on the very first request after deploy.
//
// WHY NOTHING ELSE COULD CATCH IT: tsc typechecks against node resolution and passes. Every
// unit and integration test runs under NODE, where `zod` resolves from node_modules. The
// integration suite exercises the HANDLERS, not the Deno shims. So the whole test wall is green
// and the deployed artifact cannot start. The only vantage that sees this is the import map
// itself, read against BOTH trees Deno loads: the emitted dist AND the .ts shims under
// supabase/functions — which is what this file does.
//
// NOT a Deno typecheck. A real `deno check` over the shims would also catch export-shape drift,
// but it needs a runner under scripts/ (human-owned). Follow-up: add that gate.
//
// It lives here as a TEST rather than in scripts/gates/ because scripts/ is human-owned (the
// agent cannot add to its own gate infrastructure). A test in the unit project runs on every
// `pnpm verify`, which is the same protection at the same moment.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const IMPORT_MAP_PATH = join(REPO_ROOT, 'supabase/import_map.json');

// Every tree Deno loads at boot, and the extension it loads there.
//
// The .ts shims under supabase/functions are the DEPLOYED ENTRYPOINTS — Deno reads them
// directly, not a compiled copy — and they carry specifiers that appear NOWHERE in dist:
// `pg` (only supabase/functions/_shared/pool.ts imports a driver) and the
// `@closet/functions/` prefix key (dist files reach each other relatively). Scanning only
// dist made both invisible: deleting them from the map left this suite 3-passed/exit-0
// while real `deno check` emitted TS2307 "not in import map" at those exact lines.
const SCAN_ROOTS: readonly { dir: string; extension: string }[] = [
  { dir: 'packages/shared/dist', extension: '.js' },
  { dir: 'packages/db/dist', extension: '.js' },
  { dir: 'packages/functions/dist', extension: '.js' },
  { dir: 'supabase/functions', extension: '.ts' },
];

function readImportMap(): { imports: Record<string, string> } {
  return JSON.parse(readFileSync(IMPORT_MAP_PATH, 'utf8')) as { imports: Record<string, string> };
}

function sourceFilesUnder(dir: string, extension: string): string[] {
  const absolute = join(REPO_ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    // Tree absent (dist not built). The PER-ROOT vacuity assertion below fails on this
    // rather than letting a sibling root's file count paper over it.
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(REPO_ROOT, path)).isDirectory()) return sourceFilesUnder(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

// A specifier is BARE when it is neither relative (./ ../) nor absolute (/) nor a URL
// (npm: / node: / https:). Those are exactly the ones Deno can only resolve via the map.
function bareSpecifiers(source: string): string[] {
  const found = new Set<string>();
  // Matches `from '<spec>'` and `import '<spec>'`. Both inputs are hand-written or tsc-emitted
  // ESM with one import per line, so the shapes are predictable — no need for a full parser.
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1]!;
    if (/^[./]/.test(spec)) continue;
    if (/^(npm|node|https?|jsr|data):/.test(spec)) continue;
    found.add(spec);
  }
  return [...found];
}

// Resolve like the import map does: an exact key, or a trailing-slash PREFIX key
// (e.g. "@closet/functions/" covers "@closet/functions/auth/serveAuthed.js").
function isMapped(spec: string, imports: Record<string, string>): boolean {
  if (Object.hasOwn(imports, spec)) return true;
  return Object.keys(imports).some((key) => key.endsWith('/') && spec.startsWith(key));
}

describe('supabase/import_map.json covers every bare import Deno loads at boot', () => {
  const filesByRoot = new Map(
    SCAN_ROOTS.map((root) => [root.dir, sourceFilesUnder(root.dir, root.extension)] as const),
  );
  const scannedFiles = [...filesByRoot.values()].flat();

  // PER-ROOT, not aggregate. An aggregate `total > 0` averages a missing tree away: with
  // packages/functions/dist absent, the other roots' 34 files kept the count non-zero and the
  // suite passed against an effectively empty map. Each root must stand on its own.
  it.each(SCAN_ROOTS)('$dir is present and scanned, so this suite is not vacuous', ({ dir }) => {
    expect(
      filesByRoot.get(dir)!.length,
      `No files scanned under ${dir}. Every specifier reachable through it is unchecked — ` +
        `run \`pnpm -w exec tsc --build\` if it is a dist tree.`,
    ).toBeGreaterThan(0);
  });

  it('every bare specifier resolves through the map', () => {
    const { imports } = readImportMap();
    const unmapped = new Map<string, string[]>();
    for (const file of scannedFiles) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const spec of bareSpecifiers(source)) {
        if (isMapped(spec, imports)) continue;
        const files = unmapped.get(spec) ?? [];
        files.push(file);
        unmapped.set(spec, files);
      }
    }
    // The message names the specifier AND a file, so the fix is obvious from the failure.
    const report = [...unmapped.entries()]
      .map(([spec, files]) => `  "${spec}" — e.g. ${files[0]} (${files.length} file(s))`)
      .join('\n');
    expect(
      unmapped.size,
      `Unmapped bare imports; Deno cannot resolve these and every deployed function will fail at\n` +
        `module load. Add them to supabase/import_map.json as npm: specifiers:\n${report}`,
    ).toBe(0);
  });

  it('pins a version on every npm: specifier, so a deploy is reproducible', () => {
    // An unpinned npm: specifier resolves to whatever latest is at deploy time — the deployed
    // backend would then drift without a single commit changing.
    const { imports } = readImportMap();
    for (const [key, target] of Object.entries(imports)) {
      if (!target.startsWith('npm:')) continue;
      expect(target, `import_map "${key}" -> "${target}" has no @version pin`).toMatch(/@\d/);
    }
  });
});
