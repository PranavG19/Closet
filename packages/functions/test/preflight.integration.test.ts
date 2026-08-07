// DEPLOY PREFLIGHT — the gate that must be GREEN against the REAL Supabase project
// before one byte of real traffic reaches it. docs/DEPLOY-RUNBOOK.md step 9 runs
// this; LAUNCH-READINESS §6.2 and §6.5 are the two silent-failure traps it closes.
//
// WHY THIS FILE EXISTS. Every other oracle in this repo runs against a throwaway
// testcontainer, where the "service_role" is the container superuser and Storage
// does not exist at all. Two guarantees therefore have NEVER been observed:
//
//   TRAP A (§6.2) — revenuecat-webhook writes subscriptions.entitlement_active
//   through makeServiceExecutor, which issues NO `SET LOCAL ROLE`. The POOL'S OWN
//   IDENTITY *is* the privilege boundary. Point SUPABASE_DB_SERVICE_URL at anything
//   that is not a genuine RLS-bypassing service_role and every real purchase event
//   raises Postgres 42501 → the webhook 500s → RevenueCat retries forever →
//   entitlement never flips → a PAYING customer stays locked out of kind=full. The
//   safety property becomes the day-1 outage, and nothing detects it until money
//   arrives. A.1 detects it.
//
//   TRAP B (§6.5) — the never-uploads privacy invariant is proven only at the
//   HANDLER layer (security.integration.test.ts). docs/06 §6 makes Storage RLS on
//   storage.objects "the ONLY control preventing cross-user byte reads/writes".
//   B.1 is the real external oracle for it: the Storage service itself, not our code.
//
// HOW IT STAYS HONEST IN CI. There is no real project in CI, so every env-dependent
// block self-skips via `describe.skipIf` on its own required-env probe, and the
// module prints an unmistakable PREFLIGHT SKIPPED banner naming exactly which checks
// did NOT run. A skip must never read as a pass. As of writing, A.1/A.2/A.3/A.4/B.1
// are WRITTEN BUT NEVER EXECUTED — their first real run IS the deploy gate.
//
// A.0 is the exception: it needs no project and runs everywhere, because the trap it
// closes (a shim with no config.toml entry deploys with the gateway's JWT verify ON,
// which rejects our valid asymmetric JWTs) is observable from the tree alone.
//
// THE RESPONSE IS NEVER THE ORACLE, same rule as the rest of the gauntlet: A.1 reads
// the row back through the user's OWN RLS-scoped read path; B.1 grades a refused
// cross-prefix write by having the PREFIX OWNER confirm nothing landed.
//
// WRITES AGAINST A LIVE PROJECT. A.1 and B.1 write. Both use a fixed, obviously-fake
// scratch identity and clean up in afterAll; A.1 also pre-cleans in beforeAll so a
// crashed prior run cannot poison it. A.1 touches exactly one `subscriptions` row
// (no FK dependents — see 0008) keyed on SCRATCH_USER. Nothing else is mutated.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { z } from 'zod';
import { makeSubscriptionsRepo, type QueryExecutor } from '@closet/db';
import { Uuid, parseBoundary } from '@closet/shared';
import { envValue } from '../src/auth/env.js';
import { makeJwksVerifier } from '../src/auth/withAuth.js';
import { makePgExecutor, makeServiceExecutor, type Sql } from '../src/auth/executor.js';

// ─── env probe ───────────────────────────────────────────────────────────────
// PREFLIGHT_PROJECT_REF is the master opt-in: it is required by EVERY env-gated
// block, so no check can fire by accident on a developer who merely has a stale
// DATABASE_URL exported. It is also echoed in failure messages so a green run
// names WHICH project it proved.
const PROJECT_REF = envValue('PREFLIGHT_PROJECT_REF');
const SERVICE_URL = envValue('SUPABASE_DB_SERVICE_URL');
const APP_URL = envValue('DATABASE_URL');
const JWKS_URL = envValue('JWKS_URL');
const FUNCTIONS_BASE_URL = envValue('PREFLIGHT_FUNCTIONS_BASE_URL');
const SUPABASE_URL = envValue('PREFLIGHT_SUPABASE_URL');
const ANON_KEY = envValue('PREFLIGHT_SUPABASE_ANON_KEY');
const USER_A_JWT = envValue('PREFLIGHT_USER_A_JWT');
const USER_B_JWT = envValue('PREFLIGHT_USER_B_JWT');

