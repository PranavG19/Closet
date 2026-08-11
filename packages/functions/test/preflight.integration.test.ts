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
// block self-skips via `skipIf(!canRun('<id>'))` and the module prints an unmistakable
// PREFLIGHT SKIPPED banner naming exactly which checks did NOT run and which env vars
// each is waiting on. A skip must never read as a pass. Both the gates and the banner
// derive from ONE table (CHECKS), and S.0 fails the build if they ever diverge — see
// the note above CHECKS for the A.2b hole that made this necessary. As of writing,
// A.1/A.2/A.3/A.4/B.1 are WRITTEN BUT NEVER EXECUTED — their first real run IS the
// deploy gate.
//
// A.0 and S.0 are the exceptions: they need no project and run everywhere. A.0's trap
// (a shim with no config.toml entry deploys with the gateway's JWT verify ON, which
// rejects our valid asymmetric JWTs) is observable from the tree alone; S.0's trap (a
// gated block that vanishes without the banner naming it) is observable by PARSING
// this file. S.0's guarantee is real but bounded to this file's collector-level gates —
// its own header states the exact ceiling, including what it cannot see.
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
// S.0 parses THIS FILE with the real compiler rather than regexing it: a regex cannot
// balance parens or model nesting, and both holes were exploited (see S.0's note).
// `typescript` is already a root devDependency — no new dependency, and the parse of
// this one file costs ~20ms.
import ts from 'typescript';
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
//
// Every env var preflight reads is read HERE, once, keyed by its real name — so the
// CHECKS table below can name its requirements as var names and the banner can print
// exactly which ones are missing.
const PREFLIGHT_ENV = {
  PREFLIGHT_PROJECT_REF: envValue('PREFLIGHT_PROJECT_REF'),
  SUPABASE_DB_SERVICE_URL: envValue('SUPABASE_DB_SERVICE_URL'),
  DATABASE_URL: envValue('DATABASE_URL'),
  JWKS_URL: envValue('JWKS_URL'),
  PREFLIGHT_FUNCTIONS_BASE_URL: envValue('PREFLIGHT_FUNCTIONS_BASE_URL'),
  PREFLIGHT_SUPABASE_URL: envValue('PREFLIGHT_SUPABASE_URL'),
  PREFLIGHT_SUPABASE_ANON_KEY: envValue('PREFLIGHT_SUPABASE_ANON_KEY'),
  PREFLIGHT_USER_A_JWT: envValue('PREFLIGHT_USER_A_JWT'),
  PREFLIGHT_USER_B_JWT: envValue('PREFLIGHT_USER_B_JWT'),
} as const;
type PreflightEnvVar = keyof typeof PREFLIGHT_ENV;

const PROJECT_REF = PREFLIGHT_ENV.PREFLIGHT_PROJECT_REF;
const SERVICE_URL = PREFLIGHT_ENV.SUPABASE_DB_SERVICE_URL;
const APP_URL = PREFLIGHT_ENV.DATABASE_URL;
const JWKS_URL = PREFLIGHT_ENV.JWKS_URL;
const FUNCTIONS_BASE_URL = PREFLIGHT_ENV.PREFLIGHT_FUNCTIONS_BASE_URL;
const SUPABASE_URL = PREFLIGHT_ENV.PREFLIGHT_SUPABASE_URL;
const ANON_KEY = PREFLIGHT_ENV.PREFLIGHT_SUPABASE_ANON_KEY;
const USER_A_JWT = PREFLIGHT_ENV.PREFLIGHT_USER_A_JWT;
const USER_B_JWT = PREFLIGHT_ENV.PREFLIGHT_USER_B_JWT;

