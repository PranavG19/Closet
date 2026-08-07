#!/usr/bin/env node
// check-definer-search-path.mjs — structural gate (weight 0). Scans committed
// migrations for SECURITY DEFINER functions and fails if any lacks a pinned
// `SET search_path = ''` (or an explicit safe search_path) in the SAME CREATE
// FUNCTION statement.
//
// WHY: a SECURITY DEFINER function runs with the DEFINER's privileges and BYPASSES
// RLS. Without a pinned search_path it is the classic Postgres privilege-escalation
// vector — a caller plants a malicious object in an earlier-search-path schema and
// hijacks an unqualified reference, executing it as the definer (often superuser on
// a bare container). Pinning `search_path = ''` + fully schema-qualifying every
// reference closes it. This gate makes the unsafe state UNREPRESENTABLE-by-detection
// (agent-arch Rule 2: structural where possible, detection with teeth otherwise) so
// a future migration can't silently add an unpinned definer fn.
//
// Text-scan of migration SQL (no DB needed — cheap, sync). Exit 0 = clean; exit 1 =
// an unpinned SECURITY DEFINER fn (names the file). This is the mutation target:
// remove the SET search_path line from any definer fn → gate MUST go red.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(REPO, "packages", "db", "migrations");

if (!existsSync(MIGRATIONS_DIR)) {
  process.stdout.write("check-definer-search-path: no migrations dir — nothing to scan\n");
  process.exit(0);
}

// Split a SQL file into CREATE [OR REPLACE] FUNCTION ... statements (up to the
// language/body). We only need the function HEADER (the clauses between CREATE
// FUNCTION and the body delimiter) to see SECURITY DEFINER + SET search_path, since
// both are header clauses in Postgres. Scan the UP section only (before DOWN).
function upSection(sql) {
  const i = sql.search(/^--\s*DOWN Migration/im);
  return i === -1 ? sql : sql.slice(0, i);
}

// Match each CREATE FUNCTION header up to the AS $...$ / BEGIN / LANGUAGE boundary.
// Header clauses (SECURITY DEFINER, SET search_path, LANGUAGE, STABLE...) all sit
// between the signature and the body delimiter.
const FN_HEADER_RE = /create\s+(?:or\s+replace\s+)?function\b[\s\S]*?(?=\bas\s+\$|\bbegin\b|\breturn\b|;)/gi;

let offenders = 0;
let definerCount = 0;
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const up = upSection(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  for (const header of up.match(FN_HEADER_RE) ?? []) {
    if (!/security\s+definer/i.test(header)) continue;
    definerCount += 1;
    // Accept SET search_path = '' or a pinned explicit list; reject its absence.
    const pinned = /set\s+search_path\s*(?:=|to)\s*(''|pg_catalog|"?\$user"?|\S)/i.test(header);
    const emptyPin = /set\s+search_path\s*(?:=|to)\s*''/i.test(header);
    if (!pinned) {
      process.stderr.write(`  [GAP] ${file}: SECURITY DEFINER function with NO pinned search_path\n`);
      offenders += 1;
    } else if (!emptyPin) {
      // A non-empty pin is allowed but flagged for review (must schema-qualify).
      process.stdout.write(`  [warn] ${file}: SECURITY DEFINER fn pins a non-empty search_path — ensure every ref is schema-qualified\n`);
    } else {
      process.stdout.write(`  [ok] ${file}: SECURITY DEFINER fn pins search_path = ''\n`);
    }
  }
}

if (offenders > 0) {
  process.stderr.write(
    `\ncheck-definer-search-path FAILED — ${offenders} SECURITY DEFINER function(s) without a pinned search_path. ` +
      `Add \`SET search_path = ''\` to the CREATE FUNCTION and schema-qualify every reference ` +
      `(public.*, auth.uid(), pg_catalog ops). An unpinned definer fn is a privilege-escalation hole.\n`,
  );
  process.exit(1);
}
process.stdout.write(`check-definer-search-path: clean (${definerCount} SECURITY DEFINER fn(s) scanned, all pinned)\n`);
process.exit(0);
