# 02 — Engineering Requirements

*How we build [`01-product-requirements.md`](./01-product-requirements.md). Grounded in the agent-arch 5 rules and modeled on the sibling app **fitapp**, which was coded ~zero-human-in-loop and held up. When this doc and fitapp's actual structure disagree, fitapp wins — read it.*

---

## 0. Guiding model (agent-arch)

Two regimes:

- **~30% infrastructure / safety / plumbing** (auth, tenancy, secrets, boundaries, migrations, the money path, the privacy gate) → **make the unsafe thing unrepresentable.** Push enforcement below the app layer: sovereign structural (Postgres RLS FORCE) > local structural (tsconfig / project references / lint) > detection (tests/CI).
- **~70% business-logic correctness** (parse quality, suggestions, dedupe, harmony) → **verify from a vantage you cannot reach.** Grade every claim with a signal the author didn't produce (an independent oracle harness, red-first tests, real webhook events — never a self-graded mock).

**The 5 rules + escalation trigger** apply to every change; the short form lives in `CLAUDE.md`. Escalation (STOP for human): irreversible ops · cross-system temporal boundaries · unobservable visual output. For this app that concretely means: **the money/entitlement path, destructive migrations, and any pixel-output UI change you can't screenshot.**

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|-------|--------|-------|
| App | **React Native / Expo** | iOS + Android from one codebase |
| Language | **TypeScript strict** | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, project references |
| Package mgr | **pnpm** workspace monorepo | never npm/yarn |
| Backend | **Supabase** | Postgres + RLS FORCE + Auth (JWKS) + Storage + Deno Edge Functions |
| Migrations | **node-pg-migrate** | numbered, UP+DOWN, append-only post-launch |
| Subscriptions | **RevenueCat** | not a port — deliberately (see §5) |
| Vision (attributes) | **GPT-4o default, behind `AIVisionPort`** | swappable provider |
| Cutout / bg-removal | **separate provider behind `CutoutPort`** | e.g. Photoroom / remove.bg / SAM — distinct from attribute extraction |
| Tests | **vitest + testcontainers** (real Postgres) | integration = full migration chain + RLS enforced |

Version pins follow fitapp's (Node ≥22 via `.mise.toml` — load-bearing for testcontainers/undici; Expo/RN/React versions mirror `packages/mobile/package.json`).

---

## 2. Monorepo architecture

Dependency graph (identical shape to fitapp — one DB seam, mobile imports only shared):

```
shared   (Zod schemas, pure fns, port interfaces — the type SSOT)
  ^
  |
  db      (node-pg-migrate migrations + repos — the ONLY DB-access seam)
  ^
  |
functions (Edge handlers + business logic; vitest + testcontainers)

mobile   (Expo app — imports shared only, never db/functions)
```

