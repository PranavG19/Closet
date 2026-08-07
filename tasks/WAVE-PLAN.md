# Backend wave plan

Dependency-ordered. Backend-first: data + RLS + repos before handlers before the money path.
Each task: own demo, own tests (part of the task, not separate), an independent oracle, one-writer-per-file.
Authored inline by the orchestrator from `docs/06-backend-design.md` (the decomposition workflow stalled — a single agent can't hold 8 files + emit a nested plan in one pass; Rule 1 violation. Planning is coupled judgment, so it's done here; per-task authoring fans out).

Patterns every task cites: `docs/PATTERNS.md`. Format: `_shared/code-task-format.md`. Rules: `CLAUDE.md`.

---

## Wave 1 — schema substrate + core tables + RLS  (no cross-task file overlap; parallel-safe)

Goal: the 8 tables exist with RLS FORCE default-deny, the app_user role + grants, and the `check-rls` gate wired into verify. Proven by real-Postgres integration tests (`SET LOCAL ROLE app_user`).

- **task-01-substrate-and-roles** — `0001_substrate.sql` (pgcrypto, dual-target auth bootstrap, `auth.uid()`, `tg_set_updated_at`, the `app_user` role) + `applyMigrations` test helper. Oracle: red-first — an RLS policy test cannot even run without `auth.uid()`; prove the substrate applies + round-trips (up→down→up hash match). Files: `packages/db/migrations/0001_substrate.sql`, `packages/db/test/helpers/applyMigrations.ts`, `packages/db/test/helpers/executor.ts`. Reversibility: reversible.
- **task-02-wardrobe-and-parse-jobs** — `0002_wardrobe_items.sql` + `0003_parse_jobs.sql`: tables, RLS FORCE, policies, `UNIQUE(user_id,id)` anchor on items, `UNIQUE(user_id,source_photo_hash)` on parse_jobs, indexes (keyset, availability-partial, category). Oracle: integration test as app_user — own rows visible, B's invisible; the parse_jobs UNIQUE rejects a dup photo hash (differential: second insert → 0 rows/conflict). Files: those 2 migrations + `packages/db/test/wardrobe.rls.integration.test.ts`. Reversible.
- **task-03-outfits-wearlog-palette** — `0004_outfits.sql`, `0005_outfit_items.sql`, `0006_wear_log.sql`, `0007_palette_profile.sql`: composite FKs `(user_id,id)` making cross-tenant refs unrepresentable; wear_log INSERT+SELECT-only (append-only, FK `ON DELETE RESTRICT`); palette 1:1. Oracle: integration test — cross-tenant `outfit_items` insert naming B's item fails the composite FK (unrepresentable, not just validated); wear_log has no UPDATE/DELETE policy (attempt → denied). Files: those 4 migrations + `packages/db/test/outfits-wearlog.rls.integration.test.ts`. Reversible.
- **task-04-subscriptions-webhookevents-rlsgate** — `0008_subscriptions.sql` (SELECT-only for app_user; no write policy → self-grant unrepresentable) + `0009_webhook_events.sql` (service-role only, `event_id` pk) + wire the **`check-rls` gate** (`scripts/gates/check-rls.mjs`) into `conventions.json` gateBudget (structural, weight 0, replaces "manual RLS review") + `scripts/verify.mjs` (full). Oracle: the gate itself — it fails if ANY tenant table lacks FORCE; fire-drill by removing FORCE on one table and asserting red. Files: 2 migrations, `scripts/gates/check-rls.mjs`, `conventions.json`, `scripts/verify.mjs`, `packages/db/test/subscriptions.rls.integration.test.ts`. Reversible. *(Note: conventions.json is human-owned; the orchestrator wires this, not a task token — see build note.)*

## Wave 2 — shared: Zod schemas + ports + pure-fn domain logic  (parallel-safe; depends on nothing in wave 1 except types)

Goal: the type SSOT + swappable ports + the on-device pure functions (harmony/suggestion/palette/dedupe), each property-tested.

