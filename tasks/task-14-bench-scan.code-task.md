# Task: bench-scan parse-quality oracle — replay + adversary + differential

**slug:** `task-14-bench-scan`
**wave:** 4
**reversibility:** reversible (scripts + fixtures are additive files; deleting them fully reverts — no schema, no data, no migration, no runtime code path touched)

## 1. Intent

The pipeline that turns a photo into garment attributes is the make-or-break conversion lever (docs/01 F1 aha), and it is authored by the same agent that would grade it — the **mirror oracle** docs/05 exists to defeat. This task builds the one oracle for parse *quality* whose grading signal the author structurally cannot fake: a **held corpus** whose per-photo labels were produced by a source that is **NOT the pipeline** (external/human labels the code never emitted), scored against pipeline output.

Concretely, `bench-scan` is the harness and IS the oracle (docs/05 Tier-1 "Bench-scan differential corpus"). It runs three tiers, each escaping the author's reach a different way:

- **Replay tier (keyless, free):** score committed `AIVisionResult`/`CutoutResult` recordings against the held labels, with deterministic byte-compared `--json` output — so a scoring-logic change or a silent baseline drift is *loud*, and the tier costs nothing and needs no API key.
- **Adversary tier (proves the gate bites):** run a deliberately-**wrong** model (systematically mis-categorizing) through the identical scorer and assert the accuracy score **collapses below the floor**. A gate that stays green on a known-bad model is a dead gate; this tier is the fire-drill that proves the floor discriminates.
- **Differential (provider A vs B):** score two `AIVisionPort` adapters on the identical corpus and report per-attribute deltas — making an `AIVisionPort` swap a decidable comparison, not a vibe.

**Green = the adversary fails the floor, the replay tier is deterministic (byte-identical `--json` across runs and against the committed baseline), and the honest recording clears the floor.** If the adversary ever passes, or replay drifts, the harness exits non-zero.

## 2. Context and constraints

**Spec reference:**
- docs/05 — **Tier-1 "Bench-scan differential corpus (independent labels, adversary-validated gate)"** is the authoritative description of this oracle: held corpus labeled by a non-pipeline source, keyless byte-compared replay tier, adversary tier proving the gate bites, provider differential, and a generation-drift check on upstream image metadata. Execution-model table (docs/05 §(a)): **replay tier runs on every merge** (keyless, in `verify:full`); **live-provider + adversary + differential run nightly** (cost + latency).
- docs/06 §5 — `AIVisionPort` ("A/B-swappable against the bench-scan oracle without touching callers"; only Zod-validated attributes cross) and `CutoutPort` (normalized front-view cutout; `CutoutResultSchema`). These are the contracts the corpus scores against.
- docs/06 §4 `parse-photo` — the endpoint whose quality this benchmark protects (attributes + cutout). This task does **not** call or modify the endpoint; it scores the *port outputs* the endpoint composes.
- docs/06 §8.3 — the privacy-gate classifier recall is *also* a bench-scan-style corpus oracle, but it is **frontend/device-ML and explicitly out of scope here** (docs/05 "Out-of-scope"). Do not build it.

**Codebase patterns** (from docs/PATTERNS.md, inlined — backup path `../fitapp/scripts/bench-scan*` but do NOT open it):
- This is **not** a repo, handler, or migration. It is a standalone Node ESM script layer under `scripts/` (sibling to `scripts/verify.mjs`, `scripts/gates/*.mjs`). The Repo-factory / AuthedHandler / migration blocks in PATTERNS do **not** apply — no `QueryExecutor`, no `exec`, no `auth.uid()`, no SQL, no DB. If you find yourself importing from `packages/db` or opening a Postgres connection you are in the wrong layer.
- Match the existing `scripts/` convention: `#!/usr/bin/env node`, ESM (`import`), a top-of-file comment block stating what the script is and where it runs (see `scripts/verify.mjs`, `scripts/gates/check-rls.mjs`), a `main()` that sets `process.exitCode`/exits non-zero on failure, and human-readable stderr progress plus machine-readable `--json` on stdout.
- **Reuse the real port contracts** from `@closet/shared` — import `AIVisionResultSchema` / `AIVisionResult` and `CutoutResultSchema` / `CutoutResult` (from `packages/shared/src/ports/`), and `parseBoundary` (from `packages/shared/src/parse.ts`). The scorer parses every recording and every label row through these schemas at the boundary — a recording that no longer matches the port contract must fail loudly, not be silently coerced.

