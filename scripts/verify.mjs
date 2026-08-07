#!/usr/bin/env node
// verify.mjs — the single verification wall. One command that CI, the pre-commit
// hook (lefthook), and the verify-stop hook all call, so "the safe path is the fast
// path" has a real local entrypoint. Ported from fitapp/scripts/verify.mjs.
//
// Composes, fail-fast, cheapest/most-structural first. This is the SCAFFOLD
// baseline — steps are added to STEPS in the same task that adds the code they
// guard (check-rls + check-migration-drift with the db package; check-route-schema
// + check-unbounded-select with the functions package; check-tests + tests once
// there are tests). Each addition must also be registered in conventions.json
// gateBudget (naming what it replaces) so check-budget + gen:check stay green.
//
// Modes:
//   --fast (default)  structural + file-scan gates + typecheck + lint. No DB.
//                     For pre-commit / the inner loop — target a few seconds.
//   --full            everything above + (later) check-rls + integration tests.
//                     For CI + the Stop hook. Writes the verify-stamp on success.
//
// Exit 0 = wall passed; non-zero = first failing step's code.

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL = process.argv.includes("--full");
const MODE = FULL ? "full" : "fast";

// A step = { name, cmd, args, full?, fastOnly? }.
const STEPS = [
  { name: "gen:check", cmd: "node", args: ["scripts/gen-conventions.mjs", "--check"] },
  { name: "check-budget", cmd: "node", args: ["scripts/gates/check-budget.mjs"] },
  { name: "check-secrets", cmd: "node", args: ["scripts/gates/check-secrets.mjs"] },
  { name: "typecheck", cmd: "pnpm", args: ["-w", "exec", "tsc", "--build"] },
  { name: "lint", cmd: "pnpm", args: ["-w", "exec", "eslint", "."] },
  // DB-backed structural gate — full only (self-boots Postgres via testcontainers).
  { name: "check-rls", cmd: "node", args: ["scripts/gates/check-rls.mjs"], full: true },
  // Tests: unit runs in both modes (fast, pure); integration is full only (real Postgres).
  { name: "test:unit", cmd: "pnpm", args: ["-w", "exec", "vitest", "run", "--project", "unit"] },
  { name: "test:integration", cmd: "pnpm", args: ["-w", "exec", "vitest", "run", "--project", "integration"], full: true },
  // ── added with their subsystems (kept as a checklist, commented until live) ──
  // { name: "check-route-schema", cmd: "node", args: ["scripts/gates/check-route-schema.mjs"] },
  // { name: "check-unbounded-select", cmd: "node", args: ["scripts/gates/check-unbounded-select.mjs"] },
  // { name: "check-migration-drift", cmd: "node", args: ["scripts/gates/check-migration-drift.mjs"], full: true },
];

console.log(`\n▶ verify (${MODE} mode)\n`);

for (const step of STEPS) {
  if (step.full && !FULL) continue;
  if (step.fastOnly && FULL) continue;
  process.stdout.write(`… ${step.name}\n`);
  const r = spawnSync(step.cmd, step.args, { cwd: REPO, stdio: "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    const code = r.status ?? 1;
    console.error(`\n✗ verify FAILED at "${step.name}" (exit ${code}).`);
    if (step.name === "gen:check") {
      console.error("  → run `pnpm gen` and commit the regenerated files.");
    } else if (step.name === "check-budget") {
      console.error("  → a synchronous gate exceeds the budget (Rule 5). Name what it replaces or move it async.");
    }
    process.exit(code);
  }
}

// On a FULL pass, stamp the current worktree tree-hash so verify-stop can tell
// whether tracked files changed since verify last succeeded. Fast mode does NOT
// stamp — only the full wall is a real "verified" state. Stamp lives under .git so
// it is never committed. Delegates to the shared worktree-hash.sh (single source).
if (FULL) {
  const treeHash = worktreeHash();
  if (treeHash && existsSync(path.join(REPO, ".git"))) {
    writeFileSync(path.join(REPO, ".git", "verify-stamp"), treeHash + "\n");
    console.log(`  (verify-stamp written: ${treeHash.slice(0, 12)})`);
  }
}

console.log(`\n✓ verify (${MODE}) passed — all steps green.\n`);
process.exit(0);

function worktreeHash() {
  const r = spawnSync("sh", [path.join(REPO, "scripts", "worktree-hash.sh"), REPO], { cwd: REPO, encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return r.status === 0 && out ? out : null;
}