- **`packages/shared`** — Zod schemas (the parse-don't-cast SSOT), pure functions (color harmony rules, suggestion heuristics, palette logic), and **ports**. This is where types live.
- **`packages/db`** — migrations + repos. Repos are the **only** path to the database; `supabase.from()` is lint-banned elsewhere. Each repo function uses the `QueryExecutor` pattern; one tx per `query()` call.
- **`packages/functions`** — endpoint handlers (parse orchestration, suggestions, wear-log writes, the RevenueCat webhook). Deployed as thin Deno Edge shims (`supabase/functions/<name>/index.ts` → `serveAuthed(handler)`); all logic is in the Node package and tested by vitest.
- **`packages/mobile`** — the Expo app. Colors come from `useTokens()` only (CI-gated); never imports `db`/`functions`.

**Feature roots** (mobile `features/*`, declared in `conventions.json`, cross-feature imports lint-banned): `onboarding`, `wardrobe`, `outfits`, `suggestions`, `laundry` (availability), `wearlog`, `palette`, `monetization`, `navigation`, `auth`.

### Ports (swappable vendor boundaries — only for substitutable boundaries)

| Port | Purpose | MVP adapter |
|------|---------|-------------|
| `AIVisionPort` | Garment **attribute** extraction from a photo | GPT-4o |
| `CutoutPort` | Background removal → normalized front-view cutout | Photoroom / remove.bg / SAM (pick in design) |
| `WeatherPort` | Local weather for suggestions | a weather API |
| `NotificationPort` | Push (Expo) | Expo push |

Adapters implement the interface and **never leak vendor types across the boundary**. **RevenueCat is deliberately NOT a port** (same call fitapp made — entitlement is a first-class domain concept, not a swappable vendor detail).

> **Rule-2 note:** the *reason* vision is a port isn't just tidiness — it's that the make-or-break lever (parse quality) must be A/B-swappable against an independent oracle (§6) without touching callers. The port is the seam that lets us grade GPT-4o vs. an alternative on the same corpus.

---

## 3. Data model & tenancy (the 30% — structural)

Every user-scoped table is **tenant-owned by `user_id`** and carries **RLS FORCE** with a default-deny policy keyed on the verified JWT `sub`. `service_role` bypass exists only for system jobs (the parse worker, the webhook). This is the sovereign-structural guarantee: a missing app-layer check cannot leak another user's closet, because the database itself refuses the row.

Core tables (MVP):

- `wardrobe_items` — `user_id`, cutout asset ref, attributes (category, color, pattern), availability state (`clean` / `dirty` / `unavailable`), source-photo ref, timestamps.
- `outfits` — `user_id`, name, timestamps. **First-class, self-contained** (roadmap: polls/try-on/events consume these unchanged).
- `outfit_items` — join `outfit_id` × item. Keep the item reference shaped so a *future* catalog item (gap-fill, roadmap) is an additive change, not a reshape.
- `wear_log` — `user_id`, item/outfit ref, `worn_at` timestamp. **The moat. Ships in MVP. Never cut.**
- `palette_profile` — `user_id`, self-identified swatch quiz result (a set of hues). Decoupled from *how* derived (roadmap can swap derivation).
- `parse_jobs` — tracks camera-roll parse progress; resumable/idempotent (F3). A photo already parsed must not re-create an item — enforced by a UNIQUE constraint on (`user_id`, source-photo hash), not app-level dedup (agent-arch concurrency: constraint-as-signal).
- `subscriptions` / entitlement — **human-gated** (§5).

**Migration discipline (agent-arch axis 23):** additive changes (new nullable column, new table) are agent-autonomous under monitoring. **Destructive DDL (DROP/TRUNCATE/narrowing) is an escalation trigger** — it lands only in a numbered migration with a human approval token (`packages/db/migrations/approvals/`), never ad-hoc (the `db-guard` hook blocks shell DROPs). Expand/contract for any schema change touching live data. Every migration has a real, round-trip-tested DOWN.

**Dedupe seam (F4):** the pipeline emits a *likely-duplicate* signal (perceptual/attribute similarity); the **pick** is a user decision, so dedupe is never destructive without her tap. "Keep both" is always representable.

---

## 4. The parse pipeline (the make-or-break path)

Hybrid, privacy-first:

1. **On-device gate (ABLATE-tier privacy — agent-arch axis 18).** Before *any* upload, filter the camera roll locally: keep likely garment/outfit photos of the user; drop intimate images, non-person photos, screenshots, and best-effort not-her photos. *You cannot leak what never leaves the device.* This is the structural form of the privacy invariant — not a server-side "please delete" promise.
2. **Cloud parse (approved photos only).** For each approved photo: `AIVisionPort` extracts attributes; `CutoutPort` produces the normalized front-view cutout. Two providers, two concerns, both swappable.
3. **Teaser vs. full (cost + conversion).** Teaser = a handful of items parsed pre-paywall (F1). Full = the rest, **after** entitlement is confirmed (F3). We never spend cloud-parse dollars on non-payers; heavier-quality work happens post-commitment.
4. **Idempotent + resumable.** `parse_jobs` + the source-photo UNIQUE constraint make re-runs safe.

**Provider abstraction contract:** callers depend on the port interface + Zod-validated results only. Swapping GPT-4o for another vision model, or one cutout vendor for another, changes exactly one adapter file.

---

## 5. Money / entitlement — HUMAN-GATED

- RevenueCat SDK client-side; a **webhook handler** (Edge function) maps purchase events → entitlement rows.
- **Escalation (Rule 6):** agents build and verify this path but **do not ship it autonomously.** It's parked for human review.
- **Verify from a vantage you can't reach (Rule 3):** entitlement correctness is proven against a **real RevenueCat webhook event**, never a mocked "success." A self-mocked purchase test is a mirror oracle and does not count.
- The webhook shim is self-authed (`verify_jwt = false`, signature-verified) — the one class of endpoint that isn't user-JWT-gated; it authenticates the *sender*, not a user.

---

## 6. Verification strategy (the 70% — independent oracles)

- **Parse quality** gets a **`bench-scan`-style harness** (direct prior art: fitapp's `scripts/bench-scan.mjs` + `bench-scan-build-corpus`). A held corpus of labeled garment photos → run the pipeline → score attribute accuracy + cutout quality against labels the pipeline didn't produce. This is the independent oracle for the make-or-break lever, and the mechanism that lets us compare vision providers objectively.
- **Logic** (harmony rules, suggestion heuristics, dedupe scoring): **red-first tests** (prove the test fails on the parent state), oracles we didn't compute, property-based tests (fast-check) for harmony/suggestion invariants. **Mutation testing on the critical path** (money, tenancy, parse) — a surviving mutant means the test is hollow.
- **Tenancy:** integration tests run against **real Postgres with RLS enforced** and must `SET LOCAL ROLE app_user` — the testcontainer superuser bypasses RLS, so forgetting this proves nothing (fitapp's #1 non-obvious rule).
- **UI:** the independent oracle is a **real simulator screenshot** (unobservable visual output is an escalation trigger — don't claim a UI works without seeing it). Use the sim skills; ask before booting.
- **`pnpm verify`** = fast affected-only wall (gen-check, structural gates, typecheck, lint, affected tests). **`pnpm verify:full`** = full suite incl. RLS + integration. Run `verify:full` before declaring any wave done; affected-only masks regressions.

---

## 7. Guardrails & gates (mechanical, two-tier)

Modeled on fitapp exactly. Two tiers only — **auto-approve or block, no warning tier.**

- **`conventions.json` is the single source of truth** → `pnpm gen` derives `manifest.json`, `CODEOWNERS`, `gate-budget.json`. `pnpm gen:check` fails on drift. Hand-edit *only* `conventions.json`.
- **Synchronous gate budget ≤ 6** (weighted: structural=0, mechanical=1, advisory=2). Async gates (nightly mutation, theme/spec checks) don't count. Add a gate only by naming what it replaces.
- **`.claude/hooks/`** (PreToolUse/PostToolUse/Stop):
  - `git-guard` — blocks force-push, push to default branch, `--no-verify`, staging secrets.
  - `db-guard` — blocks raw destructive SQL via shell (DROP/TRUNCATE must be an approved migration).
  - `secret-file-guard` — blocks *reading* `.env.*` contents into context (sourcing is fine); also guards the Read tool.
  - `posttool-typecheck` — fast incremental `tsc --build` on the edited package (advisory, never blocks).
  - `verify-stop` — Stop hook; proves `pnpm verify:full` ran against the current tree via a tree-hash stamp (Rule 3: "verified" is mechanical, not asserted).
  - `session-start` — surfaces build state (run-log / bug-queue / escalations).
- **The agent cannot edit its own cage.** `conventions.json`, `.claude/settings.json`, `.claude/hooks/`, gate scripts, tsconfig, and migration approvals are human-owned (generated into CODEOWNERS). A PR editing a gate config in the same diff as the code it unblocks is auto-rejected.

---

## 8. Security & data invariants (non-negotiable — mirror fitapp's)

- **Repos are the ONLY DB path.** `supabase.from()` lint-banned in functions/mobile.
- **Identity from verified JWT `sub`** (via `withAuth`/`serveAuthed`, asymmetric JWKS — no shared secret), never from a request body.
- **RLS FORCE on every tenant table.** `service_role` bypass only for system jobs.
- **parse-don't-cast:** every DB row / request / response passes its Zod schema (`parseBoundary`). No `as` across trust boundaries. Repos cast `timestamptz→::text`, `numeric→::float` in SELECT so rows match schemas and survive `JSON.stringify`.
- **`client_id` minted by the caller at tap time**, not inside `mutationFn` (retries would create dup rows; a partial UNIQUE index dedups).
- **Colors from `useTokens()`, never literals** — CI gate.
- **Structured logger only**, `no-console` is lint-error; never log raw error messages (PII).
- **Read env via `envValue()`**, never bare `process.env` (Edge runs Deno — bare `process.env` silently yields undefined).
- **Secrets in gitignored `.env.*` — SOURCE, never READ.** `set -a; . ./.env.migrate; set +a; pnpm db:migrate`; never `cat` the file.
- **On-device gate filters before upload** — the structural privacy guarantee (§4).
- **Body geometry (try-on, roadmap) is session-ephemeral** — no server-side body twin, no biometric identity, no bystander faces. Not built in MVP; stated so no MVP seam violates it.
- **git add explicit paths only** — never `-A`/`.`/`--amend`; commit only when the user asks; never push; **`git grep`, not `grep`** (NUL bytes silently skipped).

---

## 9. Non-functionals

- **Perf (Rule 4):** synchronous gates p95 < 90s; a gate adding >10% latency gets fixed (parallelized/affected-only/structural) before it ships. Teaser parse has a tight time budget (it's the aha — set a concrete target in the F1 task).
- **Degraded paths are specified, not hoped for** (agent-arch resilience): mid-parse wardrobe, all-dirty closet, no weather signal, skipped quiz, declined photo access — each MVP feature's task names its degraded state and a test asserts it.
- **Cost per correct outcome** (agent-arch axis 15): 200–400 line modules, generated navigation (manifest), full-file-on-first-touch. Cloud-parse spend is bounded by the teaser/full split — never parse for a non-payer.
- **Observability:** structured logs, an outside-sourced signal for anything user-visible (not a self-reported success count). Detailed only as features land.

---

## 10. Build order (backend-first, like fitapp)

Prove data + RLS + endpoints before UI. Rough sequence (exact `.code-task.md` decomposition comes after this doc is signed off):

1. **Scaffold** — monorepo, packages, gates, hooks, CLAUDE/AGENTS, conventions. *(This is the scaffolding step; no product logic.)*
2. **Data + tenancy** — migrations for the core tables, repos, RLS proven by integration tests.
3. **Parse pipeline + ports** — `AIVisionPort`/`CutoutPort`, the parse handler, the bench-scan oracle, idempotent `parse_jobs`.
4. **Domain logic** — harmony rules, suggestion heuristic, dedupe scoring, palette (all pure, in `shared`, property-tested).
5. **Endpoints** — suggestions, wear-log, availability, outfit CRUD.
6. **Money path** — RevenueCat webhook → entitlement (**human-gated**, verified against a real event).
7. **Mobile UI** — onboarding/reveal, wardrobe, builder, suggestions, laundry, wear-log, paywall, palette quiz (screenshot-verified).

Each step decomposes into 3–5 day-sized `.code-task.md` files (one writer per file; tests part of the task; each names its demo, verification signal, and reversibility class).
