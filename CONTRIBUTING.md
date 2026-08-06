# Contributing to closet-app

Dense reference for agents and humans. Covers the things that break builds if skipped.
Modeled on the sibling app `../fitapp` — when this doc is silent, read fitapp.

## Architecture

### Package dependency graph

```
shared  (Zod schemas, pure fns, port interfaces — the type SSOT)
  ^
  |
  db     (node-pg-migrate migrations + repos — the ONLY DB-access seam)
  ^
  |
functions  (Edge handlers + business logic; vitest + testcontainers)

mobile  (Expo app — imports shared only, never db/functions)
```

Repos live in `packages/db/src/repos/`. Handlers in `packages/functions/src/<domain>/`.
Mobile never touches `db` or `functions` directly.

### Edge Functions (Deno shims)

Each shim in `supabase/functions/<name>/index.ts` is ~3 lines: import the built
handler from the Node package, wrap in `serveAuthed`. All logic lives in
`packages/functions` (tested by vitest); the shim wires the Deno runtime to the
built `dist/`. Build before deploying or running edge gates.

### Ports (swappable vendor boundaries)

| Port | Purpose | MVP adapter |
|------|---------|-------------|
| `AIVisionPort` | Garment attribute extraction | GPT-4o |
| `CutoutPort` | Background removal → front-view cutout | Photoroom / remove.bg / SAM (TBD) |
| `WeatherPort` | Local weather for suggestions | a weather API |
| `NotificationPort` | Push | Expo push |

Adapters implement the interface and never leak vendor types across the boundary.
**RevenueCat is deliberately NOT a port** — entitlement is a first-class domain concept.

## Development workflow

### Key commands

| Command | What it does |
|---------|--------------|
| `pnpm verify` | Fast gate wall: gen-check, budget, secrets, typecheck, lint (+ affected tests as they land) |
| `pnpm verify:full` | Full suite incl. RLS + integration (as they land); writes the verify-stamp |
| `pnpm gen` | Regenerate manifest/CODEOWNERS/gate-budget/eslint-roots from `conventions.json` |
| `pnpm -w exec tsc --build` | Rebuild dist (Deno shims + downstream tests import built `dist/`) |
| `pnpm db:migrate` / `:down` / `:redo` | Run migrations (needs `DATABASE_URL` SOURCED from `.env.migrate`) |

### Adding a feature root

Add it to `conventions.json` `featureRoots` and run `pnpm gen`. That is the ONLY
place — it propagates to the eslint cross-feature-import zone and the manifest.
Never hand-edit the generated FEATURE_ROOTS region in `eslint.config.mjs`.

### Adding a gate

1. Write the gate script under `scripts/gates/`.
2. Register it in `conventions.json` `gateBudget`, **naming what it replaces** (Rule 5).
3. Add it to the `STEPS` list in `scripts/verify.mjs` (sync) — or run it post-merge (async).
4. `pnpm gen` (regenerates `gate-budget.json`); `check-budget` fails if the sync sum exceeds 6.

### Adding a migration

- `packages/db/migrations/NNNN_<name>.sql`, real UP + DOWN (reversible DDL).
- Post-launch: append-only. Never edit a landed migration.
- Destructive DDL needs a human approval token under `migrations/approvals/`.
- `pnpm db:migrate:redo` round-trips the latest (down 1, up 1) — do it on populated data.

## Non-obvious rules

- **RLS FORCE + SET LOCAL ROLE:** every tenant table has RLS FORCE. Integration tests must `SET LOCAL ROLE app_user` — the testcontainer superuser bypasses RLS, so forgetting this makes the test prove nothing.
- **client_id minting:** mint at tap time, pass into `mutationFn`. Never inside `mutationFn` — retries create duplicate rows.
- **Dual-runtime env:** never bare `process.env`. Use `envValue()` (`'Deno' in globalThis ? Deno.env.get(k) : process.env[k]`). Edge runs Deno.
- **parse-don't-cast:** every DB row / request / response through its Zod schema. No `as` across trust boundaries. Repos cast `timestamptz→::text`, `numeric→::float` in SELECT.
- **Colors from useTokens() only:** no raw hex/rgb under `packages/mobile/{features,components}`.
- **Structured logger only:** `no-console` is lint-error. Never log raw error messages (PII).
- **git grep, not grep** (NUL bytes). **git add explicit paths** — never `-A`/`.`.
- **The on-device gate runs before ANY upload** — the privacy invariant is structural, verified by a test that plants a non-approved photo and asserts it never leaves the device.

## Testing philosophy

- **Kill the mirror oracle.** Code and its tests should not come from the same pass; grade with a signal the author didn't produce. Full framework in `docs/05-testing-gauntlet.md`.
- **Red-first:** prove the test fails before the fix exists.
- **Integration = real Postgres:** testcontainers with the full migration chain + RLS enforced.
- **Metamorphic + property-based** for the parse and the deterministic logic (ground truth is scarce for garment parsing — invariants are the oracle).
- **verify:full before declaring done** — affected-only masks regressions.

## Bootstrapping (first-time)

1. `pnpm install` (wires lefthook via `prepare`).
2. `git init` if not already a repo (the verify-stamp / worktree-hash machinery needs git).
3. `pnpm gen` then `pnpm verify` — should pass on the empty scaffold.
