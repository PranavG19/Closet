# Orchestration — the work frontier + the lessons that made it work

*Regenerated 2026-08-08 from `git log` at `ab25513`. The previous edition was a live tracker with a dead clock: every non-✅ row described a pre-endpoint world (backend "running", frontend "queued", endpoints "blocked — no endpoints exist yet", money "human-gated"), all of which had been false for ~10 commits. An agent reading it would have concluded the backend had no endpoints and the money path was untouchable.*

**How to keep this file honest:** the **Streams** table below is a snapshot and rots. Re-derive it from `git log` + `docs/LAUNCH-READINESS.md` §2/§4 before trusting a row, and update it in the same commit as the work. The **Lessons** section is durable — it is the real reason this file exists.

---

## What gates a stream

Two things: **dependencies** (does the input exist?) and **collisions** (would two streams write the same file / churn the same lockfile?). A stream launches only when both are clear.

Anything outward-facing (publish, send, submit) or irreversible is **human-gated regardless of technical readiness** — those are the `docs/04` escalation triggers. **Exception, and it is a real one:** `CLAUDE.md` grants **full autonomy on the money/entitlement path** (build, verify, commit, merge) as of 2026-08-06. That path is done and committed. Do **not** park it.

---

## Streams — state at `ab25513`

| Stream | State | Note |
|--------|-------|------|
| Specs (`docs/00`–`06` + roadmap) | ✅ done | Re-derived and corrected 2026-08-08; `docs/07-ui-state.md` added. |
| Monorepo scaffold + gates + hooks | ✅ done | The 6 hooks exist and were fire-drilled. **The lint gates the docs promised do not** — see LAUNCH-READINESS §4. |
| Backend design + test taxonomy | ✅ done | `docs/05` + `docs/06`. |
| Backend build W1–W5 | ✅ done | `e85dc01` (W1/W2) → `fb60f22` (W5 money). 16 migrations, 11 repos, 12 routes. |
| Test gauntlet (Tier-1/2/4) | ✅ done | `a0c3edf`. Found a real `wear_log` response-idempotency bug. |
| SEO launch content | ✅ done | `content/` + the 8 self-critique fixes (`ac46ac0`). **Publish is human-gated.** |
| Compliance: deletion + export + legal | ✅ done | `b389a64` (+ `0014`). Erases rows, **not** Storage bytes or the auth identity — deploy-wired step remains. |
| Provider adapters | ✅ done, **quality unmeasured** | `7d1c3e3` + `8db9eda`. `unwiredPorts` is gone. **No adapter has ever received a real provider response** — needs keys. |
| Storage RLS | ✅ authored + tested | `0013`. Exercised against a fabricated stand-in; **never against real Supabase Storage.** |
| Spend throttle | ✅ done | `0015` + `8c33365`. Closed the day-1 cost-abuse hole. |
| Audit-R2 security fixes | ✅ done | `44812c5` — cross-tenant photo read + SSRF, crash lease, webhook poison pill (`0016`). |
| Deploy runbook + preflight | ✅ authored | `8183aa5`. **A.1–A.4 + B.1 have never executed** (14 skipped); their first real run IS the deploy gate. |
| Frontend scaffold | ✅ done, **renders**, 6 defects | `5fbd44a` → `7d1c3e3` → `e51507f` (boots) → `ab25513` (17 screenshots). See `docs/07-ui-state.md`. |
| App Store / Play listing pack | ✅ drafted | `8183aa5` → `content/store/`. Blocked on the product name; the screenshot plan needs fresh captures. |
| **Fix the 6 visual defects** | ◐ **2 of 6 coded, 0 of 6 re-captured** | Safe-area insets + the "Membersh/ip" tab label are fixed in code at `aa025e9`. The AA palette, the missing `fontFamily`, and the paywall price are still open. **No fix is confirmed** — all 17 PNGs are pre-fix, and a re-capture is the only oracle that closes any of these rows. |
| **F1: onboarding scan + reveal** | ⛔ **partly blocked** | The UI is agent-buildable; the **on-device privacy classifier needs a human-curated labeled corpus** and owns the safety go/no-go. No `features/onboarding/` exists. |
| **F2: the purchase call + price** | ⛔ **blocked on the owner** | Needs a pricing decision + a real App Store/RevenueCat product before the call can be written. The paywall currently shows **no price** — a 3.1.2 rejection. |
| F3 / F4 filters + dedupe sheet / F6 builder / F7 transitions / F9 surfacing / B1 quiz | ⏳ agent-unblocked | All backend-complete, all UI-absent. 5 dead mutation hooks in `hooks.ts` want callers. |
| Real parse-quality grading | ⛔ blocked | Needs provider API keys. Then bench-scan against live providers is the first honest measurement of the make-or-break lever. |
| Supabase deploy | ⛔ human-gated | Irreversible. Also the vantage that finally exercises Storage RLS + the service_role wiring. |
| Real-RevenueCat event + populated-migration DOWN | ⛔ human-gated | The two remaining external oracles. A mocked success does not count. |
| Marketing-creator research | ⏳ not started | Needs live web; **sending is human-gated.** |

---