**Code-style rules (CLAUDE.md, mandatory):**
- `const` over `let`/`var`; immutable by default — never mutate a loaded corpus/recording array in place (copy before sort; a stable deterministic sort is required for byte-reproducible `--json`).
- Early returns over nested conditionals.
- **Parse, don't cast** — every external input (label rows, recordings, adversary/differential outputs) crosses `parseBoundary(Schema, x)` before it is reasoned over. No `as`-cast of untrusted JSON. Define the corpus-label and baseline schemas in this task with the same lib the repo uses (`zod`, as in the ports).
- No `supabase.from()` anywhere (lint-banned outside `packages/db`).
- Config/secrets via `envValue(...)`, **never** `process.env` directly. The replay + adversary tiers read **no** secret (keyless by construction — that is the point of committed recordings); only a live/differential run against a real provider reads a key, and it does so through `envValue` and **skips with a clear message (exit 0, tier reported "skipped") when the key is absent** so CI's keyless replay tier is never blocked by a missing secret.
- No `Math.random`, no `Date.now()`, no wall-clock in the scoring path — determinism is the whole product of the replay tier. Any timestamp in `--json` must be omittable/pinned; the byte-compared surface must contain no nondeterministic field.
- Structured output only; prefer no ad-hoc `console.log` in the scored path beyond the defined stderr-progress / stdout-`--json` split.

**What NOT to touch (one-writer-per-file — touch ONLY these):**
- `scripts/bench-scan.mjs` (the harness + scorer + the three tiers + CLI)
- `scripts/bench-scan-build-corpus.mjs` (the corpus/baseline builder + generation-drift check)
- the bench fixtures directory and its `README.md` (see req 1 for the exact layout) — held labels, committed recordings, the adversary recording, and the committed baseline
- Do **NOT** edit `scripts/verify.mjs` or `conventions.json` (orchestrator/human-owned — wiring the replay tier into `verify:full` is done by the orchestrator, not this task; state where it plugs in but do not write it).
- Do **NOT** edit any migration, repo, handler, `packages/shared` source, or the `parse-photo` endpoint. Do **NOT** add an npm dependency beyond what `@closet/shared` already provides (`zod` is available transitively; if the script needs its own dep it must be justified — default is zero new deps).

## 3. Technical requirements (numbered, dependency-ordered)

1. **Corpus + baseline on-disk layout (define it here, commit real fixtures).** Create a fixtures directory (e.g. `scripts/bench-scan-fixtures/`) containing:
   - `labels.json` — the **held corpus**: an array of `{ id, category, primaryColor, pattern, formality, season }` (attribute columns drawn from `AIVisionResultSchema`) plus optional cutout-reference fields (see req 6). These labels are the **external truth**; the README (req 8) MUST state they were NOT produced by the pipeline. Small but real (≥ ~8 photos spanning multiple categories/patterns so accuracy is a meaningful fraction, not 0/1).
   - `recordings/honest/*.json` — one committed `AIVisionResult` (+ `CutoutResult` where scored) per corpus `id`, representing a real/representative pipeline output. Keyless replay scores these.
   - `recordings/adversary/*.json` — the deliberately-wrong recordings (systematically mis-categorized; see req 4).
   - `baseline.json` — the committed numeric **floors** per attribute (and the aggregate accuracy floor) plus the pinned expected replay score, so drift is byte-detectable.
   Every file loaded is `parseBoundary`'d against a schema defined in the harness; a malformed fixture fails the run.

2. **Scorer (pure, deterministic, the shared core of all three tiers).** A pure function `scoreRun(recordings, labels) -> { perAttribute: Record<attr, number>, aggregate: number, n: number, misses: [...] }`. Joins recordings to labels by `id` (a recording with no matching label, or a label with no recording, is a **hard error**, not a silent skip — coverage drift must be loud). Per-attribute accuracy = fraction of ids where the recorded value exactly equals the label (define per-attribute equality: exact enum match for category/pattern/formality/season; for `primaryColor` define the color-bucket comparison used — nearest documented bucket, stated in a one-line *why* comment, not raw hex equality that would make every near-match a miss). No I/O inside `scoreRun`; it takes already-parsed arrays. Same inputs → byte-identical output.

