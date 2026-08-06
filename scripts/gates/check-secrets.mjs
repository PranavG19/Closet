#!/usr/bin/env node
// check-secrets.mjs — mechanical gate (weight 1). Scans tracked source for
// committed secrets: long-lived credential shapes (AWS AKIA, private-key headers,
// bearer/JWT-looking literals, Supabase service-role keys, generic api_key = "…").
//
// This is a NECESSARY-not-sufficient pre-filter (agent-arch axis 18: named ~17%
// scanner miss rate) — the real protection is that `.env.*` is gitignored and the
// secret-file-guard hook blocks reading it into context. This gate stops the
// obvious accidental commit.
//
// Exit 0 = clean; exit 1 = a likely secret found (prints file:line). Byte-simple:
// walks `git ls-files`, skips the allowed placeholder file (.env.example) and this
// gate's own source, applies a small set of high-signal patterns.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key header", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "supabase service_role / JWT literal", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "generic hardcoded secret assignment", re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
];

// Files that legitimately contain secret-SHAPED text (docs about secrets, this gate,
// the guard hook) — excluded to avoid self-flagging. Allowlist is explicit + small.
const ALLOW = [
  ".env.example",
  "scripts/gates/check-secrets.mjs",
  ".claude/hooks/secret-file-guard.sh",
  "docs/02-engineering-requirements.md",
];

function tracked() {
  return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
}

let hits = 0;
let files;
try {
  files = tracked();
} catch {
  // No git yet (pre-init) → nothing tracked to scan. Clean by definition.
  process.stdout.write("check-secrets: no git repo yet — nothing tracked to scan\n");
  process.exit(0);
}

for (const file of files) {
  if (ALLOW.includes(file)) continue;
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|lock|woff2?|ttf)$/i.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of PATTERNS) {
      if (re.test(lines[i])) {
        process.stderr.write(`SECRET? ${file}:${i + 1} — ${name}\n`);
        hits += 1;
      }
    }
  }
}

if (hits > 0) {
  process.stderr.write(
    `\ncheck-secrets failed — ${hits} likely secret(s) in tracked files. ` +
      `Move secrets to a gitignored .env.* (SOURCE, never commit). If a false positive, ` +
      `add the exact file to the ALLOW list with justification.\n`,
  );
  process.exit(1);
}
process.stdout.write(`check-secrets: clean (${files.length} tracked files scanned)\n`);