- **task-05-zod-schemas** — every table row + request/response schema in `packages/shared/src/schemas/`, `parseBoundary`/`parseBoundarySafe` helpers. Oracle: round-trip property test (parse(serialize(x)) == x) with fast-check. Files: `packages/shared/src/schemas/*`, `packages/shared/src/parse.ts`, their `.test.ts`.
- **task-06-ports** — `AIVisionPort`, `CutoutPort`, `WeatherPort` interfaces + Zod result contracts (no vendor types leak). Oracle: spec-literal — the port surface matches docs/06 §5; a fake adapter satisfies the interface in a test. Files: `packages/shared/src/ports/*`.
- **task-07-harmony-and-dedupe** — F9 color-harmony rule table + phash Hamming compare (F4). Oracle: property tests — determinism, symmetry `harmony(a,b)==harmony(b,a)`, totality (never undefined); `d(x,x)=0`. Files: `packages/shared/src/harmony.ts`, `packages/shared/src/dedupe.ts`, tests.
- **task-08-suggestion-and-palette** — F5 weather-aware heuristic + B1 palette scoring. Oracle: property tests — never emits a dirty item; zero-clean → defined non-empty fallback; colder temp → monotonic non-decreasing warmth; palette advisory NEVER hides/blocks any item. Files: `packages/shared/src/suggestion.ts`, `packages/shared/src/palette.ts`, tests.

## Wave 3 — repos + read/write endpoints  (depends on W1 tables + W2 schemas)

- **task-09-repos** — repo factories for all 8 tables over `QueryExecutor`. Oracle: integration tests as app_user, RLS-scoped. One writer: `packages/db/src/repos/*`.
- **task-10-wardrobe-endpoint** — list/filter (keyset, server-clamped limit≤100) + availability toggle (F7) + dedupe keep-one **MERGE** (re-point wear_log+outfit_items, then delete; keep-both no-op). Oracle: integration — merge preserves wear history (FK RESTRICT), differential row counts. Files: `packages/functions/src/wardrobe/*` + integration test.
- **task-11-outfits-endpoint** — outfit + outfit_items CRUD (F6), client_id-idempotent, composite-FK validation. Files: `packages/functions/src/outfits/*` + test.
- **task-12-wearlog-palette-endpoints** — wear-log append (F8, client_id partial-UNIQUE idempotent, optional flip-to-dirty) + palette upsert + entitlement read. Files: `packages/functions/src/wear-log/*`, `packages/functions/src/palette/*` + tests.

## Wave 4 — parse pipeline  (depends on W1–W3)

- **task-13-parse-photo** — the make-or-break endpoint: atomic parse_jobs claim (rowcount=1 gate + stale-claim lease), provider calls via ports, commit fn (delete-partial-by-job + insert + mark done), teaser HARD per-user cap, entitlement gate on kind=full. Oracle: integration — resume creates NO duplicate garments; concurrent claim → one winner. Files: `packages/functions/src/parse/*` + tests.
- **task-14-bench-scan-harness** — the parse-quality oracle: held corpus + replay tier (keyless, byte-compared) + adversary tier (wrong model → score collapses) + differential (provider A vs B). Oracle: IS the oracle — adversary proves the gate bites. Files: `scripts/bench-scan.mjs`, `scripts/bench-scan-*.mjs`, corpus fixtures.

## Wave 5 — money path  (depends on W1 subscriptions/webhook_events + W3)  ·  AUTONOMY GRANTED (build+verify+merge)

- **task-15-revenuecat-webhook** — self-authed signature verify FIRST, atomic `webhook_events` dedup (INSERT ON CONFLICT DO NOTHING), monotonic `event_ts` guard on the subscriptions upsert, service_role sole writer. Oracle: **a REAL RevenueCat webhook event** (never a mocked success — mirror oracle); replay/out-of-order/dup chaos. Files: `packages/functions/src/billing/*` + tests + the Deno shim. Reversibility: irreversible-gated by nature, but owner GRANTED build+verify+merge autonomy (CLAUDE.md 2026-08-06) — ship it with the real-event bar held.

---

## File-ownership check
No two tasks in the same wave write the same file. `conventions.json` + `scripts/verify.mjs` are touched only by task-04 (and only by the orchestrator, since they're human-owned) — sequenced last in wave 1. Migrations are strictly numbered so their order is total; parallel wave-1 agents own disjoint migration numbers.

## Build order
W1 ∥ W2 (independent) → W3 → W4 → W5. Within W1: tasks 01→(02,03)∥→04 (04 wires the gate after tables exist). Within W2: all 4 parallel.
