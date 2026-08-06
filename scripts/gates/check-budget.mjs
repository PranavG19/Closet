#!/usr/bin/env node
// check-budget.mjs — structural gate (weight 0). Enforces agent-arch Rule 5:
// the sum of SYNCHRONOUS (async:false, commit-blocking) gate weights must not
// exceed maxBudget. Async gates (post-merge / nightly) are excluded. Reads the
// GENERATED gate-budget.json (derived from conventions.json by `pnpm gen`).
//
// Weights: structural=0, mechanical=1, advisory=2. Exit 0 = within budget;
// exit 1 = over budget (adding a gate without naming what it replaces / removing).

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const { maxBudget, gates } = JSON.parse(
  readFileSync(join(REPO, "gate-budget.json"), "utf8"),
);

const sync = gates.filter((g) => g.async === false);
const spent = sync.reduce((n, g) => n + g.weight, 0);

process.stdout.write(
  `check-budget: synchronous weight ${spent}/${maxBudget} across ${sync.length} sync gate(s)\n`,
);
for (const g of sync) {
  process.stdout.write(`  [${g.weight}] ${g.name} (${g.tier}) — replaces: ${g.replaces}\n`);
}

if (spent > maxBudget) {
  process.stderr.write(
    `\ncheck-budget failed — synchronous gate budget ${spent} exceeds max ${maxBudget}. ` +
      `Rule 5: add a gate only by naming what it replaces, or move a gate async.\n`,
  );
  process.exit(1);
}