3. **Replay tier (keyless, byte-compared).** `bench-scan --tier=replay` (and the default when no live key) loads `labels.json` + `recordings/honest/*`, runs `scoreRun`, and:
   - asserts the aggregate + every per-attribute score **≥ its floor** in `baseline.json`; below floor → non-zero exit with the offending attribute(s) named.
   - emits deterministic `--json` (stable key order, stable id sort, no clock/random field) and **byte-compares it against the pinned expected score surface in `baseline.json`** (or a committed `baseline.json`'s replay block) — a mismatch (scoring logic changed, or baseline drifted) → non-zero exit showing the diff. Reads no secret; runs in CI's `verify:full` on every merge.

4. **Adversary tier (proves the gate bites).** `bench-scan --tier=adversary` scores `recordings/adversary/*` — a recording set deliberately built to systematically mis-categorize (e.g. every `category` shifted to a wrong-but-valid enum value) — through the **identical `scoreRun` + identical floors**. It asserts the aggregate accuracy **collapses strictly below the floor**, and **exits non-zero if the adversary PASSES** (a passing adversary means the floor doesn't discriminate — a dead gate). The adversary recordings are valid `AIVisionResult`s (they pass `parseBoundary`); they are wrong, not malformed — the point is that a well-formed but low-quality model must fail the *quality* gate.

5. **Differential (provider A vs B).** `bench-scan --tier=differential --a=<recordingDirOrAdapter> --b=<...>` scores two recording sets on the **identical corpus + scorer** and reports per-attribute deltas (`a - b`) and which clears the floor. It is a **report**, not a hard gate by default (justifies an `AIVisionPort` swap without touching callers); exit code reflects only whether each side independently clears its floor if `--gate` is passed. This is the objective basis for a port swap per docs/06 §5.

6. **Cutout quality column (if scored).** If `CutoutResult` is scored, add a cutout-reference field to labels (e.g. an expected mask/geometry summary that a committed recording can be compared against deterministically — do NOT require pixel IoU over binary blobs in this keyless tier; define a committed, byte-comparable numeric summary and its floor). If a real IoU-over-reference-cutouts comparison can't be made keyless/deterministic here, scope cutout scoring to the numeric summary and NOTE the pixel-IoU-vs-reference variant as a nightly live extension, not silently dropped.

7. **Corpus builder + generation-drift check.** `scripts/bench-scan-build-corpus.mjs`:
   - (re)generates/normalizes `labels.json` + `baseline.json` from the source corpus, and
   - implements the **generation-drift check** (docs/05): re-read the upstream corpus image metadata (dimensions/hash/id set) and **fail on drift** so the committed baseline provably reflects the real held images. Running the builder in `--check` mode (mirroring `gen-conventions.mjs --check`) must be a no-op that exits non-zero if the committed fixtures are stale vs the source — this is the drift gate.

8. **README (the corpus is a living oracle).** The fixtures `README.md` MUST state: (a) the labels are **external truth, NOT pipeline output** — the anti-mirror premise; (b) the three tiers and what each proves; (c) how to add a corpus row (a new attribute → a new labeled column + a new floor; docs/05 extension rule "every attribute gets a labeled column and a numeric floor"); (d) that **the gate must always ship with ≥1 adversary proving it bites**; (e) the keyless-replay-in-CI vs live-nightly split and where the replay tier plugs into `verify:full` (named, not wired).

## 4. Acceptance criteria (Given-When-Then)

- **Replay passes honest recordings:** Given the committed `labels.json` + `recordings/honest/*` + `baseline.json`, When `node scripts/bench-scan.mjs --tier=replay --json`, Then aggregate + every per-attribute score ≥ floor and exit 0.
- **Replay is byte-deterministic:** Given two consecutive replay runs (and a third after a no-op re-serialize), When each emits `--json`, Then the three outputs are **byte-identical** to each other and to the pinned surface in `baseline.json`.
- **Baseline-drift is loud:** Given a one-character edit to a floor or the pinned replay score in `baseline.json` (or to a recorded value), When `--tier=replay`, Then exit is non-zero and the diff/offending attribute is named. (Fire-drill for the drift gate.)
- **Adversary collapses below floor:** Given `recordings/adversary/*`, When `--tier=adversary`, Then aggregate accuracy is strictly below the floor and exit 0 (the gate correctly reports the bad model as failing).
- **Gate-bites guard:** Given an adversary recording accidentally made *correct* (or the floor set to 0), When `--tier=adversary`, Then exit is **non-zero** ("adversary passed the floor — gate does not discriminate"). This proves the adversary tier itself can fail.
- **Differential reports deltas:** Given honest vs adversary as A vs B, When `--tier=differential`, Then per-attribute `a - b` deltas are reported and A clears / B fails the floor.
- **Malformed fixture fails:** Given a recording that violates `AIVisionResultSchema` (unknown category), When any tier loads it, Then `parseBoundary` rejects at the boundary — no partial scoring over bad data.
- **Coverage drift fails:** Given a label with no matching recording (or vice versa), When scoring, Then a hard error names the missing `id` — never a silently smaller `n`.
- **Missing key ≠ broken CI:** Given no live-provider key in env, When the default/replay invocation runs, Then it scores the committed recordings keyless and exits 0; only an explicit `--tier=live`/`--differential` against a real adapter reports "skipped" (exit 0) with a clear message.
- **Generation-drift gate:** Given `bench-scan-build-corpus.mjs --check` against unchanged source, Then exit 0; given the source corpus image set changed but fixtures not regenerated, Then non-zero with the drift named.

## 5. Verification requirements — the independent oracle

**Tier:** docs/05 **Tier-1 "Bench-scan differential corpus"**. This task is unusual: **the deliverable IS the oracle.** The independent grading signal is not a separate test file that mocks the harness — it is the harness run against real committed fixtures, where the labels are external truth the author's code never produced and the adversary is a known-bad model the floor must reject. A mock here would reintroduce the mirror oracle this whole tier exists to kill; do **not** stub `scoreRun`, the labels, or the recordings behind a fake.

The oracle is satisfied when, run against the **real committed fixtures**:

1. **Replay is deterministic and honest-passes.** `--tier=replay --json` is byte-identical across ≥2 runs and matches the pinned baseline surface, and the honest recordings clear every floor. (Determinism is the non-author signal: a scoring-logic change is caught by a byte diff no self-confidence can hide.)
2. **The adversary fails the floor (the gate bites).** `--tier=adversary` over the deliberately-wrong recordings drives aggregate accuracy **strictly below** the committed floor and the tier reports failure-of-the-model as success-of-the-gate. This is the fire-drill proving the floor discriminates — the strongest anti-mirror device for parse quality.
3. **The adversary tier can itself fail (guard the guard).** Demonstrated red-first: with the adversary recordings temporarily replaced by correct ones (or the floor set to 0), `--tier=adversary` **exits non-zero** ("adversary passed — gate dead"). Restore, and it goes green. Note this red→green transition in the harness/README header so the gate is proven *alive*, not merely present (docs/05 §(b) gate-liveness).
4. **Differential is decidable.** `--tier=differential` over two recording sets produces per-attribute deltas and a clear-the-floor verdict per side — an `AIVisionPort` swap becomes objective (docs/06 §5), not a vibe.

**Green =** on the committed corpus: replay is byte-deterministic and clears the floor, the adversary collapses below the floor (and the adversary tier is shown able to fail on a passing model), the differential reports deltas, and `bench-scan-build-corpus.mjs --check` confirms the fixtures are not stale vs source. No tier may be `--skip`'d green, and the floor may not be weakened to a value the honest recording trivially clears with the adversary alongside it — the adversary MUST land below and the honest above the same number.

**Red-first note:** the byte-compared replay surface and the adversary-below-floor assertion must each be shown failing (drift the baseline; make the adversary correct) before the harness is declared done — proving the harness discriminates rather than rubber-stamping.

## 6. Provider surface (this task touches port outputs)

This task consumes the `AIVisionPort` / `CutoutPort` **result contracts** (`AIVisionResultSchema`, `CutoutResultSchema`) as the shape of every recording and label column, per docs/06 §5. It does **not** call a live provider in the keyless tiers and **must not** hardcode a vendor request/response type — recordings are the port's *result* shape only, exactly what crosses the Zod boundary. The differential tier is the mechanism by which a new adapter (a candidate model behind `AIVisionPort`) is proven against the identical corpus before it is wired — per docs/05's rule that "every provider considered behind a port must clear the same corpus before it can be wired," and the metamorphic extension rule "add the invariance relation for that attribute before trusting the new adapter." Any live-provider path reads its key only via `envValue(...)` and degrades to "skipped" when absent.

## Metadata

- **Parent spec:** docs/05 Tier-1 "Bench-scan differential corpus (independent labels, adversary-validated gate)"; docs/06 §5 (`AIVisionPort`/`CutoutPort`), §4 (`parse-photo`), §8.3 (privacy-gate corpus — out of scope, noted).
- **Step:** wave 4 (parse pipeline; depends on the `AIVisionPort`/`CutoutPort` result contracts from W2 task-06 — schemas only, not the endpoint).
- **Demo (isolatable):** `node scripts/bench-scan.mjs --tier=replay --json` (keyless, no DB, no key) prints the deterministic score surface and exits 0; `node scripts/bench-scan.mjs --tier=adversary` exits 0 while reporting the adversary below floor; `node scripts/bench-scan-build-corpus.mjs --check` confirms fixtures fresh. Nothing here boots Postgres or a container.
- **Complexity:** M — the logic is small and pure, but byte-deterministic `--json`, the adversary-can-fail guard, and the generation-drift check each need care to avoid a green-but-hollow gate.
- **Dependencies:** `@closet/shared` port schemas + `parseBoundary` (import, do not redefine). No DB/functions wave dependency at runtime. No new npm dependency. Replay + adversary + differential are keyless; only an explicit live run reads a provider key.
- **Where it plugs in (not wired here):** replay tier → `scripts/verify.mjs` `verify:full` on every merge; live + adversary + differential → nightly (docs/05 §(a) execution table). Wiring is orchestrator-owned.
