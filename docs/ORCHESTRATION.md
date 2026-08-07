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
| **Backend decomposition** | ▶ running (wf_3427de72-828, resumed after transient ENOTFOUND) | specs exist |
| **SEO launch content** (pillar + 6 posts + landing copy) | ▶ running (wf_8b42ab5e-854) | needs only product story; **publish = human-gated** |
| Backend **build** (wave 1: migrations + RLS + check-rls) | ⏳ queued | needs the wave plan from decomposition; then parallel worktrees, one-writer-per-file |
| Frontend scaffold (Expo shell + `useTokens()`) | ⏳ queued | **collision:** writes `packages/mobile` + churns `pnpm-lock.yaml` — must NOT run while backend-build agents install deps. Sequence after wave-1 dep install settles. Visual taste = human. |
| Endpoint/contract testing + the gauntlet build | ⛔ blocked | no endpoints exist yet — build them first |
| Marketing-creator research + outreach drafts | ⚠️ partial | needs live web for real creator lists; drafting is doable, **sending = human-gated** |
| Money/entitlement path (wave 5) | ⛔ human-gated | authored but parked for human review before ship (Rule 6) |
| App Store assets / ASO | ⏳ later | needs real sim screenshots (frontend phase) |

## Collision rules in force

- **One `pnpm-lock.yaml` writer at a time.** Backend-build dep installs and the frontend
  scaffold both touch it → they are sequenced, never concurrent.
- **One writer per file across parallel build agents** → each wave-1 task runs in its own
  `git worktree`; the decomposition validator confirmed non-overlapping `primaryFiles`.
- **The orchestrator (this session) owns integration**: collects worktree results, reconciles,
  runs `verify:full` on the merged tree — a green panel of sibling agents is self-consistency,
  not proof.
