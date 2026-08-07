# RUN-LOG

Newest last. One entry per meaningful wave. Terse; the durable record of where the build is.

## 2026-08-06 — Foundation: specs + scaffold + backend design

- Wrote the spec set: `docs/00`–`06` + `roadmap.md` (00 vision, 01 PRD, 02 eng-req, 03 design-system, 04 dev-phases/autonomy model, 05 test-gauntlet, 06 backend-design). `roadmap.md` = future, do not implement.
- Scaffolded the pnpm/Expo monorepo modeled on fitapp; **`pnpm verify:full` is green**. packages/{shared,db,functions,mobile} with empty barrels; `conventions.json` SSOT → `pnpm gen` derives manifest/CODEOWNERS/gate-budget/eslint-roots; scripts/{gen-conventions,verify,worktree-hash,db-migrate}; gates {check-secrets,check-budget}; all 6 `.claude/hooks/` fire-drilled OK.
- Backend design + test taxonomy produced by an ultracode workflow (11 agents; 4 lenses → synth → adversarial validate → author). Landed as `docs/06` + `docs/05`.
- **NOT yet committed** (awaiting review). git repo initialized; repo-local `core.hooksPath=.git/hooks` (machine has a global hooksPath we did not touch).

**Open for human sign-off before backend task decomposition:** (1) anonymous→permanent account link preserves `sub`? (2) CutoutPort vendor (Photoroom assumed); (3) teaser item-cap is best-effort not hard-guarantee — OK? (4) originals retained not deleted post-parse. See BUG-QUEUE / the checkpoint.

**Next:** decompose the BACKEND into day-sized `.code-task.md` files (each with an independent oracle). Frontend later, human-collaborated.

## 2026-08-06 — Decisions locked; multi-stream orchestration started (goal-driven)

- **Decisions locked:** identity up-front via Sign in with Apple/Google BEFORE teaser (no anonymous session — removes the anon→account escalation trigger, makes the teaser cap a hard per-user guarantee); Cutout = Photoroom; teaser cap = hard per-user. Applied to docs/06 §1/§4/§8 + docs/05 Tier-4. Committed (3baf049).
- **Foundation committed** (3baf049, 51 files) — pre-commit `pnpm verify` green. Orchestration tracker committed (d42a84f).
- **Goal set:** orchestrate ultracode workflows for ALL agent-unblocked tasks. See docs/ORCHESTRATION.md for the live frontier + collision rules.
- **Running now:** backend decomposition (wf_3427de72-828, resumed after a transient ENOTFOUND on the planner — not a logic failure); SEO launch content (wf_8b42ab5e-854 — pillar + 6 posts + landing copy, drafts only, publish human-gated).
- **Queued (collision-gated):** backend build (needs wave plan; then parallel worktrees); frontend scaffold (sequenced after backend dep-install to avoid pnpm-lock races).
- **Blocked/gated:** endpoint+gauntlet testing (no endpoints yet); marketing-creator research (needs live web; sending gated); money path (human-gated).

## 2026-08-06 — Backend W1+W2 built, integrated, GREEN (e85dc01)

