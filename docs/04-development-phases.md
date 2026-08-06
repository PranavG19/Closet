# 04 — Development Phases & the Autonomy Model

*How this app gets built mostly-autonomously, and where the human is load-bearing. The governing idea, then the phases, then the enforcement (hooks + instructions — because an operating model that lives only in prose is theater; agent-arch: advisory rules without enforcement don't hold).*

---

## The governing idea

An AI-coded app whose tests are also AI-written is the **universal mirror oracle**: the author grades the author. Every green check means "I agree with myself." So the entire program is organized around one move: **manufacture signals from a vantage the coding agent could not reach.** That is what converts *"an agent built it"* into *"it is verified."*

Two corollaries fall out, and they shape everything below:

1. **Autonomy scales with oracle independence.** A task with a real, external oracle (real Postgres + RLS, a real webhook event, a screenshot, a mutation kill-rate) can be looped on autonomously until done. A task whose only check is a test the same agent wrote cannot — it will confidently ship broken. So we rank work by *how independent its oracle is*, not by how hard the code is.

2. **The human's 20% is almost exactly the agent-arch escalation-trigger set.** Taste/design judgment, the go/no-go on money, App-Store submission, spending ad budget, sending real outreach, legal sign-off — every one is *irreversible, outward-facing, or taste-laden*. That is not a coincidence; it is the same boundary drawn from two directions. **The escalation-trigger list IS the human-work list.** This makes the handoff crisp: agent owns everything reversible and gradeable; human owns the irreversible and the tasteful.

---

## The phases

Each phase has an **autonomy class** and a **human gate**. "Autonomous" means an agent can loop to done against an independent oracle; the gate is the specific irreversible/taste decision the human owns.

### Phase 1 — Backend + APIs · **fully autonomous**
The strongest-oracle regime (the 30% "make-it-unrepresentable" tier). Real Postgres via testcontainers, RLS enforced, mutation testing, contract tests, metamorphic tests for the parse. Data + RLS + endpoints proven before any UI.
- **Human gate:** sign-off on the design doc (this is where taste about *data shape* is cheap to change and expensive later); and the **money/entitlement path**, which is built + verified but never shipped autonomously.
- **Oracle:** real DB with RLS, real RevenueCat webhook events, mutation kill-rate, bench-scan corpus. See [`05-testing-gauntlet.md`](./05-testing-gauntlet.md).

### Phase 2 — Frontend · **agent-built, human owns taste**
Agent implements against the design system and drives the simulator (iOS + Android); the **screenshot is the independent oracle** (unobservable visual output is an escalation trigger — never claim a UI works without seeing it render). Flows, token-compliance, no-crash, a11y are all agent-gradeable.
- **Human gate:** *does it feel premium?* — taste is not capturable by a pixel diff. Human collaborates on design and owns the final visual/feel tests.
- **Oracle:** simulator screenshots, visual-regression diffs, automated a11y audits, Maestro flow completion.

### Phase 3 — Landing page + SEO · **automatable after design**
Agent builds the page against a human-approved design, maximizes SEO, drafts and stages blog posts.
- **Human gate:** **publishing** — content on the open web is outward-facing and semi-irreversible (indexed/cached even if later deleted). Human presses publish on the first batch, then it can run on a cadence.
- **Oracle:** Lighthouse/Core-Web-Vitals, structured-data validators, link/CI checks (all external tools = independent).

### Phase 4 — Marketing research · **AI points, human relates**
Agent mines UGC creators, clusters viral formats/hooks, drafts outreach, ranks targets.
- **Human gate:** **sending** outreach and **spending** ad budget — both reputation/money-irreversible. Agent drafts; human sends. Winning organic formats → human turns into paid ads and boosts.
- **Oracle:** engagement metrics on live content (real-world, maximally independent).

### Phase 5 — The gauntlet · **runs continuously, autonomous**
Not a phase you finish — a **standing adversarial swarm** that runs across all the above. Since it's fully AI-coded, everything testable gets tested, looped until it can't find more. Full spec in [`05-testing-gauntlet.md`](./05-testing-gauntlet.md).
- **Human gate:** none for running it; the human only adjudicates findings that touch an escalation trigger.
- **Oracle:** the whole point *is* the oracle — independent finders + refuters, fire-drills that inject synthetic bugs to prove the gates are alive.

---

## What else is automatable (beyond the five)

Reversible + gradeable, so agents own them:
- **Funnel instrumentation** (scan→paywall→pay) and the funnel dashboard — this *is* the business; wire analytics from day one.
- **Parse-pipeline cost monitoring** — cost-per-correct-outcome, spend alarms (every vision call costs money).
- **ASO / App-Store assets** — keywords, metadata, store screenshots from real sim captures.
- **Review mining** — App-Store reviews → auto-triaged bug/feature backlog.
- **Support content + a triage agent**, i18n sweeps, competitor monitoring.

Human-gated (irreversible/liability):
- **Legal scaffolding** — privacy-policy / ToS *drafts* only; a human (or lawyer) approves. Liability is irreversible.
- **App-Store submission**, **ad spend**, **outreach sending**, **first content publish**.

---

## Why this reaches "few prompts → tested working e2e app"

Completion probability is ~80% task/environment quality, not prompt cleverness (agent-arch axis 12). The five levers, in order of impact:

1. **Independent verification per task is THE lever** (Rule 3). An agent with a real oracle self-corrects in a loop *and knows when it's done*. Every `.code-task.md` MUST carry an oracle the implementing agent did not author. This is the single thing separating "works after a few prompts" from "looks done, is broken."
2. **Decompose to one-context tasks** (Rule 1) — day-sized; change + tests + verification fit one window. `/goal` holds the durable north star above the tasks.
3. **Structural safety shrinks the error space** (Rule 2). Every unsafe state made unrepresentable (RLS FORCE, secret handles, the on-device gate) is a way the agent *can't* burn a loop going wrong. Fewer degrees of freedom → higher completion odds.
4. **Legibility = cheap orientation** (axes 15/37). Generated `manifest.json`, inline ADR pointers, a ≤3000-token spine. Orient in ~2 reads → finish; thrash exploring → run out of context. (This is why the manifest/conventions machinery is scaffolded *first*.)
5. **Durable memory = commits + regression tests, not a prose blob** (axis 13: "learning is a failing test, not a memory entry"). A prose memory rots; a regression test re-enforces itself forever *and is an oracle*. State lives in commits (the handoff) + a thin `RUN-LOG` + `BUG-QUEUE`, surfaced every session by the session-start hook.

**The recipe:** `/goal` (durable intent) → spec → decompose into day-sized tasks each with an independent oracle → structural safety so it can't wander → legible repo so orientation is cheap → the standing gauntlet as the outside oracle → memory as commits + regression tests → escalation triggers route the irreversible/taste 20% to the human.

---

## Enforcement — how this is *forced*, not suggested

The model above only works if it's mechanical. Each rule below is wired to a hook or a gate, mirroring fitapp. (Some land with the code they guard — noted.)

| Rule | Enforcement | Status |
|------|-------------|--------|
| No unverified "done" | **`verify-stop` Stop hook** — proves `pnpm verify:full` ran against the current tree via a tree-hash stamp; blocks ending the turn otherwise | **live in scaffold** |
| No secret leaks into context | **`secret-file-guard`** PreToolUse hook (Bash + Read) — source `.env.*`, never read it | **live in scaffold** |
| No destructive DDL ad-hoc | **`db-guard`** PreToolUse hook — DROP/TRUNCATE must be an approved numbered migration | **live in scaffold** |
| No dangerous git | **`git-guard`** — blocks force-push, push-to-default, `--no-verify`, staging secrets | **live in scaffold** |
| Fast local signal | **`posttool-typecheck`** — incremental `tsc --build` on the edited package after every Edit/Write | **live in scaffold** |
| Session state surfaced | **`session-start`** hook — prints RUN-LOG tail + open BUG-QUEUE + escalation queue | **live in scaffold** |
| Agent can't edit its own cage | `conventions.json` `humanOwnedPaths` → generated CODEOWNERS covers `.claude/`, hooks, gates, tsconfig, migration approvals | **live in scaffold** |
| Every task carries an independent oracle | `.code-task.md` format requires a "Verification requirements / independent signal" section; a task without one is rejected at decomposition | **enforced at task authoring** |
| Money path human-gated | AGENTS.md STOP list + the entitlement path parked for human review; webhook verified against a *real* event | **wired with the money task** |
| RLS on every tenant table | `check-rls` gate (real Postgres, `SET LOCAL ROLE app_user`) | **lands with the db package** |
| Gate budget ≤ 6 | `check-budget` gate over `gate-budget.json` (generated from `conventions.json`) | **lands with first budgeted gate** |
| Learning persists as a test | `verify-stop` soft nudge: a `fix(` commit touching no regression test / KB entry gets a one-time reminder | **live in scaffold (nudge)** |

**The meta-rule (agent-arch): the agent cannot weaken its own guardrails.** Editing a hook, `conventions.json`, `.claude/settings.json`, a gate script, or tsconfig in the same change as the code it would unblock is auto-rejected. Those paths are human-owned. A blocked gate is reported as a finding, never disabled.

*Companion doc: [`05-testing-gauntlet.md`](./05-testing-gauntlet.md) — the tiered, oracle-independence-organized test framework (authored by the running backend-design workflow).*