const present = (...values: readonly (string | undefined)[]): boolean =>
  values.every((value) => value !== undefined && value !== '');

const CAN_RUN_ENTITLEMENT = present(PROJECT_REF, SERVICE_URL, APP_URL);
const CAN_RUN_JWKS = present(PROJECT_REF, JWKS_URL);
const CAN_RUN_LEDGER = present(PROJECT_REF, SERVICE_URL);
const CAN_RUN_ROUTES = present(PROJECT_REF, FUNCTIONS_BASE_URL);
const CAN_RUN_STORAGE = present(
  PROJECT_REF,
  SUPABASE_URL,
  ANON_KEY,
  USER_A_JWT,
  USER_B_JWT,
  JWKS_URL,
);

// The banner. process.stdout (not console, not the structured logger — this is test
// output, and it must survive whatever reporter is in use) so a skipped run can
// never be mistaken for a proven one.
function announceSkips(): void {
  const skipped: readonly string[] = [
    CAN_RUN_ENTITLEMENT ? '' : 'A.1 service_role really bypasses RLS (TRAP A — the money write)',
    CAN_RUN_JWKS ? '' : 'A.2 JWKS reachability + shape (every authed request)',
    CAN_RUN_LEDGER ? '' : 'A.3 migration ledger matches the numbered files on disk',
    CAN_RUN_ROUTES ? '' : 'A.4 every route answers with the HANDLER 401, not the gateway 401',
    CAN_RUN_STORAGE ? '' : 'B.1 Storage RLS binds to sub on originals + cutouts (TRAP B — privacy)',
  ].filter((line) => line !== '');
  if (skipped.length === 0) return;
  process.stdout.write(
    `\n${'='.repeat(78)}\n` +
      `PREFLIGHT SKIPPED — NOT RUN AGAINST A REAL PROJECT. THIS IS NOT A PASS.\n` +
      `${'='.repeat(78)}\n` +
      skipped.map((line) => `  · UNVERIFIED: ${line}\n`).join('') +
      `\nThese checks are the docs/DEPLOY-RUNBOOK.md step-9 deploy gate. They require a\n` +
      `REAL deployed Supabase project. Set PREFLIGHT_PROJECT_REF (+ the vars documented in\n` +
      `.env.example) and re-run to actually prove them:\n` +
      `  set -a; . ./.env.deploy; set +a; pnpm -w exec vitest run --project integration \\\n` +
      `    packages/functions/test/preflight.integration.test.ts\n` +
      `${'='.repeat(78)}\n\n`,
  );
}
announceSkips();

// ─── shared helpers ──────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'db', 'migrations');
const SHIMS_DIR = join(REPO_ROOT, 'supabase', 'functions');
const CONFIG_TOML = join(REPO_ROOT, 'supabase', 'config.toml');

// docs/06 §6 is authoritative on the bucket names: `originals` (approved uploads)
// and `cutouts` (parse output), both PRIVATE, both keyed on first path segment =
// owner. docs/05 and LAUNCH-READINESS §6.5 say "uploads + cutouts" — that is a doc
// drift, not a second bucket (see the report). Hardcoded, not configurable: if the
// operator named a bucket differently, this must fail loudly, not adapt.
const BYTE_BUCKETS = ['originals', 'cutouts'] as const;

// An obviously-fake scratch tenant. subscriptions.user_id has no FK (0008), so no
// auth.users row is needed and nothing cascades. A leftover row is instantly
// recognisable as preflight debris rather than a real customer.
const SCRATCH_USER = 'deadbeef-dead-4ead-8ead-deadbeefdead';

