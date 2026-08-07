# closet-app — project instructions

Women's premium wardrobe app. Expo/React-Native, pnpm monorepo, TypeScript strict.
**Backend-first:** data + RLS + endpoints proven before UI. Supabase runtime
(Postgres + RLS FORCE + Auth + Edge Functions) + RevenueCat. Read `CONTRIBUTING.md`
for the full reference. Read `docs/decisions/ADR-*.md` before working in an area.

The product spec is `docs/00`–`03`; the operating model + phases are `docs/04`; the
test framework is `docs/05`. `docs/roadmap.md` is FUTURE — do not implement it.

## Package map

| Package | Role | Key constraint |
|---------|------|----------------|
| `packages/shared` | Zod schemas + pure fns + ports (type SSOT) | Ports live here |
| `packages/db` | Migrations + repos (ONLY DB-access seam) | No other package touches DB |
| `packages/functions` | Edge handlers → Deno shims | Thin `serveAuthed(handler)` |
| `packages/mobile` | Expo app | Colors from `useTokens()` only; imports `shared` only |

## Commands (pnpm@9.15.0 — never npm/yarn)

- `pnpm verify` — fast gate wall. Run before every commit.
- `pnpm verify:full` — full wall incl. RLS + integration (as those land). Run before declaring a wave done; writes the verify-stamp the Stop hook checks.
- `pnpm gen` — regenerate manifest/CODEOWNERS/gate-budget/eslint-roots from `conventions.json`; `verify` fails if stale.
- `pnpm -w exec tsc --build` — typecheck. `pnpm test` — vitest.
- **Always use `git grep`**, not `grep`/`rg` (NUL bytes make them silently skip lines).

## The five rules (agent-arch)

1. **ONE PASS OR DECOMPOSE.** If change + tests + verification don't fit one context window, split first.
2. **MAKE THE UNSAFE THING UNREPRESENTABLE.** Push enforcement below the app layer (DB RLS FORCE > lint/tsconfig > tests). Make bad states impossible, don't just test for them.
3. **VERIFY FROM A VANTAGE YOU CANNOT REACH.** UI = real simulator screenshot. Logic = red-first test with an oracle you didn't compute. Money = real webhook. Parse = the bench-scan corpus + metamorphic relations. Never trust a `[x]` in a doc — re-derive it. A test the same agent wrote is a mirror oracle, not verification.
4. **THE SAFE PATH IS THE FAST PATH.** Gates run affected-only in seconds. Don't ship a gate adding >10% latency; fix the tooling first.
5. **STOP on the escalation trigger:** irreversible ops, money/entitlement path, or visual output you can't observe → request human review.

## Data access + security (non-negotiable)

- **Repos are the ONLY DB path.** `supabase.from()` is lint-banned in functions/mobile (gate lands with the db package).
- **Identity from verified JWT `sub`** (via `serveAuthed`, asymmetric JWKS — no shared secret), never from a request body.
- **RLS is FORCE + default-deny on every tenant table.** `service_role` bypass only for system jobs (parse worker, webhook).
- **One tx per `query()` call.** Put atomicity inside ONE statement or ONE plpgsql function.
- **parse-don't-cast:** every DB row / request / response through its Zod schema (`parseBoundary`). No `as` casts across boundaries. Repos cast `timestamptz→::text`, `numeric→::float` in SELECT.
- **`client_id` minted by the CALLER at tap time**, not inside `mutationFn` (retries would create dup rows; a partial UNIQUE index dedups).
- **Colors from `useTokens()`, never literals** (CI gate, lands with mobile).
- **Structured logger only, not `console`** (`no-console` lint). Never log raw error messages (PII).
- **Read env via `envValue()`, never bare `process.env`.** Edge runs Deno — bare `process.env` silently yields undefined.
- **Secrets in gitignored `.env.*` — SOURCE them, never READ them.** `set -a; . ./.env.migrate; set +a; pnpm db:migrate`. The `secret-file-guard` hook enforces this.

## The privacy invariant (this app's defining constraint)

- **The on-device gate filters intimate / non-her photos BEFORE any upload.** The cloud only ever sees user-approved photos. This is ABLATE-tier privacy (you can't leak what never leaves the device) — structural, not a "please delete" promise.
- **Body geometry (try-on, roadmap only) is session-ephemeral** — no server-side body twin, no biometric identity, no bystander faces. Not built in MVP; no MVP seam may violate it.
- **Skin tone is self-identified (swatch quiz), never camera-detected.** Advisory, never prescriptive.

## Migrations + integration tests

- **node-pg-migrate** under `packages/db/migrations/`, numbered, real UP + DOWN. The ONLY way to change schema.
- **Never edit a landed migration.** Append a new numbered file.
- **Never execute destructive DDL autonomously** (DROP/TRUNCATE/narrowing) — escalation trigger; it lands in a numbered migration with a human approval token under `migrations/approvals/`. The `db-guard` hook blocks ad-hoc shell DROPs.
- **Expand/contract** for any change touching live data. Round-trip-test every DOWN on POPULATED data, never an empty fixture.
- **Tests run against the FULL applied schema** with RLS enforced; must `SET LOCAL ROLE app_user` (the container superuser bypasses RLS, so forgetting this proves nothing). Confirm with `pnpm verify:full`.

## Money / entitlement — AUTONOMY GRANTED (2026-08-06)

- **The owner has granted full permission to build, verify, commit, AND merge to main the RevenueCat/entitlement path and any other gate, until they explicitly revoke it.** There is no remote repo; the owner is the reviewer and reviews commits directly. Do NOT hold or park the money path for approval — build it, verify it hard, commit it.
- This OVERRIDES the agent-arch Rule 6 default (which would park money/entitlement for human review) and the AGENTS.md STOP list for the money path specifically. All *other* Rule-6 triggers still apply their normal caution (destructive irreversible ops still need a real round-trip proof; the on-device privacy invariant is never weakened).
- Verification bar is UNCHANGED and strict: verify entitlement against a **real webhook event**, never a mocked "success" (mirror oracle). The autonomy is permission to ship, not permission to lower the oracle bar.

## Git / single-writer discipline

- `git add <file> ...` only. NEVER `git add -A`/`.`/`--amend`. (git-guard blocks the dangerous forms.)
- Parallel work in `git worktree`; one writer per file/barrel.
- Commit only when the user asks; never push.

## The agent cannot edit its own cage

`conventions.json`, `.claude/settings.json`, `.claude/hooks/`, `scripts/`, `eslint.config.mjs`, `tsconfig*.json`, `gate-budget.json`, `lefthook.yml`, and `packages/db/migrations/approvals/` are human-owned (generated into CODEOWNERS). A change editing a gate config in the same diff as the code it unblocks is auto-rejected. A blocked gate is reported as a finding, never disabled.

## Simulators

Use the sim skills — never drive `simctl`/`adb`/`emulator` raw. Ask before booting (sims compete for RAM; iOS first, Android parity second, never both at once).