- Decomposition workflow stalled twice (transient ENOTFOUND, then Rule-1 overload: 1 agent + 8 files + nested schema, 714k tok). Fixed by planning waves INLINE (tasks/WAVE-PLAN.md) + extracting fitapp patterns to docs/PATTERNS.md so authoring agents don't re-explore. Lean authoring workflow then wrote 8 W1+W2 task files in 13 tool-uses.
- Added orchestrator-owned test harness: vitest.config.ts (unit+integration projects) + colima runtime detector.
- **W1 (packages/db)** + **W2 (packages/shared)** built by 2 worktree agents, integrated to main. **`pnpm verify:full` GREEN: 92 unit + 30 integration tests.** 9 migrations, all RLS FORCE; check-rls gate self-boots its own container, wired into conventions+verify, fire-drill-proven red. W2 property tests all proven red-first. Build agent correctly followed docs/06 §3 columns over looser task prose (flagged).
- check-rls gate: rewrote to dual-mode (DATABASE_URL=check-as-is for the fire-drill test; else self-boot+migrate) so it never rots to a false green; fixed a client-reuse + finally-cleanup bug found by verify:full.
- **W3 (repos+endpoints) launched** (wf_4520cb7a-a8d): authors W3+W4 task files, builds W3 (auth infra→repos→wardrobe/outfits/wear-log/palette endpoints) in a worktree, integration-verified. W3 now unblocked because W1 tables + W2 schemas exist.
- Orphan test containers cleaned (32 accumulated across parallel runs); each test file stops its own (Ryuk disabled under colima).
- **W3 build (in worktree, near done):** all 8 repos + auth infra (09a) + 5 endpoints + 17 integration test files (correctly under packages/*/test/, not src/ — the src/ glob-skip trap the agent caught). Real design gaps the build surfaced + resolved: (a) D-001 outfit idempotency via client-minted id; (b) **0010_wardrobe_delete.sql** — 0002 granted app_user only SELECT/INSERT/UPDATE, but the dedupe keep-one MERGE must DELETE the discard as app_user (42501 without it) → additive reversible migration adds a DELETE policy+grant (approved, agent-autonomous, expand-only). Note the 42501-vs-23503 distinction: merge deletes after re-pointing refs (ok); bare delete of a worn item raises 23503 via wear_log ON DELETE RESTRICT.
- **Coordination hazard noted:** the build agent repeatedly misattributed its OWN output to the orchestrator ("your live edits") after receiving mid-build SendMessages — a known failure mode. Output stayed correct; corrected it firmly (sole author). Lesson in ORCHESTRATION.md: avoid messaging a workflow-driven agent mid-run unless necessary.

## 2026-08-06 — Backend W3 integrated + verified GREEN from main

- **W3 committed:** auth infra (09a: withAuth asymmetric-JWKS via jose, per-request SET LOCAL ROLE app_user executor, respond, serveAuthed) + all 8 repos (09b) + wardrobe/outfits/wear-log/palette endpoints (10/11/12). **verify:full GREEN verified by the orchestrator from main (not the agent's report): 92 unit + 85 integration (17 files), check-rls 8/8 FORCE, check-definer-search-path 1 fn pinned, migration round-trip on populated data.**
- **New migrations (additive, reversible, agent-autonomous):** 0010_wardrobe_delete (owner-scoped DELETE policy+grant for the merge; moat still protected by wear_log RESTRICT) + 0011_dedupe_merge_fn (SECURITY DEFINER merge_keep_one — D-002 — search_path='', ownership RAISE, REVOKE PUBLIC+GRANT app_user; wear_log stays append-only for direct access, proven).
- **New orchestrator-owned gate: check-definer-search-path** (structural, sync, weight 0) — mechanically enforces SET search_path='' on every SECURITY DEFINER fn; fire-drill-proven. Decisions D-001 (client-minted id) + D-002 (definer merge) recorded.
- **3 real production bugs the oracles caught** (build agent, in its files): timestamptz::text vs frozen Zod Timestamptz (would break every handler response) → to_char with T/Z; append-only-vs-merge → DEFINER fn; missing DELETE grant. Also UUID-v4 strictness + the src/-test-glob-skip trap.
- **Integration discipline held:** verified from main, didn't trust the report; excluded the worktree's stray pnpm-lock (functions is jose-only/driver-free — confirmed no pg import); ran D-001/D-002/deps checks before copying. Build agent closed out cleanly.
- **Next: Wave 4** (task-13 parse-photo — atomic claim + commit fn + teaser HARD cap + entitlement gate + AIVision/Cutout ports; task-14 bench-scan oracle). Then W5 money path (full build+merge autonomy per owner grant).

## 2026-08-07 — Wave 4 phase 1: db repo methods (A) + bench-scan (C) integrated GREEN

- **First W4 attempt (wf_51e9bd53) STALLED** — one agent tried to hold parse-photo handler + repo SQL + bench-scan + all oracles in one window; all 6 attempts spent the whole window READING (27 reads, 0 writes), produced nothing (worktree auto-removed unchanged). Root cause = Rule-1 overload. Diagnosis also surfaced task-13 Concern 1 as REAL: the W3 parse-jobs repo shipped only generic CRUD (create/claim/getById/listByUser); the crown-jewel atomic methods were MISSING.
- **Decomposed along the package boundary:** A (db repo methods) + C (bench-scan, independent) in parallel worktrees; B (parse-photo handler, pure orchestrator over A) sequenced after A lands. Every contract inlined in the prompts so no agent re-explores (the specific thing that stalled the first run).
- **A committed (b7a1c6f):** added resolveJob/commit/markFailed/listItemsByJob/countTeaserJobs + a 6-test integration oracle. **The N=12 contention oracle caught a REAL money-path bug the build agent reported green:** a single-CTE advisory lock serializes execution but NOT the READ COMMITTED snapshot (fixed at statement start, before the in-CTE lock is granted) → all 12 racers read the stale count and inserted past a cap of 3. The agent's worktree passed by timing luck; on main, truly concurrent, it failed 12≠3. **Fixed with migration 0012 resolve_teaser_job — ONE plpgsql fn (SECURITY INVOKER; only touches caller's own rows, no RLS bypass)** where each internal statement re-snapshots after the lock. Additive + reversible. (Also: the agent misattributed its own new methods to "a prior pass" — same self-misattribution as W3; code trusted over narrative, verified from main.)
- **C committed (27beafd):** bench-scan Tier-1 parse-quality oracle (10-label held corpus = external truth; replay/adversary/differential tiers; pure scoreRun, byte-deterministic --json vs pinned baseline). **Gate proven ALIVE by fire-drill from main:** adversary-made-correct → exit 1, baseline-drift → exit 1, committed → exit 0. Wired the keyless replay tier into verify:full (full, ~0.1s) as a test-class check (NOT a budgeted gate — does not touch the Rule-5 ceiling).
- **verify:full GREEN from main both commits:** 92 unit + 91 integration (18 files) + replay clears floor (0.9≥0.75); check-rls 8/8 FORCE; check-definer-search-path clean (0012 is INVOKER, correctly not flagged). Migrations now 0001–0012.
- **B (parse-photo handler) building** (wf_29f38f70-30b) against base b7a1c6f — pure orchestrator over A's methods + the 5-oracle integration test (no-dup-resume, one-winner concurrency, entitlement 402, teaser cap under concurrency, RLS control) with fake ports + a provider call-counter (double-charge guard).