// Adapt a pg.Pool to the driver-free Sql seam the executors consume, so preflight
// drives the EXACT production seam (makeServiceExecutor / makePgExecutor) rather
// than ad-hoc SQL that could prove something the webhook does not actually do.
function poolAsSql(pool: Pool): Sql {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row = unknown>(sql: string, params?: readonly unknown[]) {
          const result = await client.query(sql, params ? [...params] : undefined);
          return { rows: result.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
  };
}

// Narrow a caught value to its Postgres SQLSTATE without an `as` cast and WITHOUT
// touching `.message` — a raw driver message can carry row data (PII rule).
function sqlState(thrown: unknown): string {
  if (typeof thrown === 'object' && thrown !== null && 'code' in thrown) {
    const { code } = thrown;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

// ─── A.0 — shim ↔ config.toml parity (NO PROJECT NEEDED, ALWAYS RUNS) ────────
// The trap: `supabase functions deploy` verifies the caller's JWT AT THE GATEWAY
// unless the function is configured `verify_jwt = false`. Our auth is asymmetric
// JWKS inside withAuth; the gateway's check is a different (shared-secret) scheme
// and rejects a valid asymmetric token. A shim directory with no [functions.<name>]
// stanza therefore deploys guarded by the WRONG verifier and 401s every real
// request — silently, because the route exists and answers.
const TOML_SECTION = /^\[functions\.([a-z0-9-]+)\]\s*$/gim;

function configuredFunctions(toml: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headers = [...toml.matchAll(TOML_SECTION)];
  headers.forEach((header, index) => {
    const name = header[1];
    if (name === undefined) return;
    const start = header.index + header[0].length;
    const next = headers[index + 1];
    sections.set(name, toml.slice(start, next?.index ?? toml.length));
  });
  return sections;
}

async function shimRoutes(): Promise<string[]> {
  const entries = await readdir(SHIMS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

describe('A.0 deploy-config parity — every Edge shim is configured verify_jwt=false', () => {
  it('every supabase/functions/<route>/ dir has a [functions.<route>] stanza in config.toml', async () => {
    const routes = await shimRoutes();
    const configured = configuredFunctions(await readFile(CONFIG_TOML, 'utf8'));
    const missing = routes.filter((route) => !configured.has(route));
    expect(
      missing,
      `supabase/config.toml is MISSING a [functions.<name>] stanza for: ${missing.join(', ')}.\n` +
        `CONSEQUENCE: those routes deploy with the Supabase gateway's JWT verification ON.\n` +
        `The gateway verifies with a shared secret; withAuth verifies asymmetrically against\n` +
        `JWKS_URL. The gateway rejects our valid tokens, so every real request to those routes\n` +
        `returns 401 before the handler runs — a silent day-1 outage on exactly those features.\n` +
        `FIX: add a stanza per route (verify_jwt = false + import_map) to supabase/config.toml.`,
    ).toEqual([]);
  });

  it('every configured function sets verify_jwt = false (auth is the handler’s, not the gateway’s)', async () => {
    const configured = configuredFunctions(await readFile(CONFIG_TOML, 'utf8'));
    const guarded = [...configured.entries()]
      .filter(([, body]) => !/^\s*verify_jwt\s*=\s*false\s*$/m.test(body))
      .map(([name]) => name);
    expect(
      guarded,
      `supabase/config.toml does not set verify_jwt = false for: ${guarded.join(', ')}.\n` +
        `CONSEQUENCE: the gateway double-guards with a shared-secret scheme and rejects the\n` +
        `asymmetric JWTs withAuth is built for — every request to those routes 401s.`,
    ).toEqual([]);
  });

  it('no config.toml stanza names a route that has no shim (a deploy that cannot exist)', async () => {
    const routes = new Set(await shimRoutes());
    const configured = configuredFunctions(await readFile(CONFIG_TOML, 'utf8'));
    const orphans = [...configured.keys()].filter((name) => !routes.has(name));
    expect(
      orphans,
      `supabase/config.toml configures functions with no supabase/functions/<name>/index.ts: ` +
        `${orphans.join(', ')}. Either the shim was deleted (remove the stanza) or the name is ` +
        `misspelled (the real route then deploys unconfigured — see the previous check).`,
    ).toEqual([]);
  });
});

// ─── A.1 — TRAP A: service_role really bypasses RLS ──────────────────────────
const SERVICE_IDENTITY_FAILURE =
  `SUPABASE_DB_SERVICE_URL is not a service_role identity (project ${PROJECT_REF ?? '?'}).\n` +
  `The revenuecat-webhook writes subscriptions.entitlement_active through\n` +
  `makeServiceExecutor, which issues NO \`SET LOCAL ROLE\` — the pool's OWN identity is\n` +
  `the privilege boundary, and subscriptions has RLS FORCE with a SELECT-only policy and\n` +
  `no INSERT/UPDATE grant for app_user.\n` +
  `CONSEQUENCE: every real RevenueCat purchase event raises 42501, the webhook 500s,\n` +
  `RevenueCat retries forever, entitlement NEVER flips, and a PAYING customer stays\n` +
  `locked out of kind=full parses. This is LAUNCH-READINESS §6.2 — the single most\n` +
  `dangerous deploy misconfiguration.\n` +
  `FIX: set SUPABASE_DB_SERVICE_URL to a connection string whose role is the RLS-exempt\n` +
  `service_role (or a BYPASSRLS role with write grants on subscriptions + webhook_events).`;

describe.skipIf(!CAN_RUN_ENTITLEMENT)('A.1 TRAP A — SUPABASE_DB_SERVICE_URL is a real service_role identity', () => {
  let servicePool: Pool;
  let appPool: Pool;
  let serviceExec: QueryExecutor;
  let appUserExec: QueryExecutor;

  beforeAll(async () => {
    servicePool = new Pool({ connectionString: SERVICE_URL });
    appPool = new Pool({ connectionString: APP_URL });
    serviceExec = makeServiceExecutor(poolAsSql(servicePool));
    appUserExec = makePgExecutor(poolAsSql(appPool), SCRATCH_USER);
    // Pre-clean: a crashed earlier run must not let a stale row fake a pass.
    await serviceExec.query('DELETE FROM public.subscriptions WHERE user_id = $1', [SCRATCH_USER]);
  }, 60_000);

  afterAll(async () => {
    // Leave the live project exactly as found. Attempted even if a check failed.
    await serviceExec
      ?.query('DELETE FROM public.subscriptions WHERE user_id = $1', [SCRATCH_USER])
      .catch(() => undefined);
    await servicePool?.end().catch(() => undefined);
    await appPool?.end().catch(() => undefined);
  });

  it('A.1a service_role performs the ACTUAL webhook entitlement write (not ad-hoc SQL)', async () => {
    // makeSubscriptionsRepo(makeServiceExecutor(...)).applyEvent IS the webhook's
    // write, byte for byte (revenuecat-webhook.ts step 5).
    try {
      const applied = await makeSubscriptionsRepo(serviceExec).applyEvent({
        userId: SCRATCH_USER,
        rcAppUserId: 'preflight-scratch',
        entitlementActive: true,
        eventTs: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      expect(applied, `${SERVICE_IDENTITY_FAILURE}\n(applyEvent returned no row at all.)`).not.toBeNull();
    } catch (thrown) {
      const state = sqlState(thrown);
      throw new Error(
        `${SERVICE_IDENTITY_FAILURE}\nPostgres SQLSTATE observed: ${state}` +
          (state === '42501' ? ' (insufficient_privilege — the exact RLS/grant refusal above).' : '.'),
      );
    }
  });

  it('A.1b the entitlement is readable through the USER’s own RLS-scoped path (what kind=full reads)', async () => {
    // Independent read, not applyEvent's return value: DATABASE_URL + app_user +
    // RLS, i.e. exactly how palette-entitlement and parse-photo kind=full observe it.
    const entitlement = await makeSubscriptionsRepo(appUserExec).getEntitlement(SCRATCH_USER);
    expect(
      entitlement.entitlement_active,
      `The service_role write landed but the app_user read path cannot see it (project ` +
        `${PROJECT_REF ?? '?'}). Either DATABASE_URL points at a DIFFERENT database than\n` +
        `SUPABASE_DB_SERVICE_URL, or the subscriptions_select_own policy / app_user SELECT\n` +
        `grant did not apply (check A.3).\n` +
        `CONSEQUENCE: entitlement flips in the money table but the paywall and kind=full gate\n` +
        `never observe it — the customer pays and stays locked out.`,
    ).toBe(true);
  });

  it('A.1c DISCRIMINATOR — the app_user (DATABASE_URL) path is REFUSED the same write', async () => {
    // Without this, A.1a is a tautology: it would pass even if every role could
    // write the money table. This is the structural guarantee that a client cannot
    // mint entitlement, re-derived against the REAL project rather than a container.
    let refused = false;
    let state = 'none';
    try {
      await makeSubscriptionsRepo(appUserExec).applyEvent({
        userId: SCRATCH_USER,
        rcAppUserId: 'preflight-self-grant',
        entitlementActive: true,
        eventTs: '2026-06-01T00:00:00.000Z',
        expiresAt: null,
      });
    } catch (thrown) {
      refused = true;
      state = sqlState(thrown);
    }
    expect(
      refused,
      `CRITICAL — DATABASE_URL can WRITE public.subscriptions. It must not.\n` +
        `DATABASE_URL is used by all 11 user-JWT routes; makePgExecutor drops it to app_user\n` +
        `per transaction, and app_user has SELECT-only on the money table (0008). A successful\n` +
        `write here means DATABASE_URL's role is over-privileged (service_role / superuser /\n` +
        `BYPASSRLS, or app_user was granted INSERT).\n` +
        `CONSEQUENCE: any authenticated user can mint their own entitlement — the paywall is\n` +
        `bypassable and A.1a proves nothing. FIX: point DATABASE_URL at a plain role GRANTed\n` +
        `app_user, never at service_role.`,
    ).toBe(true);
    // 42501 is the expected refusal. A different state still refuses the write, so
    // the guarantee holds, but it means something other than the grant is failing.
    expect(
      ['42501', '42P01'].includes(state) || state !== 'none',
      `Expected SQLSTATE 42501 (insufficient_privilege); observed ${state}.`,
    ).toBe(true);
  });
});

// ─── A.2 — JWKS reachability + shape ─────────────────────────────────────────
// Every authed request calls createRemoteJWKSet(JWKS_URL) (withAuth.ts:51). An
// unreachable or wrong-shaped JWKS means EVERY route 401s — LAUNCH-READINESS §6.6.
const JwksDocument = z.object({
  keys: z.array(z.object({ kty: z.string() }).passthrough()).min(1),
});

describe.skipIf(!CAN_RUN_JWKS)('A.2 JWKS_URL resolves and yields usable keys', () => {
  it('A.2a the JWKS endpoint answers 200 with at least one key', async () => {
    const url = JWKS_URL ?? '';
    let status = 0;
    let body: unknown;
    try {
      const response = await fetch(url);
      status = response.status;
      body = await response.json();
    } catch {
      throw new Error(
        `JWKS_URL is not reachable (project ${PROJECT_REF ?? '?'}). withAuth builds\n` +
          `createRemoteJWKSet(JWKS_URL) and verifies EVERY user JWT against it.\n` +
          `CONSEQUENCE: all 11 user-JWT routes return 401 — the app is entirely unusable while\n` +
          `still looking deployed.\n` +
          `FIX: JWKS_URL must be the project's asymmetric JWKS endpoint, typically\n` +
          `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json (network-reachable from the\n` +
          `Edge runtime, no trailing path typo).`,
      );
    }
    expect(status, `JWKS_URL returned HTTP ${status}, not 200. See A.2a's fix note.`).toBe(200);
    // parse-don't-cast: the JWKS document goes through a schema, never a cast.
    expect(() => parseBoundary(JwksDocument, body, 'preflight.jwks')).not.toThrow();
  });

  it.skipIf(!present(USER_A_JWT))(
    'A.2b the PRODUCTION verifier (makeJwksVerifier) accepts a real user token and yields a uuid sub',
    async () => {
      // End-to-end over the exact production seam, not a hand-rolled fetch: proves
      // createRemoteJWKSet + jwtVerify + the strict Uuid sub parse all work here.
      const verifier = makeJwksVerifier();
      const { sub } = await verifier.verify(USER_A_JWT ?? '');
      expect(() => parseBoundary(Uuid, sub, 'preflight.jwt.sub')).not.toThrow();
    },
  );
});

// ─── A.3 — the migration set is fully applied, in order ──────────────────────
async function migrationNamesOnDisk(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  // node-pg-migrate records `basename(file, extname(file))`, e.g. `0001_substrate`.
  return entries
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

describe.skipIf(!CAN_RUN_LEDGER)('A.3 the deployed migration ledger matches the numbered files on disk', () => {
  let ledgerPool: Pool;
  let applied: string[];
  let onDisk: string[];

  beforeAll(async () => {
    ledgerPool = new Pool({ connectionString: SERVICE_URL });
    onDisk = await migrationNamesOnDisk();
    // node-pg-migrate's default ledger is public.pgmigrations, ordered by id.
    const { rows } = await ledgerPool.query<{ name: string }>(
      'SELECT name FROM public.pgmigrations ORDER BY id',
    );
    applied = rows.map((row) => row.name);
  }, 60_000);

  afterAll(async () => {
    await ledgerPool?.end().catch(() => undefined);
  });

  it('A.3a every numbered migration on disk is applied, and nothing extra is', () => {
    const unapplied = onDisk.filter((name) => !applied.includes(name));
    const unknown = applied.filter((name) => !onDisk.includes(name));
    expect(
      { unapplied, unknown, appliedCount: applied.length, onDiskCount: onDisk.length },
      `The deployed schema does not match packages/db/migrations/ (project ${PROJECT_REF ?? '?'}).\n` +
        `NOT APPLIED: ${unapplied.join(', ') || '(none)'}\n` +
        `IN LEDGER BUT NOT ON DISK: ${unknown.join(', ') || '(none)'}\n` +
        `CONSEQUENCE of a half-applied deploy: a table, policy, grant, or SECURITY DEFINER\n` +
        `function the handlers require is simply absent, so the affected route 500s on first\n` +
        `real use — discovered by a user, not by the deploy.\n` +
        `FIX: re-run the migrate step of docs/DEPLOY-RUNBOOK.md with DATABASE_URL SOURCED from\n` +
        `the gitignored .env.migrate (never cat it):  set -a; . ./.env.migrate; set +a; pnpm db:migrate`,
    ).toEqual({ unapplied: [], unknown: [], appliedCount: onDisk.length, onDiskCount: onDisk.length });
  });

  it('A.3b the ledger is a strict lexical PREFIX of the files on disk (no out-of-order gap)', () => {
    // node-pg-migrate's own checkOrder throws "Not run migration X is preceding
    // already run migration Y" if a lower-numbered file appears after a higher one
    // has already run. That HARD-FAILS the next `pnpm db:migrate`, mid-deploy.
    const expectedPrefix = onDisk.slice(0, applied.length);
    expect(
      applied,
      `The applied migrations are not a prefix of the on-disk sequence (project ` +
        `${PROJECT_REF ?? '?'}). A lower-numbered migration file exists that was never run, ` +
        `while a higher-numbered one already has.\n` +
        `CONSEQUENCE: the NEXT \`pnpm db:migrate\` aborts with node-pg-migrate's\n` +
        `"Not run migration <lower> is preceding already run migration <higher>" and applies\n` +
        `nothing — the deploy stalls with the schema half-migrated.\n` +
        `FIX: renumber the straggler above the highest applied migration (never edit a landed\n` +
        `migration — append a new numbered file).`,
    ).toEqual(expectedPrefix);
  });
});

// ─── A.4 — every deployed route answers with the HANDLER 401, not the gateway 401 ──
// The live counterpart to A.0. A bad bearer token must produce withAuth's envelope
// ({error:{code:'unauthorized'}}). The gateway's own rejection has a different shape
// ({code:401,message:'Invalid JWT'}), which proves verify_jwt was left ON.
const HandlerErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

describe.skipIf(!CAN_RUN_ROUTES)('A.4 deployed routes are guarded by withAuth, not the Supabase gateway', () => {
  let routes: string[];

  beforeAll(async () => {
    routes = await shimRoutes();
  });

  it('every route rejects a bad bearer token with the HANDLER’s unauthorized envelope', async () => {
    const base = (FUNCTIONS_BASE_URL ?? '').replace(/\/$/, '');
    const gatewayGuarded: string[] = [];
    const unreachable: string[] = [];
    for (const route of routes) {
      // A deliberately invalid token: no write can occur on any route, on either
      // path — withAuth rejects before the handler, and the webhook's constant-time
      // secret compare rejects before it creates an executor.
      const response = await fetch(`${base}/${route}`, {
        method: 'POST',
        headers: { authorization: 'Bearer preflight-not-a-real-token', 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => undefined);
      if (response === undefined) {
        unreachable.push(route);
        continue;
      }
      const body: unknown = await response.json().catch(() => undefined);
      const parsed = HandlerErrorEnvelope.safeParse(body);
      if (response.status !== 401 || !parsed.success || parsed.data.error.code !== 'unauthorized') {
        gatewayGuarded.push(`${route} (HTTP ${response.status})`);
      }
    }
    expect(
      unreachable,
      `Routes not reachable at PREFLIGHT_FUNCTIONS_BASE_URL (project ${PROJECT_REF ?? '?'}): ` +
        `${unreachable.join(', ')}.\n` +
        `CONSEQUENCE: the feature behind each is simply missing in production.\n` +
        `FIX: deploy them (\`supabase functions deploy <route>\`) and confirm\n` +
        `PREFLIGHT_FUNCTIONS_BASE_URL is https://<ref>.supabase.co/functions/v1.`,
    ).toEqual([]);
    expect(
      gatewayGuarded,
      `These routes did NOT answer with withAuth's 401 envelope: ${gatewayGuarded.join(', ')}.\n` +
        `A non-401, or a 401 whose body is not {"error":{"code":"unauthorized",...}}, means the\n` +
        `SUPABASE GATEWAY rejected the request before our handler ran — i.e. verify_jwt was left\n` +
        `ON for that function (see A.0).\n` +
        `CONSEQUENCE: the gateway verifies with a shared secret while our tokens are asymmetric,\n` +
        `so every REAL request to those routes 401s too. Account deletion (App Store 5.1.1(v)),\n` +
        `data export (GDPR Art. 15), and the paywall's entitlement read are the routes most\n` +
        `likely to be missed, because nothing else in the suite touches the gateway.\n` +
        `FIX: add \`verify_jwt = false\` for each in supabase/config.toml and redeploy (or deploy\n` +
        `with --no-verify-jwt).`,
    ).toEqual([]);
  }, 120_000);
});

// ─── B.1 — TRAP B: Storage RLS binds to the requester's sub ──────────────────
// The genuinely external oracle for the privacy invariant's storage half: the
// Supabase Storage service, not our code. docs/06 §6 requires the policy to compare
// (storage.foldername(name))[1] = auth.uid()::text, include a bucket_id predicate,
// and cover read AND write on BOTH buckets. The SQL lands in migration 0013 (authored
// separately — this file must not write it); B.1 is its proof.
interface StorageProbe {
  put(bucket: string, path: string, jwt: string): Promise<number>;
  get(bucket: string, path: string, jwt: string): Promise<number>;
  remove(bucket: string, path: string, jwt: string): Promise<number>;
}

// Raw Storage REST rather than supabase-js: the HTTP boundary is the thinnest
// possible oracle (no client-library retry/normalisation between us and the policy),
// and it adds no dependency to this package.
function storageProbe(baseUrl: string, anonKey: string): StorageProbe {
  const objectUrl = (bucket: string, path: string): string =>
    `${baseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path}`;
  const headers = (jwt: string): Record<string, string> => ({
    authorization: `Bearer ${jwt}`,
    apikey: anonKey,
  });
  return {
    async put(bucket, path, jwt) {
      const response = await fetch(objectUrl(bucket, path), {
        method: 'POST',
        headers: { ...headers(jwt), 'content-type': 'application/octet-stream' },
        body: new Uint8Array([0x70, 0x66, 0x6c, 0x74]),
      });
      return response.status;
    },
    async get(bucket, path, jwt) {
      const response = await fetch(objectUrl(bucket, path), { method: 'GET', headers: headers(jwt) });
      return response.status;
    },
    async remove(bucket, path, jwt) {
      const response = await fetch(objectUrl(bucket, path), { method: 'DELETE', headers: headers(jwt) });
      return response.status;
    },
  };
}

const ok = (status: number): boolean => status >= 200 && status < 300;
const refused = (status: number): boolean => status === 400 || status === 401 || status === 403 || status === 404;

describe.skipIf(!CAN_RUN_STORAGE)('B.1 TRAP B — Storage RLS binds the path prefix to the requester’s sub', () => {
  let probe: StorageProbe;
  let subA: string;
  let subB: string;

  beforeAll(async () => {
    probe = storageProbe(SUPABASE_URL ?? '', ANON_KEY ?? '');
    // The prefixes come from the VERIFIED subs, not from a config value — the whole
    // property under test is "the policy binds to the token's sub", so the test must
    // derive the prefix the same way the policy does.
    const verifier = makeJwksVerifier();
    const verifiedA = await verifier.verify(USER_A_JWT ?? '');
    const verifiedB = await verifier.verify(USER_B_JWT ?? '');
    subA = parseBoundary(Uuid, verifiedA.sub, 'preflight.userA.sub');
    subB = parseBoundary(Uuid, verifiedB.sub, 'preflight.userB.sub');
    expect(subA, 'PREFLIGHT_USER_A_JWT and PREFLIGHT_USER_B_JWT must be DIFFERENT users.').not.toBe(subB);
  }, 60_000);

  for (const bucket of BYTE_BUCKETS) {
    describe(`bucket ${bucket}`, () => {
      const ownA = (): string => `${subA}/preflight/a.bin`;
      const ownB = (): string => `${subB}/preflight/b.bin`;
      const crossWrite = (): string => `${subB}/preflight/a-should-not-write-here.bin`;

      afterAll(async () => {
        // Each owner removes only its own objects; a failed cleanup is reported by
        // the next run's own-write step rather than swallowed into a false green.
        await probe?.remove(bucket, ownA(), USER_A_JWT ?? '').catch(() => undefined);
        await probe?.remove(bucket, ownB(), USER_B_JWT ?? '').catch(() => undefined);
        await probe?.remove(bucket, crossWrite(), USER_B_JWT ?? '').catch(() => undefined);
      });

      it(`each user CAN write + read under their OWN ${bucket} prefix`, async () => {
        const writeA = await probe.put(bucket, ownA(), USER_A_JWT ?? '');
        const writeB = await probe.put(bucket, ownB(), USER_B_JWT ?? '');
        expect(
          [writeA, writeB].every(ok),
          `A user cannot write under their own ${bucket}/{sub}/ prefix (A=${writeA}, B=${writeB}).\n` +
            `CONSEQUENCE: the app cannot upload approved photos or store cutouts at all — the\n` +
            `entire parse loop fails after the user has already approved a photo.\n` +
            `FIX: the ${bucket} bucket must exist and be PRIVATE, and its INSERT policy on\n` +
            `storage.objects must allow (storage.foldername(name))[1] = auth.uid()::text with a\n` +
            `bucket_id = '${bucket}' predicate (docs/06 §6; SQL lands in migration 0013).`,
        ).toBe(true);
        const readA = await probe.get(bucket, ownA(), USER_A_JWT ?? '');
        expect(ok(readA), `A cannot read its own ${bucket} object back (HTTP ${readA}).`).toBe(true);
      });

      it(`user A CANNOT READ an object that exists under user B’s ${bucket} prefix`, async () => {
        // The discriminator: B reads it successfully first, so a refusal for A cannot
        // be explained away as "the object isn't there".
        const ownerRead = await probe.get(bucket, ownB(), USER_B_JWT ?? '');
        expect(
          ok(ownerRead),
          `Setup invalid: B cannot read its own ${bucket} object (HTTP ${ownerRead}), so a refusal\n` +
            `for A would prove nothing. Fix the own-prefix policy first.`,
        ).toBe(true);
        const crossRead = await probe.get(bucket, ownB(), USER_A_JWT ?? '');
        expect(
          refused(crossRead),
          `PRIVACY BREACH — user A READ user B's ${bucket} object (HTTP ${crossRead}).\n` +
            `Storage RLS on storage.objects is the ONLY control preventing cross-user byte reads\n` +
            `(docs/06 §6). Path obscurity is never the control.\n` +
            `CONSEQUENCE: any authenticated user can read any other user's approved photos and\n` +
            `garment cutouts. This voids the app's defining privacy invariant and the retention\n` +
            `promises in docs/legal/privacy-policy.md.\n` +
            `FIX: the SELECT policy must compare (storage.foldername(name))[1] = auth.uid()::text\n` +
            `(the ::text cast is mandatory) AND include bucket_id = '${bucket}'.`,
        ).toBe(true);
      });

      it(`user A CANNOT WRITE under user B’s ${bucket} prefix (graded by B, not by A’s response)`, async () => {
        const crossWriteStatus = await probe.put(bucket, crossWrite(), USER_A_JWT ?? '');
        // THE RESPONSE IS NEVER THE ORACLE: ask the prefix's OWNER whether anything landed.
        const ownerSees = await probe.get(bucket, crossWrite(), USER_B_JWT ?? '');
        expect(
          refused(crossWriteStatus) && !ok(ownerSees),
          `PRIVACY / INTEGRITY BREACH — user A wrote an object under user B's ${bucket} prefix ` +
            `(write HTTP ${crossWriteStatus}; owner B's read of it: HTTP ${ownerSees}).\n` +
            `CONSEQUENCE: one user can plant bytes inside another user's wardrobe namespace —\n` +
            `arbitrary images appear in a stranger's closet, and the "cloud only ever sees\n` +
            `user-approved photos" guarantee no longer holds per-user.\n` +
            `FIX: the INSERT/UPDATE policies must bind (storage.foldername(name))[1] to\n` +
            `auth.uid()::text with a bucket_id = '${bucket}' predicate, covering WRITE as well as\n` +
            `READ on BOTH buckets (docs/06 §6).`,
        ).toBe(true);
      });
    });
  }
});
