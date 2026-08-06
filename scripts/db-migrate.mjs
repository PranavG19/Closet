#!/usr/bin/env node
// db-migrate.mjs — thin wrapper over node-pg-migrate. Requires DATABASE_URL in env,
// SOURCED from a gitignored .env.migrate (never read the file into context — the
// secret-file-guard hook enforces this): `set -a; . ./.env.migrate; set +a; pnpm db:migrate`.
//
// Subcommands: up | down | redo (redo = down 1 then up 1, the round-trip check).
// Migrations live in packages/db/migrations/ as numbered *.sql with real UP + DOWN.
// Ported from the fitapp pattern. Destructive DDL is human-gated (an approval token
// under packages/db/migrations/approvals/) — that check lands with the db package.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmd = process.argv[2] ?? "up";

if (!process.env.DATABASE_URL) {
  console.error(
    "db-migrate: DATABASE_URL not set. SOURCE it from the gitignored .env.migrate:\n" +
      "  set -a; . ./.env.migrate; set +a; pnpm db:migrate\n" +
      "Never cat/read .env.migrate — source it so the value never enters context.",
  );
  process.exit(1);
}

const MIGRATIONS_DIR = "packages/db/migrations";
const base = ["node-pg-migrate", "--migrations-dir", MIGRATIONS_DIR, "--envs", "false"];

const runs = cmd === "redo" ? [["down", "1"], ["up", "1"]] : [[cmd]];
for (const [action, count] of runs) {
  const args = [...base, action, ...(count ? [count] : [])];
  const r = spawnSync("pnpm", ["-w", "exec", ...args], { cwd: REPO, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
