# bench-scan fixtures — the held parse-quality corpus

This directory is the **held corpus** the `bench-scan` oracle scores against
(docs/05 Tier-1 "Bench-scan differential corpus"). It is data, not code; the
harness is `scripts/bench-scan.mjs` and the builder is
`scripts/bench-scan-build-corpus.mjs`.

## The anti-mirror premise (read this first)

`labels.json` is **EXTERNAL TRUTH — NOT pipeline output.** The per-photo
attribute labels were produced by a source that is *not* the parse pipeline
(hand-authored / human-curated in `source/corpus.json`, the human-owned source
of truth). The pipeline output being graded lives in `recordings/`. Grading
pipeline output against labels the pipeline never emitted is the whole point:
it is the one parse-quality signal the author of the pipeline (or the author of
the scorer) **structurally cannot fake** — the mirror oracle docs/05 exists to
defeat. If you ever find yourself regenerating `labels.json` *from* a recording,
stop: you have collapsed the oracle into a mirror.

## Layout

```
source/corpus.json     HUMAN-OWNED source of truth: { images[], labels[], floors }
                         images = upstream image metadata (id,width,height,sha256) —
                                  the "generation" the baseline is pinned to
                         labels = external truth (the held corpus columns)
                         floors = human-set quality bar
labels.json            DERIVED from source (the corpus the scorer joins on)
baseline.json          DERIVED: { floors, replay: <pinned honest score surface>,
                                  sourceFingerprint }
recordings/honest/*    one committed AIVisionResult+CutoutResult per corpus id —
                         a real/representative pipeline output. Keyless replay scores these.
recordings/adversary/* the deliberately-WRONG recordings (systematic mis-categorisation).
```

`labels.json` and `baseline.json` are **generated** — never hand-edit them; edit
`source/corpus.json` and run the builder (below).

## The three tiers (and what each proves)

- **replay** (`--tier=replay`, the default; **keyless**, runs in CI on every merge):
  scores `recordings/honest/*` against `labels.json`, asserts every per-attribute
  and the aggregate score `≥` its floor in `baseline.json`, and **byte-compares**
  the deterministic `--json` surface to the pinned `baseline.replay`. A
  scoring-logic change or a silent baseline drift is caught by a byte diff — a
  signal no self-confidence can hide. Costs nothing, needs no API key.
- **adversary** (`--tier=adversary`; nightly): runs the deliberately-wrong
  recordings through the *identical* scorer + floors and asserts the aggregate
  **collapses strictly below the floor**. Reporting the bad model as failing is
  the gate *working* (exit 0). **The gate must always ship with ≥1 adversary
  proving it bites** — a floor no known-bad model can fall below is a dead gate.
- **differential** (`--tier=differential --a=<dir> --b=<dir>`; nightly): scores
  two recording sets on the identical corpus + scorer and reports per-attribute
  `a - b` deltas and which side clears the floor. Makes an `AIVisionPort` swap a
  *decidable comparison* (docs/06 §5), not a vibe. A report by default; pass
  `--gate` to make side A's floor a hard gate.
- **live** (`--tier=live`; nightly): placeholder for a real-provider run. Reads
  its key only via `envValue(...)` and **reports "skipped" (exit 0)** when absent
  so keyless CI is never blocked. No live adapter is wired in this task.

## The gate is proven ALIVE (red → green), not merely present

docs/05 §(b) requires the gate be shown able to go **red**, or it is a
rubber stamp. Demonstrated:

- **adversary can fail.** Replace `recordings/adversary/*` with the honest
  (correct) recordings, or set the aggregate floor to `0`, and `--tier=adversary`
  **exits non-zero** with `adversary passed — gate dead` / `floor is 0 —
  discriminates nothing`. Restore the real adversary and it returns to exit 0.
- **replay drift is loud.** A one-character edit to a pinned score in
  `baseline.json` (or to a recorded value) makes `--tier=replay` exit non-zero
  and print the byte diff; a floor raised above the honest score names the
  offending attribute.

On the committed fixtures: honest aggregate `0.9` clears the `0.75` aggregate
floor; the adversary aggregate is `0.0`, strictly below it. The floor straddles
the two models on the **same number** — the honest model above, the adversary
below — per docs/05.

## Per-attribute comparison

- `category`, `pattern`, `formality`, `season`: **exact enum match** against the
  label (values drawn from `AIVisionResultSchema`).
- `primaryColor`: **color-bucket match**, not raw hex equality. Each hex is
  mapped to its nearest documented palette anchor (squared-RGB distance); buckets
  are compared. Raw hex equality would score every near-shade (`#fefefe` vs
  `#ffffff`) as a miss and make the column meaningless. The anchor palette is
  fixed and committed in `bench-scan.mjs` (`COLOR_ANCHORS`).
- `cutout`: a committed, **byte-comparable numeric summary** — `aspectRatioBucket`
  (from the recording's integer dims) + `hasAlpha`. This keyless tier does **not**
  do pixel IoU over binary masks; **pixel-IoU-over-reference-cutouts is a nightly
  live extension**, not silently dropped.

## How to add a corpus row / a new attribute

- **A new photo:** add its image metadata + label to `source/corpus.json`
  (`images[]` and `labels[]`), add a matching `recordings/honest/<id>.json` and
  `recordings/adversary/<id>.json`, then run the builder (below) to regenerate
  `labels.json` + `baseline.json`. A label with no recording (or vice versa) is a
  **hard error** — coverage drift is never a silently smaller `n`.
- **A new attribute:** docs/05 extension rule — *every attribute gets a labeled
  column and a numeric floor.* Add the column to the labels + recordings, add its
  floor to `source/corpus.json.floors`, extend `ATTRIBUTES` and the compared
  tokens in `scoreRun`, then regenerate. For a new provider/metamorphic relation,
  add the invariance relation for that attribute before trusting the new adapter
  (docs/06 §5).

## Regenerating + the generation-drift gate

```
node scripts/bench-scan-build-corpus.mjs           # regenerate labels.json + baseline.json
node scripts/bench-scan-build-corpus.mjs --check    # generation-drift gate (no-op; non-zero on drift)
```

`--check` is a no-op that exits `0` when the committed fixtures match what would
be regenerated, and **non-zero naming the drift** when the source image set (or
labels/floors) changed but the fixtures were not regenerated — so the committed
baseline provably reflects the real held images (docs/05).

## Execution model — keyless-CI vs live-nightly split

Per docs/05 §(a): the **replay tier runs on every merge** (keyless, in
`verify:full`); **live-provider + adversary + differential run nightly** (cost +
latency). Where the replay tier plugs into `verify:full` (named, **not** wired
here — `scripts/verify.mjs` and `conventions.json` are orchestrator/human-owned):
a new step in `scripts/verify.mjs`'s `STEPS` array —

```
{ name: "bench-scan-replay", cmd: "node", args: ["scripts/bench-scan.mjs", "--tier=replay"] }
```

— registered in `conventions.json` `gateBudget` (weight ~0, keyless, no DB), and
`bench-scan-build-corpus.mjs --check` alongside `gen:check` as the fixture-drift
gate. The adversary/differential/live tiers run in the nightly job, not the
per-merge wall.
