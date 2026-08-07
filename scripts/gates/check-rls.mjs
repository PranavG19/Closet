#!/usr/bin/env node
// check-rls.mjs — structural gate (weight 0, full-only). Asserts every base table
// in `public` carries ROW LEVEL SECURITY in FORCE mode. FORCE matters: plain
// ENABLE still lets the TABLE OWNER bypass RLS, so enabled-but-not-forced is a
// latent cross-tenant / self-grant hole.
//
// TWO MODES:
//   1. DATABASE_URL set → check THAT database as-is (used by the fire-drill
//      integration test, which points the gate at its own already-migrated +
//      tampered container to prove the gate goes red). No container boot, no migrate.
//   2. DATABASE_URL unset → SELF-BOOT a throwaway postgres:17-alpine via
//      testcontainers, apply the full migration chain, then check. This makes the
//      gate run in `pnpm verify:full` with zero setup — a gate that needs manual
//      env would rot into a false green. Requires Docker/colima; if the runtime is
//      unavailable it exits 2 (infra), distinct from a real gap (1).
//
// The table set is DISCOVERED (never hard-coded) — the whole point is catching a
// table someone forgot to force. Only exclusion: node-pg-migrate's `pgmigrations`
// ledger. This is the mutation target: strip FORCE off any table and the gate MUST
// go red (proven by the fire-drill in subscriptions.rls.integration.test.ts).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import pg from "pg";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(REPO, "packages", "db", "migrations");
const LEDGER = "pgmigrations";

// Mirror the integration harness's colima detection so the gate finds the daemon.
const COLIMA_SOCKET = `${process.env.HOME}/.colima/default/docker.sock`;
if (!process.env.DOCKER_HOST && existsSync(COLIMA_SOCKET)) {
  process.env.DOCKER_HOST = `unix://${COLIMA_SOCKET}`;
  process.env.TESTCONTAINERS_HOST_OVERRIDE = "127.0.0.1";
  process.env.TESTCONTAINERS_RYUK_DISABLED = "true";
}

const DISCOVER_SQL = `
  SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> $1
  ORDER BY c.relname`;

// Apply each migration's UP section (everything before `-- DOWN Migration`).
function upSql(file) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const idx = raw.search(/^--\s*DOWN Migration/im);
  return idx === -1 ? raw : raw.slice(0, idx);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Discover public tables and assert every one is ENABLE + FORCE. Returns an exit
// code (does NOT exit) so callers can clean up their container/client first.
async function computeCode(client, migrated) {
  if (migrated) for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    await client.query(upSql(f));
  }
  const { rows } = await client.query(DISCOVER_SQL, [LEDGER]);
  if (rows.length === 0) {
    process.stderr.write("check-rls: no public data tables found — failing safe\n");
    return 1;
  }
  const offenders = [];
  for (const { table_name, enabled, forced } of rows) {
    process.stdout.write(`  [${enabled && forced ? "ok" : "GAP"}] public.${table_name} enabled=${enabled} forced=${forced}\n`);
    if (!enabled || !forced) offenders.push(table_name);
  }
  if (offenders.length > 0) {
    process.stderr.write(`\ncheck-rls FAILED — ${offenders.length} table(s) without RLS FORCE: ${offenders.join(", ")}. Every tenant table MUST be ENABLE + FORCE ROW LEVEL SECURITY. Add the ALTER in a numbered migration.\n`);
    return 1;
  }
  process.stdout.write(`\ncheck-rls: clean — all ${rows.length} public data table(s) are RLS FORCE\n`);
  return 0;
}

// Mode 1: DATABASE_URL provided → check that DB as-is (fire-drill test path).
async function checkExisting(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await computeCode(client, false); }
  finally { await client.end().catch(() => undefined); }
}

async function main() {
  if (process.env.DATABASE_URL) return checkExisting(process.env.DATABASE_URL);

  if (!existsSync(MIGRATIONS_DIR)) {
    process.stdout.write("check-rls: no migrations dir yet — nothing to check\n");
    process.exit(0);
  }
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    process.stdout.write("check-rls: no migrations yet — nothing to check\n");
    process.exit(0);
  }

  const container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({ POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "testpass", POSTGRES_DB: "closet_rlscheck" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const connConfig = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: "postgres",
    password: "testpass",
    database: "closet_rlscheck",
  };

  // colima port-forward can accept a beat after the log line — retry connect with
  // a FRESH client each attempt (a pg.Client that failed connect cannot be reused).
  let client;
  const deadline = Date.now() + 30_000;
  for (;;) {
    client = new pg.Client(connConfig);
    try { await client.connect(); break; }
    catch (e) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw e;
      await sleep(250);
    }
  }

  try {
    return await computeCode(client, true);
  } finally {
    await client.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    // Distinguish infra (no Docker) from a real gap so a missing daemon doesn't read as a policy failure.
    const infra = /docker|ECONNREFUSED|ENOENT|container|daemon/i.test(msg);
    process.stderr.write(`check-rls: ${infra ? "INFRA (container runtime unavailable) — " : "error — "}${msg}\n`);
    process.exit(infra ? 2 : 1);
  });
