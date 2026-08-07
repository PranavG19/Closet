# Task: task-07-harmony-and-dedupe — Color harmony rules (F9) + phash dedupe compare (F4)

## 1. Intent
The system can decide, for any two garment colors, a stable harmony verdict, and for any two perceptual-hash fingerprints, whether they are near-duplicate photos. Both decisions are pure, deterministic, on-device functions with no I/O, no clock, and no randomness — same inputs always yield the same verdict. Correctness is a structural property (determinism, symmetry, totality), not a curated example set.

## 2. Context and constraints
- **Spec ref:** docs/01 F9 (garment-to-garment color harmony rule table), docs/01 F4 (phash Hamming-distance dedupe). docs/06 "on-device pure fns" — these live in `packages/shared`, are called from mobile and from the parse pipeline, and MUST NOT reach for network, DB, filesystem, or `Date.now()`.
- **Codebase patterns (from docs/PATTERNS.md, inlined):** these are pure library functions in `shared`, not repos or handlers. They do NOT touch the "Repo factory over injected QueryExecutor" seam, the "Handler" seam, or migrations. No `supabase.from()` here (that lint ban is about the DB seam; `shared` has no DB access at all). Backup reference only if a signature is ambiguous: `../fitapp/packages/shared/src` — but do NOT open it; everything needed is in this file.
- **Code-style rules (CLAUDE.md, mandatory):**
  - `const` over `let`/`var`; no reassignment unless real.
  - Early returns over nested conditionals; small single-purpose functions.
  - **Parse, don't cast:** inputs cross a boundary → validate with the shared boundary parser (`parseBoundary(Schema, x)`) or a narrowing type guard; never `as`-cast an untrusted phash string or color into the typed domain.
  - Names say what they hold/do — no bare `data`/`temp`/`result`.
  - No `process.env` (use `envValue` if config ever needed — it is NOT needed here; these fns take no config).
  - Use `git grep` for search; structured logger only if logging (these pure fns should not log).
  - Immutable: the harmony rule table is a frozen constant; functions return new values, mutate nothing.
- **What NOT to touch:** any migration, any `*.repo.ts`, any handler under `packages/functions`, `packages/db`, `packages/mobile`, and any other file in `packages/shared` except the four named below. One-writer-per-file: this task writes ONLY `packages/shared/src/harmony.ts`, `packages/shared/src/dedupe.ts`, `packages/shared/src/harmony.test.ts`, `packages/shared/src/dedupe.test.ts`.
- **Reversibility class:** reversible (new pure modules + tests; no schema, no data, no contract with a live consumer yet).

