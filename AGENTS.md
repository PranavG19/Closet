# AGENTS.md — Router

Router only (≤~500 tokens). The module map is `manifest.json`, not here.

## Read-order

1. Your task file (`tasks/*.code-task.md`) — the definition of done.
2. `CLAUDE.md` — the five rules on every change.
3. `manifest.json` — the O(1) public-barrel symbol map. A miss = "does not exist" only for a module that HAS a barrel; barrel-less modules (`@closet/functions` handlers, mobile `features/*`) are reached by subpath. Search, don't fabricate.
4. Load domain context only if your change touches it:
   - Money / entitlement → the billing ADR FIRST (human-gated).
   - Destructive migration → the migration-flow ADR FIRST.
   - RLS / auth / tenancy → the RLS-tenancy ADR FIRST.
   - The parse pipeline / privacy gate → `docs/02-engineering-requirements.md` §4 + the privacy invariant in `CLAUDE.md`.

## STOP — human review (rule 5)

Do not proceed autonomously when the change touches:
- **Money / entitlement path** — subscriptions, RevenueCat webhook, paywall, StoreKit / Play Billing.
- **Destructive migration** — DROP, TRUNCATE, narrowing ALTER TYPE, or any DDL without a tested down.
- **The privacy gate** — anything that could cause a non-approved photo or body geometry to leave the device.
- **Unobservable visual output** — a UI change you cannot verify by screenshot through the real simulator.

Also stop if change + tests + verification cannot fit one context window — decompose first (rule 1).

## Two-tier rule

Every gate is auto-approve **or** block. No warning tier. A gate's non-zero exit blocks the change — do not disable the gate to unblock. The task token cannot edit guardrail configs (`.claude/`, hooks, `scripts/`, `eslint.config.mjs`, `tsconfig*`, `conventions.json`, `lefthook.yml`, migration approvals). A change editing a gate config in the same diff as the code it unblocks is auto-rejected.

## Verification is the definition of done

A task is done when an **independent oracle** confirms it — not when your own test passes (that's a mirror). See `docs/05-testing-gauntlet.md`. `verify:full` must pass (the `verify-stop` hook proves it mechanically before you can end a turn).

## Where things live

- Rules: `CLAUDE.md` · Module map: `manifest.json` · Conventions SSOT: `conventions.json` (`pnpm gen`; `gen:check` fails on drift)
- Generator: `scripts/gen-conventions.mjs` · Gates: `scripts/gates/` · ADRs: `docs/decisions/`
- Product spec: `docs/00`–`03` · Operating model: `docs/04` · Test framework: `docs/05` · Future (do NOT build): `docs/roadmap.md`
- Per-task record: `docs/RUN-LOG.md` · Deferred bugs: `docs/BUG-QUEUE.md`
