# Orchestration state — agent-unblocked work frontier

Live tracker for the goal: *orchestrate ultracode workflows for all agent-unblocked tasks.*
"Agent-unblocked" = physically possible for an agent NOW (no missing dependency, no missing
human-gated input). Updated as workflows land. Newest state wins.

## The critical distinction (why not everything runs at once)

Two things gate a stream: **dependencies** (does the input exist?) and **collisions**
(would two streams write the same file / churn the same lockfile?). A stream is launched
only when both are clear. The money path and anything outward-facing (publish, send, submit,
spend) are **human-gated** regardless of technical readiness — those are the escalation
triggers from docs/04, and they are the human's 20%.

## Streams

| Stream | State | Gate / why |
|--------|-------|-----------|
| Specs (docs 00–06 + roadmap) | ✅ done, committed | — |
| Monorepo scaffold + gates + hooks | ✅ done, committed, `verify:full` green | — |
| Backend design + test taxonomy | ✅ done (docs 05/06) | — |
| **Backend decomposition** | ✅ done (workflow stalled twice on Rule-1 overload → planned INLINE in tasks/WAVE-PLAN.md; 8 W1+W2 task files authored + committed) | — |
| **SEO launch content** (pillar + 6 posts + landing copy) | ✅ done → `content/` (publish human-gated); self-critique in content/README.md | — |
| Backend **build** W1 (packages/db) + W2 (packages/shared) | ▶ running (wf_b8de6bae-08a, 2 worktree agents) | task files exist; disjoint packages; real-Postgres + property oracles |
| Frontend scaffold (Expo shell + `useTokens()`) | ⏳ queued | **collision:** writes `packages/mobile` + churns `pnpm-lock.yaml` — must NOT run while backend-build agents install deps. Sequence after wave-1 dep install settles. Visual taste = human. |
| Endpoint/contract testing + the gauntlet build | ⛔ blocked | no endpoints exist yet — build them first |
| Marketing-creator research + outreach drafts | ⚠️ partial | needs live web for real creator lists; drafting is doable, **sending = human-gated** |
| Money/entitlement path (wave 5) | ⛔ human-gated | authored but parked for human review before ship (Rule 6) |
| App Store assets / ASO | ⏳ later | needs real sim screenshots (frontend phase) |

## Workflow authoring lessons (learned the hard way)

1. **Author phases must WRITE their own task files to disk, not return strings.** The W3 workflow put author + build in one workflow; author agents returned markdown strings that the orchestrator writes to disk only *after the workflow ends* — but the in-workflow build agent started immediately and couldn't find 09a/11/13. Fix: an author agent should `Write` its file to `tasks/` itself (some did — 09b/10/12/14 — those were found; the string-returners weren't). For future waves: author agents write files; or split author (workflow 1)から build (workflow 2) so files are on disk + committed before any builder starts.
2. **Build agents read task INPUTS from the main working-copy absolute path** (uncommitted-but-present is fine) and **write only inside their own worktree.** Never write into the main checkout from a worktree agent — the orchestrator integrates worktrees and two writers into main collide.
3. **Rule-1 overload stalls agents.** One agent reading ~8 files + emitting a nested plan = 700k tokens, no progress. Plan coupled work inline; fan out only independent per-item authoring with patterns pre-extracted (docs/PATTERNS.md).

## Collision rules in force

- **One `pnpm-lock.yaml` writer at a time.** Backend-build dep installs and the frontend
  scaffold both touch it → they are sequenced, never concurrent.
- **One writer per file across parallel build agents** → each wave-1 task runs in its own
  `git worktree`; the decomposition validator confirmed non-overlapping `primaryFiles`.
- **The orchestrator (this session) owns integration**: collects worktree results, reconciles,
  runs `verify:full` on the merged tree — a green panel of sibling agents is self-consistency,
  not proof.
