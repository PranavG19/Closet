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