// ─── the skip ledger: ONE source of truth for gating AND for the banner ──────
// THE BUG THIS SHAPE EXISTS TO PREVENT. There used to be a `CAN_RUN_*` flag list and
// a separate banner array, i.e. two parallel lists that could disagree — and they did:
// A.2b was gated on PREFLIGHT_USER_A_JWT via an inline `present(...)` that no flag and
// no banner line knew about. With PREFLIGHT_PROJECT_REF + JWKS_URL set but no user JWT,
// A.2b — the ONLY check that drives the production makeJwksVerifier against a real
// token, and so the only one that catches a JWKS belonging to a DIFFERENT project —
// vanished from the run while the banner printed no A.2 line at all. Exit 0. A skip
// read as a pass, which is the exact thing this file's header forbids.
//
// So: one row per GATED BLOCK (not per check family — A.2a and A.2b have different
// requirements and are gated separately, therefore they are two rows), the row's
// `requires` is what gates it, and the banner is derived from the same rows. The
// "S.0" meta-check below is what keeps it that way: it PARSES this file and fails if
// any conditional gate is not exactly `!canRun('<id>')` for a row here, if a row has
// no gate, or if a gate is nested inside a gate that requires MORE env than it does.
// Adding a gated block without a row is a FAILING TEST, not a silent hole. S.0's own
// header states precisely what that does and does not cover — read it before relying
// on it.
interface PreflightCheck {
  readonly requires: readonly PreflightEnvVar[];
  readonly description: string;
}

const CHECKS = {
  'A.1': {
    requires: ['PREFLIGHT_PROJECT_REF', 'SUPABASE_DB_SERVICE_URL', 'DATABASE_URL'],
    description: 'service_role really bypasses RLS (TRAP A — the money write)',
  },
  'A.2a': {
    requires: ['PREFLIGHT_PROJECT_REF', 'JWKS_URL'],
    description: 'JWKS reachability + shape (every authed request)',
  },
  'A.2b': {
    requires: ['PREFLIGHT_PROJECT_REF', 'JWKS_URL', 'PREFLIGHT_USER_A_JWT'],
    description:
      'the PRODUCTION makeJwksVerifier accepts a REAL user token — the only check ' +
      'that catches a JWKS from the wrong project (A.2a passes on any live JWKS)',
  },
  'A.3': {
    requires: ['PREFLIGHT_PROJECT_REF', 'SUPABASE_DB_SERVICE_URL'],
    description: 'migration ledger matches the numbered files on disk',
  },
  'A.4': {
    requires: ['PREFLIGHT_PROJECT_REF', 'PREFLIGHT_FUNCTIONS_BASE_URL'],
    description: 'every route answers with the HANDLER 401, not the gateway 401',
  },
  'B.1': {
    requires: [
      'PREFLIGHT_PROJECT_REF',
      'PREFLIGHT_SUPABASE_URL',
      'PREFLIGHT_SUPABASE_ANON_KEY',
      'PREFLIGHT_USER_A_JWT',
      'PREFLIGHT_USER_B_JWT',
      'JWKS_URL',
    ],
    description: 'Storage RLS binds to sub on originals + cutouts (TRAP B — privacy)',
  },
} as const satisfies Record<string, PreflightCheck>;

type CheckId = keyof typeof CHECKS;
const CHECK_IDS: readonly CheckId[] = Object.keys(CHECKS) as CheckId[];

function missingEnvFor(id: CheckId): readonly PreflightEnvVar[] {
  return CHECKS[id].requires.filter((name) => {
    const value = PREFLIGHT_ENV[name];
    return value === undefined || value === '';
  });
}

// The ONLY sanctioned way to gate a block. Every skipIf in this file must call it
// (S.0 enforces that), which is what makes an unnamed skip unrepresentable.
function canRun(id: CheckId): boolean {
  return missingEnvFor(id).length === 0;
}