## Collision rules in force

- **One `pnpm-lock.yaml` writer at a time.** Dep installs are sequenced, never concurrent.
- **One writer per file across parallel agents** → each task runs in its own `git worktree`; verify `primaryFiles` are non-overlapping *before* launching. This has been violated once (`b389a64`: two worktrees both touched `repos/index.ts` + `functions/src/account/` because the orchestrator's own prompt gave them the same barrel) and had to be merged by hand.
- **One agent per simulator.** Violated once during the `ab25513` capture, which produced a screenshot whose filename said "populated" while the image showed an error screen.
- **The orchestrator owns integration:** collect worktree results, reconcile, run `verify:full` **from main**. A green panel of sibling agents is self-consistency, not proof.

---

## Lessons (learned the hard way — this is the durable part)

### Workflow authoring

1. **Author phases must WRITE their own task files to disk, not return strings.** The W3 workflow put author + build in one workflow; author agents returned markdown that the orchestrator only writes *after* the workflow ends — but the in-workflow build agent started immediately and could not find its inputs. Agents that called `Write` themselves were found; the string-returners were not. Either the author writes the file, or split author and build into two workflows so files are on disk and committed before any builder starts.

2. **Build agents read task INPUTS from the main working-copy absolute path** (uncommitted-but-present is fine) and **write only inside their own worktree.** Never write into the main checkout from a worktree agent.

3. **Rule-1 overload stalls agents.** One agent reading ~8 files and emitting a nested plan burned 714k tokens with zero writes. A later attempt spent all 6 tries *reading* (27 reads, 0 writes) and produced nothing. Fix: plan coupled work inline, pre-extract patterns (`docs/PATTERNS.md`) so agents don't re-explore, and **inline every contract in the prompt.** Decompose along package boundaries — the W4 recovery split A (db repo methods) ∥ C (bench-scan), then sequenced B (the handler, a pure orchestrator over A).

4. **Don't SendMessage-resume an agent a workflow is still orchestrating.** Two execution threads on one worktree is the risk; in practice it stayed single-writer (verified via monotonic file mtimes) but the agent got confused seeing its own output accumulate. If you must correct a running agent, verify single-writer via mtimes before assuming a race.

5. **Integration tests MUST live under `packages/*/test/`, not `src/`.** The vitest `integration` project globs `packages/*/test/**/*.integration.test.ts`; a `.integration.test.ts` under `src/` is **silently skipped** — it proves nothing while looking green.

### Verification (the expensive lessons)

6. **NEVER trust a build agent's green on a concurrency or money path. Re-run `verify:full` from main and instrument the race.** This has now caught real bugs **four separate times**: W4a (teaser cap blown 12≠3 — a single-CTE advisory lock serializes execution but **not** the READ COMMITTED snapshot, which is fixed at statement start *before* the in-CTE lock is granted) · W4b (a `[200,409]`-exact assertion that was a flaky mirror-oracle over-constraint; the real invariant `visionCalls===1` held in every interleaving) · the gauntlet's `wear_log` 500 race · `8c33365`'s two halves that **did not meet** (the handler bound a throwing `unwiredSpendLimiter`, so production would have 500'd every parse). Agents also repeatedly **misattribute their own output** ("a prior pass", "your live edits") — trust the code, not the narrative.

7. **A mutant without a rebuild is a VACUOUS probe.** vitest resolves `@closet/shared` to built `dist`, so mutating source without `tsc --build` tests nothing. "No tests ran" is not a kill. (Found while re-deriving the `44812c5` SSRF kill.)

8. **A gate that has never gone red is theater.** Fire-drill every gate by injecting the bug it should catch: `check-rls`, `check-definer-search-path`, the bench-scan adversary/baseline tiers, and preflight A.0 were all proven alive this way. Conversely, `verify.mjs` is the *only* real gate list — several "CI gates" the docs promise do not exist, and one was reported "clean" in an earlier RUN-LOG entry when it had never run.

9. **Don't conclude from a single run.** A flaky 57P01 teardown error was first blamed on migration `0013`; removing 0013 went green, but a re-run *with* 0013 also went green. The right move was to loop and measure (~1 run in 2, and it **migrated between test files**, which is what proved it teardown-generic).

10. **A screenshot's filename is not evidence — open the image.** Two bad captures survived until someone looked: one mislabelled state, and one that photographed **an entirely different app** because **port 8081 belongs to fitapp** (and this repo's own `package.json` hardcodes that port). Confirm the bundle identity before trusting a frame. See `docs/07-ui-state.md` §5.2.

11. **Tests cannot see the product.** A 228-test suite never noticed that the paywall displays **no price** — an App Store rejection. Nor that every screen title is under the Dynamic Island. The screenshot oracle found 6 defects in one pass. Some classes of defect have no test-shaped oracle; the corollary is that a green wall is not a claim about the product.

12. **A doc is not evidence either.** This file's previous edition, and `LAUNCH-READINESS`'s, were both confidently wrong within a day of being written. **Counts must carry the command and the commit that produced them**, or they rot silently. Three numbers (migrations, routes, tests) drifted across ~8 docs because every doc hardcoded them.