## 3. Technical requirements (numbered, dependency-ordered)
1. **Color domain (harmony.ts).** Define and export a closed `ColorFamily` union covering the garment color families in docs/01 F9 (the 12 chromatic hue buckets plus the neutrals: `black`, `white`, `gray`, `beige`/tan, `navy` if F9 lists it as neutral). Encode the exact set from F9 — do not invent families. Export a runtime array `COLOR_FAMILIES` and a type guard `isColorFamily(x: unknown): x is ColorFamily`.
2. **Harmony verdict domain (harmony.ts).** Define and export a closed `HarmonyVerdict` union — the finite documented set from F9 (e.g. `'complementary' | 'analogous' | 'neutral' | 'clash'`; use F9's exact labels). Export `HARMONY_VERDICTS` as the runtime array. There is NO `undefined`/`null` verdict — every ordered pair maps to a member of this set (totality).
3. **Harmony rule table (harmony.ts).** Define the rule as a frozen data structure keyed by unordered pair of `ColorFamily`. Because the relation is symmetric by spec, store it canonically (e.g. key by the sorted pair) so symmetry is structural, not duplicated data that could drift. Neutrals-vs-anything and same-family cases MUST be covered.
4. **`harmony(a: ColorFamily, b: ColorFamily): HarmonyVerdict` (harmony.ts).** Pure, total, deterministic lookup. Canonicalize the pair (sort), read the table. Never returns `undefined`; every `(a,b)` in `COLOR_FAMILIES × COLOR_FAMILIES` resolves. Early-return style; no side effects.
5. **Phash domain (dedupe.ts).** Define the perceptual-hash representation used in F4 (64-bit hash as a 16-char lowercase hex string is the expected on-wire form; store/compare as `bigint` internally). Export `Phash` type and `parsePhash(x: unknown): Phash` that validates length/charset (parse-don't-cast) — reject anything not a well-formed 64-bit hex string. Export the bit-width constant `PHASH_BITS = 64`.
6. **`hammingDistance(a: Phash, b: Phash): number` (dedupe.ts).** Pure. Returns popcount of `a XOR b` over `bigint`. Range `0..PHASH_BITS`. `d(x,x)=0` and `d(a,b)=d(b,a)` are structural (XOR is symmetric).
7. **Dedupe verdict + compare (dedupe.ts).** Export closed `DedupeVerdict` union — at minimum `'duplicate' | 'keep-both'` (use F4's exact labels; include a `'near-duplicate'` tier only if F4 defines one). Export the F4 threshold as a named constant (e.g. `DEDUPE_HAMMING_THRESHOLD`). Export `dedupeCompare(a: Phash, b: Phash, threshold = DEDUPE_HAMMING_THRESHOLD): DedupeVerdict`. `keep-both` MUST be reachable — the function must never collapse all inputs to `duplicate` (i.e. some valid input pair returns `keep-both`), so the "one photo → N garments" invariant upstream is never pre-empted by an over-eager dedupe.
8. **No barrel edits.** Do NOT modify a shared `index.ts` unless it already exists AND the one-writer rule permits — it does not here; expose these via their own module paths only.

## 4. Acceptance criteria (Given-When-Then)
- **Harmony happy:** Given two families F9 lists as harmonious (e.g. complementary pair), When `harmony(a,b)`, Then it returns F9's documented verdict for that pair.
- **Harmony symmetry edge:** Given any ordered pair `(a,b)`, When comparing `harmony(a,b)` with `harmony(b,a)`, Then they are identical for every pair in `COLOR_FAMILIES²`.
- **Harmony totality edge:** Given the full cross-product `COLOR_FAMILIES × COLOR_FAMILIES`, When each pair is evaluated, Then every result is a member of `HARMONY_VERDICTS` and none is `undefined`/`null`/thrown.
- **Harmony same-family:** Given `harmony(x,x)`, Then it returns the F9-documented monochrome verdict (never a crash, never a missing-key `undefined`).
- **Dedupe identity edge:** Given any valid `Phash x`, When `hammingDistance(x,x)`, Then `0`; and `dedupeCompare(x,x)` returns `duplicate`.
- **Dedupe symmetry edge:** Given valid `a,b`, Then `hammingDistance(a,b) === hammingDistance(b,a)` and `dedupeCompare(a,b) === dedupeCompare(b,a)`.
- **Dedupe keep-both representable (empty/negative case):** Given two phashes differing in more bits than the threshold, When `dedupeCompare`, Then `keep-both` — proving the verdict is reachable and the function is not a constant.
- **Parse rejects malformed input:** Given a non-hex or wrong-length string, When `parsePhash`, Then it throws/returns a parse error (never silently casts to a bogus `Phash`). Given a non-family string, `isColorFamily` returns `false`.
- **Concurrent/repeat determinism:** Given the same inputs evaluated many times (and interleaved across the two functions), Then outputs are identical every time — no shared mutable state, no ordering dependence.

## 5. Verification requirements — independent oracle
- **Tier:** docs/05 **Tier-1 property tests** (pure-function structural properties), executed with **fast-check** under vitest. These are the named independent oracle — not hand-picked example assertions.
- **Mechanism:** **round-trip / structural invariant** verification via generated inputs. fast-check arbitraries produce the domain (`fc.constantFrom(...COLOR_FAMILIES)` for harmony; a `Phash` arbitrary built from 64 random bits → hex → `parsePhash` for dedupe). The properties, not curated examples, are the graders.
- **Properties that MUST hold (green = all pass, no counterexample, no shrink):**
  1. **Harmony determinism:** `harmony(a,b)` called twice on the same pair is equal (also asserts referential purity — no state leak between draws).
  2. **Harmony symmetry:** `∀ a,b: harmony(a,b) === harmony(b,a)`.
  3. **Harmony totality:** `∀ a,b: HARMONY_VERDICTS.includes(harmony(a,b))` and the value is never `undefined`/`null`; a companion exhaustive test iterates the full finite cross-product (small enough to enumerate) so totality is proven, not merely sampled.
  4. **Dedupe identity:** `∀ x: hammingDistance(x,x) === 0`.
  5. **Dedupe symmetry:** `∀ x,y: hammingDistance(x,y) === hammingDistance(y,x)` and `dedupeCompare(x,y) === dedupeCompare(y,x)`.
  6. **Dedupe range:** `∀ x,y: 0 ≤ hammingDistance(x,y) ≤ PHASH_BITS`.
  7. **Keep-both reachability:** a property asserts that for phashes whose distance exceeds the threshold, `dedupeCompare` returns `keep-both` — so the verdict space is genuinely partitioned and `keep-both` is always representable.
- **Red-first requirement:** before wiring the real table/threshold, land the property tests against a deliberately-broken stub (e.g. an asymmetric table entry, or `dedupeCompare` that always returns `duplicate`) and confirm fast-check **shrinks to a minimal counterexample and fails**. Only then implement the real functions and confirm green. A suite that is green against the broken stub is not a valid oracle — document the red run.
- **Not acceptable:** a single mirror-oracle unit test that re-encodes the same table in the assertion; the properties must be independent of the implementation's data layout (symmetry/totality/identity are relation-level facts, not table transcriptions).

## 6. Failure / degradation
Not applicable — these functions touch no provider or external dependency. The only failure surface is malformed input, handled at the parse boundary (`parsePhash`, `isColorFamily`): invalid input is rejected at the seam and never enters the typed domain, so `harmony`/`hammingDistance`/`dedupeCompare` are total over their typed inputs and cannot throw on well-typed values.

## 7. Performance envelope
Both functions are on the parse/compare hot path (a new photo's phash is compared against the user's existing wardrobe fingerprints; harmony is evaluated across outfit garment pairs). Requirements: `harmony` and `hammingDistance` are O(1) — a single table lookup and a fixed-width `bigint` XOR+popcount over 64 bits, no allocation in the steady state beyond the return value. `dedupeCompare` is O(1) per pair; any N-way scan is the caller's concern, not this module's. No property test needs a perf assertion, but the implementation MUST NOT stringify, regex-scan, or re-parse phashes inside `hammingDistance` (parse once at the boundary, compare as `bigint`).

## Metadata
- **Parent spec:** docs/06 (on-device pure fns); feature refs docs/01 F9, F4.
- **Step:** wave 2.
- **Demo (isolatable):** `pnpm --filter @closet/shared test harmony.test dedupe.test` runs the fast-check property suites green in isolation; show the red-first run against the broken stub, then green.
- **Complexity:** low (two pure modules + property tests; no I/O, no schema, no cross-package wiring).
- **Dependencies:** none on other wave-2 tasks. Requires `fast-check` present in `packages/shared` devDeps (add if absent — that is within this task's shared-package test scope); depends on the shared `parseBoundary`/schema utility already existing per the Handler pattern (used only in tests/parse guards, not modified here).