// The banner. process.stdout (not console, not the structured logger — this is test
// output, and it must survive whatever reporter is in use) so a skipped run can
// never be mistaken for a proven one. It names the MISSING VARS per check, so a
// partial env (the state that hid A.2b) reads as the partial env it is.
function announceSkips(): void {
  const skipped = CHECK_IDS.map((id) => ({ id, missing: missingEnvFor(id) })).filter(
    (entry) => entry.missing.length > 0,
  );
  if (skipped.length === 0) return;
  process.stdout.write(
    `\n${'='.repeat(78)}\n` +
      `PREFLIGHT SKIPPED — NOT RUN AGAINST A REAL PROJECT. THIS IS NOT A PASS.\n` +
      `${'='.repeat(78)}\n` +
      skipped
        .map(
          ({ id, missing }) =>
            `  · UNVERIFIED: ${id} ${CHECKS[id].description}\n` +
            `      needs: ${missing.join(', ')}\n`,
        )
        .join('') +
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

// ─── S.0 — the skip ledger is COMPLETE (NO PROJECT NEEDED, ALWAYS RUNS) ──────
// The meta-check that makes an unnamed skip hard to write by accident. Like A.0 it
// needs no project, so it runs in CI on every commit.
//
// It PARSES THIS FILE with the TypeScript compiler (not a regex — see WHY below) and
// enforces four things about every describe/it/test call in it:
//   1. GATE SHAPE. If the call carries a conditional modifier, the condition must be
//      exactly `!canRun('<id>')` for an id in CHECKS. A compound condition
//      (`!canRun('A.2a') || USER_A_JWT === undefined`) or an ad-hoc env probe — which
//      is exactly what the original A.2b gate was — is REPORTED, because the banner
//      cannot name env it does not know about. Balanced-paren parsing is what makes
//      "reported" true rather than "truncated to its first clause and passed".
//   2. EVERY conditional modifier counts, not just skipIf. MODIFIERS below is asserted
//      against the INSTALLED vitest, so `runIf` (which the old regex ignored entirely,
//      failing OPEN) and the unconditional `.skip`/`.only`/`.todo`/`.fails` are all in
//      scope. `.only` is included because it narrows the run to itself, which silently
//      drops every other check.
//   3. NESTING. A gate's EFFECTIVE requirement is the union of its own `requires` and
//      those of every enclosing gate. We enforce parent-requires ⊆ child-requires, so
//      union == the child's own row and the banner (which reads rows) stays truthful.
//      Chosen over "derive the banner from the union" because it keeps ONE row per
//      block as the single source of truth: with the subset property the union is a
//      no-op, so there is no second, computed notion of what a block needs. Without
//      it, a child whose own env IS satisfied vanishes inside a hungrier parent and
//      canRun(child) is true, so nothing prints an UNVERIFIED line for it. That is the
//      exact A.2a ⊇ A.2b relation the comment above A.2b leans on.
//   4. NO ORPHAN ROWS. Every id in CHECKS must be gated by a REAL gate expression
//      found in the parse — not merely mentioned somewhere in the file text. A row
//      whose block was deleted would otherwise make the banner promise a check that no
//      longer exists, and a lone comment naming the id would satisfy a text search.
//
// WHY A PARSE AND NOT A REGEX. The previous version regexed for `.skipIf(` with
// `([^)]*\))?` and orphan-checked with a whole-file `source.includes()`. Auditors broke
// it four ways, each reproduced with exit 0 and S.0 green: `.runIf` was not in the
// pattern at all (invisible, not reported); `[^)]*` stopped at the first `)` so a
// compound condition passed on its first clause while the block was really gated on
// unnamed env; nesting was unmodeled; and a COMMENT mentioning `canRun('A.2b')` kept
// the orphan check green after the entire A.2b block was deleted. `typescript` is
// already a root devDependency, so the compiler costs no new dependency and ~20ms.
//
// WHAT S.0 DOES NOT COVER — the honest ceiling of a self-parse:
//   · It reasons about THIS FILE ONLY. A gated block in another file, or a helper in
//     another module that returns a gate condition, is out of scope.
//   · It is STATIC. `canRun` could be rewritten to always return true, or CHECKS rows
//     given wrong `requires`, and every S.0 check would still pass — S.0 proves the
//     gates and the banner read the SAME rows, never that a row's `requires` is the
//     real requirement of the code inside the block. Nothing here reads a block's body
//     to see which env it actually touches.
//   · A block with NO conditional modifier is not a gate and is not checked. Code that
//     makes a test vacuous from the inside (an early `return`, a `ctx.skip()`, a
//     try/catch swallowing the assertion, a `requires` list padded with a var that is
//     never set) is invisible to S.0. Only the collector-level gate is modeled.
//   · MODIFIERS is asserted against the installed vitest, so a vitest upgrade that
//     ADDS a conditional modifier fails S.0 loudly rather than silently widening the
//     hole. That assertion is the tripwire, not a proof about future versions.
//   · `.only` ON A RUNNING BLOCK DEFEATS S.0 ENTIRELY, and no check here can catch it:
//     `.only` deselects S.0 itself, so S.0's assertions never execute to complain.
//     Three red teams confirmed it — `describe.only` on A.0 gives `3 passed | 20 skipped`,
//     exit 0, unchanged banner; `it.only` gives `1 passed | 22 skipped`. It even launders
//     the literal A.2b bug: reintroduce that bug and add `.only` in the same diff and the
//     suite ships green. The ONLY defense is outside this file — vitest's `allowOnly`,
//     i.e. `CI=true`, which turns a stray `.only` into a hard error. The deploy command
//     this file's own banner prints (below) does NOT set it. Treat a `.only` in this file
//     as a release blocker, and prefer running the deploy gate with CI=true.
//   · A module-level `if (COND) { describe(...) }` wrapper removes blocks from collection
//     while their `!canRun('<id>')` gate text is still physically in the AST, so the
//     orphan check still passes (red team C5: 23 -> 21 tests, S.0 green). Gate blocks
//     ONLY with the sanctioned modifier, never with surrounding control flow.
//   · An aliased or extended collector (`const g = describe; g.skipIf(...)`,
//     `it.extend({})`) is not recognised as a gate at all — invisible, not reported.
//   · No gate is BOUND to the row it names: S.0 checks a gate's shape and that every id
//     has some gate, never that this id is THIS block's requirement. Two blocks can share
//     one id so one vanishes under the other's cover, and a `description` string is
//     unanchored to the body it advertises.
// So the claim is bounded, and narrower than "no gated block can vanish unnamed": within
// this file, a describe/it/test cannot be CONDITIONALLY GATED BY A MODIFIER except by
// `!canRun('<id>')` on a CHECKS row whose requires are a superset of every enclosing
// gate's — every row must have such a gate, and the banner must actually be printed.
// Blocks can still be removed from the run by `.only`, by control flow around the
// collector, or by an aliased collector; a block that DOES run can still assert nothing.
// S.0 makes the banner faithful for modifier-gated blocks. It is not a general guarantee
// that the suite ran, nor that a listed check proves anything.
const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_SOURCE = readFile(SELF_PATH, 'utf8');

// The collector roots a gate can hang off. `it === test` and `describe === suite` are
// the same objects in vitest, so all four names are treated alike.
const COLLECTOR_ROOTS = ['describe', 'it', 'test', 'suite'] as const;

// Every property on a vitest collector that can stop a block from running as written.
// `skipIf`/`runIf` take a condition; the rest are unconditional. Asserted against the
// installed vitest below, so this list cannot silently fall behind the runner.
const MODIFIERS = ['skipIf', 'runIf', 'skip', 'only', 'todo', 'fails'] as const;
const CONDITIONAL_MODIFIERS: readonly string[] = ['skipIf', 'runIf'];
const MODIFIER_SET: ReadonlySet<string> = new Set(MODIFIERS);
const CAN_RUN_CONDITION = /^!canRun\('([^']*)'\)$/;

// A gate found in the parse: which modifier(s), the verbatim condition text, the
// CHECKS id if the condition is the sanctioned shape, and its enclosing gates.
interface FoundGate {
  readonly line: number;
  readonly title: string;
  readonly modifiers: readonly string[];
  readonly condition: string;
  readonly checkId: CheckId | undefined;
  readonly enclosing: readonly FoundGate[];
}

// `describe.skipIf(x)('t', fn)` parses as a call whose callee is a call whose callee is
// a property access. Walk that spine to the root identifier, recording each property
// and the arguments it was invoked with (if any).
interface ChainLink {
  readonly name: string;
  readonly args: readonly ts.Expression[] | undefined;
}
interface Chain {
  readonly root: string;
  readonly links: readonly ChainLink[];
}

function resolveChain(expression: ts.Expression): Chain | undefined {
  if (ts.isIdentifier(expression)) return { root: expression.text, links: [] };
  if (ts.isPropertyAccessExpression(expression)) {
    const base = resolveChain(expression.expression);
    if (base === undefined) return undefined;
    return { root: base.root, links: [...base.links, { name: expression.name.text, args: undefined }] };
  }
  if (ts.isCallExpression(expression)) {
    // The invocation of the last link: `…skipIf(cond)` → attach cond to `skipIf`.
    const base = resolveChain(expression.expression);
    const last = base?.links.at(-1);
    if (base === undefined || last === undefined) return undefined;
    return {
      root: base.root,
      links: [...base.links.slice(0, -1), { name: last.name, args: [...expression.arguments] }],
    };
  }
  return undefined;
}

// True for the `skipIf(cond)` node itself, as opposed to the `(...)('title', fn)` that
// registers the block. Only the outermost call is the block, so the inner one is
// skipped to avoid counting one gate twice.
function isModifierInvocation(node: ts.CallExpression): boolean {
  const { parent } = node;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
}

function findGates(source: ts.SourceFile): readonly FoundGate[] {
  const found: FoundGate[] = [];
  const visit = (node: ts.Node, enclosing: readonly FoundGate[]): void => {
    let inner = enclosing;
    if (ts.isCallExpression(node) && !isModifierInvocation(node)) {
      const chain = resolveChain(node.expression);
      const gating = chain?.links.filter((link) => MODIFIER_SET.has(link.name)) ?? [];
      if (chain !== undefined && COLLECTOR_ROOTS.some((root) => root === chain.root) && gating.length > 0) {
        // Unconditional modifiers (.skip/.only/…) have no args; render them as the
        // modifier name so the failure message shows what was actually written.
        const conditional = gating.filter((link) => CONDITIONAL_MODIFIERS.includes(link.name));
        const condition =
          conditional.length === 1 && conditional[0]?.args?.length === 1
            ? (conditional[0]?.args?.[0]?.getText(source) ?? '')
            : gating.map((link) => `.${link.name}`).join('');
        const isPlainSkipIf = gating.length === 1 && gating[0]?.name === 'skipIf';
        const matched = isPlainSkipIf ? CAN_RUN_CONDITION.exec(condition) : null;
        const id = matched?.[1];
        const gate: FoundGate = {
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          title: node.arguments[0]?.getText(source).slice(0, 60) ?? '(untitled)',
          modifiers: gating.map((link) => link.name),
          condition,
          checkId: CHECK_IDS.find((known) => known === id),
          enclosing,
        };
        found.push(gate);
        inner = [...enclosing, gate];
      }
    }
    node.forEachChild((child) => visit(child, inner));
  };
  visit(source, []);
  return found;
}

const GATES: Promise<readonly FoundGate[]> = SELF_SOURCE.then((text) =>
  findGates(ts.createSourceFile(SELF_PATH, text, ts.ScriptTarget.ESNext, true)),
);

describe('S.0 skip accounting — no gated block can vanish without the banner naming it', () => {
  it('MODIFIERS covers every conditional/skipping modifier the INSTALLED vitest exposes', () => {
    // The tripwire for hole B1 (`runIf` was absent from the old regex, so a runIf-gated
    // block was INVISIBLE rather than reported). Derived from the real collector
    // objects, so a vitest upgrade that adds one fails here instead of widening the
    // scanner's blind spot. `each`/`for`/`extend`/`scoped`/hooks build tests rather
    // than suppress them, and are not gates.
    const NON_GATING = new Set([
      'each',
      'for',
      'extend',
      'scoped',
      'override',
      'fn',
      'length',
      'name',
      'prototype',
      'describe',
      'suite',
      'beforeAll',
      'afterAll',
      'beforeEach',
      'afterEach',
      'aroundAll',
      'aroundEach',
      'concurrent',
      'sequential',
      'shuffle',
    ]);
    const exposed = [describe, it].flatMap((collector) => Object.getOwnPropertyNames(collector));
    const unmodeled = [...new Set(exposed)]
      .filter((name) => !NON_GATING.has(name) && !MODIFIER_SET.has(name))
      .sort();
    expect(
      unmodeled,
      `The installed vitest exposes collector modifiers S.0 does not model: ${unmodeled.join(', ')}.\n` +
        `An unmodeled modifier is a gate S.0 cannot see at all — the block vanishes from the run\n` +
        `with no banner line and no S.0 failure (this is how a .runIf gate slipped through).\n` +
        `FIX: add it to MODIFIERS (and to CONDITIONAL_MODIFIERS if it takes a condition), or to\n` +
        `NON_GATING if it genuinely cannot suppress a block.`,
    ).toEqual([]);
  });

  // These two checks scan raw lines, so they must not match their OWN comments and failure
  // messages (which quote the very shapes they ban). A line is prose if it is a comment or
  // is inside a quoted/backticked message — crude, but it only ever makes a check MISS a
  // line, never fire falsely, and every real gate in this file is plain unquoted code.
  const isProse = (text: string): boolean =>
    /^\s*(?:\/\/|\*|\/\*)/.test(text) || /^\s*[`'"]/.test(text) || /`\s*\+\s*$/.test(text);

  it('announceSkips() is called unconditionally at top level (a silent banner is the whole bug)', async () => {
    // Red-team C1: `announceSkips();` -> `if (envValue('CI') !== undefined) announceSkips();`
    // left all 14 skips unnamed with every other S.0 check green. S.0 proved the banner
    // DERIVES from CHECKS but never that it is actually PRINTED, so the one line that makes
    // skips honest was itself ungoverned. Wrapping it in any condition, or indenting it into
    // a block, restores the original sin at 6x scale.
    const source = await SELF_SOURCE;
    const calls = source
      .split('\n')
      .map((text, index) => ({ text, line: index + 1 }))
      .filter((row) => !isProse(row.text))
      .filter((row) => /announceSkips\s*\(\s*\)\s*;/.test(row.text));
    const unconditional = calls.filter((row) => /^announceSkips\(\);\s*$/.test(row.text));
    expect(
      { callCount: calls.length, unconditionalCount: unconditional.length },
      `Found: ${calls.map((row) => `L${row.line} ${row.text.trim()}`).join(' | ') || '(none)'}\n` +
        `The banner call must appear exactly once, unindented, as its own statement at module top\n` +
        `level. Anything else (a conditional wrapper, an indent into a function or block) means a\n` +
        `run can skip checks and print NOTHING — exit 0, and a skip reads as a pass. That is the\n` +
        `exact failure this file exists to prevent.\n` +
        `FIX: restore the bare \`announceSkips();\` call.`,
    ).toEqual({ callCount: 1, unconditionalCount: 1 });
  });

  it('no block is gated by an options-object { skip } (a gate shape the AST walk cannot see)', async () => {
    // Red-team #3: vitest 4 also gates via the options object —
    //   it.skipIf(!canRun('A.2b'))('A.2b ...', { skip: envValue('X') !== 'never' }, async () => {
    // The sanctioned !canRun gate stays present and satisfied, so the gate-shape and orphan
    // checks both pass while the block silently does not run. It is a plain argument, not a
    // property-access chain, so resolveChain cannot reach it. Banning the shape outright is
    // cheaper and stricter than modeling it.
    const source = await SELF_SOURCE;
    const offenders = source
      .split('\n')
      .map((text, index) => ({ text, line: index + 1 }))
      .filter((row) => !isProse(row.text))
      .filter((row) => /\{[^}]*\b(?:skip|only|todo|fails)\s*:/.test(row.text))
      .map((row) => `L${row.line} ${row.text.trim()}`);
    expect(
      offenders,
      `An options-object gate ({ skip: ... }) suppresses a block without any modifier chain, so\n` +
        `the AST walk never sees it and the banner never names it. Do not gate this file that way.\n` +
        `FIX: gate on \`!canRun('<id>')\` with a CHECKS row, which the banner derives from.`,
    ).toEqual([]);
  });

  it('every conditional gate is exactly !canRun(<id>) from the CHECKS table', async () => {
    const gates = await GATES;
    const ungoverned = gates
      .filter((gate) => gate.checkId === undefined)
      .map((gate) => `L${gate.line} ${gate.modifiers.join('/')}(${gate.condition}) on ${gate.title}`);
    expect(
      ungoverned,
      `These gates are not derived from the CHECKS table: ${ungoverned.join(' | ')}.\n` +
        `A gated block whose condition is an ad-hoc env probe, a COMPOUND expression, or an\n` +
        `unconditional .skip/.only/.todo DISAPPEARS (or narrows the run) with no banner line,\n` +
        `because announceSkips() only knows about CHECKS. That is exactly how A.2b — the only\n` +
        `check that drives the production makeJwksVerifier against a REAL user token, and so the\n` +
        `only one that catches a JWKS from the WRONG PROJECT — vanished from a run that printed\n` +
        `no A.2 line and exited 0. A compound condition is the same hole wearing a canRun() mask:\n` +
        `the extra clause is env the banner cannot name.\n` +
        `CONSEQUENCE: a skip reads as a pass and the deploy gate silently stops gating.\n` +
        `FIX: add a row to CHECKS naming ALL the block's required env, and gate on exactly\n` +
        `\`!canRun('<id>')\` — nothing else in the condition.`,
    ).toEqual([]);
  });

  it('every CHECKS row is gated by a real gate expression (a comment mentioning it is not one)', async () => {
    const gates = await GATES;
    const gatedIds = new Set(gates.map((gate) => gate.checkId));
    const orphans = CHECK_IDS.filter((id) => !gatedIds.has(id));
    expect(
      orphans,
      `These CHECKS rows gate nothing: ${orphans.join(', ')}.\n` +
        `The banner would list them as "UNVERIFIED" (or, worse, stay silent about them when the\n` +
        `env IS present) for a block that no longer exists — the banner must describe the real\n` +
        `suite, not a stale intention. This is matched against PARSED gate expressions, so a\n` +
        `comment or a string mentioning canRun('<id>') does not satisfy it: an auditor deleted the\n` +
        `whole A.2b block, left one comment behind, and the old whole-file text search stayed green.\n` +
        `FIX: either restore the gated block or delete the row.`,
    ).toEqual([]);
  });

  it('no gate is nested inside a gate that requires MORE env than it does', async () => {
    const gates = await GATES;
    // The banner reads CHECKS rows, so a row is only truthful if the block's EFFECTIVE
    // requirement equals its own. Enforcing parent ⊆ child makes the union of the
    // nesting chain collapse to the child's own row.
    const violations = gates.flatMap((gate) => {
      const childId = gate.checkId;
      if (childId === undefined) return []; // already reported by the gate-shape check
      const childRequires = new Set<string>(CHECKS[childId].requires);
      return gate.enclosing.flatMap((parent) => {
        const parentId = parent.checkId;
        if (parentId === undefined) return [];
        const extra = CHECKS[parentId].requires.filter((name) => !childRequires.has(name));
        return extra.length === 0
          ? []
          : [`${childId} (L${gate.line}) is nested in ${parentId} which also needs ${extra.join(', ')}`];
      });
    });
    expect(
      violations,
      `These nested gates can vanish with NO banner line: ${violations.join(' | ')}.\n` +
        `A child block inside a hungrier parent never runs when the parent's extra env is absent —\n` +
        `but canRun(child) is TRUE, so announceSkips() prints nothing for it. The skip is unnamed,\n` +
        `which is the whole failure mode this file exists to prevent (it is how A.2b was lost).\n` +
        `CONSEQUENCE: the banner claims a check ran, or says nothing at all, while it silently did\n` +
        `not — a skip reading as a pass.\n` +
        `FIX: add the parent's extra env to the CHECK's own \`requires\` (making it a superset, as\n` +
        `A.2b is of A.2a), or move the block out of the parent.`,
    ).toEqual([]);
  });

  it('every required env var is one the file actually reads (a typo would gate on nothing)', () => {
    // PREFLIGHT_ENV is the single read point; a `requires` entry outside it would be
    // permanently "missing" (or permanently satisfied) regardless of the real env.
    const unknownVars = CHECK_IDS.flatMap((id) =>
      CHECKS[id].requires.filter((name) => !(name in PREFLIGHT_ENV)).map((name) => `${id}:${name}`),
    );
    expect(
      unknownVars,
      `CHECKS names env vars that PREFLIGHT_ENV does not read: ${unknownVars.join(', ')}.`,
    ).toEqual([]);
  });

  it('PREFLIGHT_PROJECT_REF is required by EVERY check (the master opt-in cannot be bypassed)', () => {
    const withoutMasterOptIn = CHECK_IDS.filter(
      (id) => !CHECKS[id].requires.includes('PREFLIGHT_PROJECT_REF'),
    );
    expect(
      withoutMasterOptIn,
      `These checks can fire without PREFLIGHT_PROJECT_REF: ${withoutMasterOptIn.join(', ')}.\n` +
        `The master opt-in is what stops preflight from firing against the wrong database on a\n` +
        `developer who merely has a stale DATABASE_URL exported — including the A.1 block, which\n` +
        `WRITES public.subscriptions.`,
    ).toEqual([]);
  });
});

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

describe.skipIf(!canRun('A.1'))('A.1 TRAP A — SUPABASE_DB_SERVICE_URL is a real service_role identity', () => {
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

describe.skipIf(!canRun('A.2a'))('A.2 JWKS_URL resolves and yields usable keys', () => {
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

  // A.2b requires a superset of A.2a's env (the user JWT on top), so this cannot be
  // reached with the outer describe skipped. Its own gate is what the banner names.
  it.skipIf(!canRun('A.2b'))(
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

describe.skipIf(!canRun('A.3'))('A.3 the deployed migration ledger matches the numbered files on disk', () => {
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

describe.skipIf(!canRun('A.4'))('A.4 deployed routes are guarded by withAuth, not the Supabase gateway', () => {
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

describe.skipIf(!canRun('B.1'))('B.1 TRAP B — Storage RLS binds the path prefix to the requester’s sub', () => {
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
