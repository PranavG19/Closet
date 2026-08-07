// applyMigrations — apply the full numbered migration chain (UP sections only)
// against a real Postgres client, in lexical order. Used by every integration
// test to build the schema the RLS oracles run against. The directory is
// resolved relative to this module (import.meta.url), never cwd, so it works
// regardless of where vitest is invoked from.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

// Match node-pg-migrate's own SQL-file section markers so the UP we execute in
// tests is byte-identical to what `pnpm db:migrate` runs in production.
const UP_MARKER = /^\s*--[\s-]*up\s+migration/im;
const DOWN_MARKER = /^\s*--[\s-]*down\s+migration/im;

interface SqlClient {
  query(sql: string): Promise<unknown>;
}

function extractSection(content: string, marker: RegExp, otherMarker: RegExp): string {
  const start = content.search(marker);
  if (start < 0) return content;
  const otherStart = content.search(otherMarker);
  const end = otherStart > start ? otherStart : undefined;
  return content.slice(start, end);
}

export function upSection(content: string): string {
  return extractSection(content, UP_MARKER, DOWN_MARKER);
}

export function downSection(content: string): string {
  return extractSection(content, DOWN_MARKER, UP_MARKER);
}

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

export async function applyMigrations(client: SqlClient): Promise<void> {
  const files = await migrationFiles();
  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await client.query(upSection(content));
  }
}

export async function revertMigrations(client: SqlClient): Promise<void> {
  const files = await migrationFiles();
  for (const file of [...files].reverse()) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await client.query(downSection(content));
  }
}
