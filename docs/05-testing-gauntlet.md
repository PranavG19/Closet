# Backend Test Taxonomy — closet-app

This app is **fully AI-coded**. The same agent writes the code, writes the test, and grades the test green — the **mirror oracle**. A green suite authored that way proves nothing: the test can encode the exact wrong assumption the code does, and self-confidence is not a signal. So this taxonomy is not organized by tool or by feature. It is organized by **where the grading signal comes from** — specifically, how each tier's oracle escapes the author's reach.

The tiers are ordered from **most structurally independent of the author** (Tier-0 grades the tests themselves) to **least** (Tier-4 grades against real events and adversarial conditions the author's fixtures can't produce). Every group names its **non-author signal** explicitly, and every group carries an **extension rule** — this is a living framework, not an exhaustive checklist. Wherever a group says "there is more," that is the instruction for how new tests join it as the code grows.

The three critical paths this whole document exists to protect: **money/entitlement**, **tenancy/RLS**, and **parse idempotency + teaser cap**.

---

## Tier-0 — Anti-mirror: mutation battery + spec-derived-by-a-different-agent + red-first

**The signal, and why the author can't fake it.** This tier exists *only* to kill the mirror oracle directly, so its independence is structural rather than data-driven. Three mechanisms, none of which the code-author controls:

- **(a) Mutation testing grades the TESTS, not the code.** A surviving mutant on a critical path is machine proof the author's assertions are hollow — no amount of self-confidence fakes a killed mutant.
- **(b) Spec-derived tests are authored by a SECOND agent** working only from the frozen PRD/eng-req GWT clauses and the schema. It never sees the implementation, so it cannot accidentally encode the same wrong assumption the implementer made. Two independent derivations of one spec must agree, or one is wrong.
- **(c) Red-first** requires the test to be demonstrated **failing** against the parent tree before the fix lands — proving the test discriminates the target behavior rather than passing vacuously.

In all three, the grading signal comes from a process the author cannot author.

**What it proves.** That the test suites for money, tenancy, and parse actually **discriminate correct from incorrect** — that a green suite *means* something. A killed-mutant score on the critical path, a spec-agent test that agrees with the implementer's, and a proven red→green transition together certify the other tiers aren't self-graded theater.

**Example tests.**
- `pnpm mutation` over parse-photo's idempotency + teaser-cap logic: mutate the teaser cap constant (`10`→`1000`), the `job.status === 'done'` skip guard, the `entitlement_active` gate comparison, and the partial-item cleanup `DELETE` — every mutant must be killed or the guarding test is hollow.
- Mutate the survivor tie-break in any dedup / keep-one `DELETE` from `>` to `>=` (the exact fitapp DB-1 catastrophe) — a surviving mutant means the delete could wipe rows it shouldn't.
- Spec-agent (different agent, reads only **F3** + the `parse_jobs UNIQUE(user_id, source_photo_hash)` clause) independently writes the resume-idempotency test; it must agree with the implementer's on the no-duplicate-garments assertion.
- Red-first proof for **F7**: assert the suggestion query excludes a dirty item, demonstrate it FAILS on a parent tree where the availability filter is absent, then land the filter.
- Mutation on `revenuecat-webhook`'s `last_event_id` dedup guard and the `EVENT_STATE_MAP` entitlement mapping — a surviving mutant blocks the human-gate review.

**Applies to.** `packages/functions` parse-photo handler · `packages/functions` revenuecat-webhook handler · `packages/db` repos (tenancy + idempotency writes) · `packages/db` migrations (destructive DML tie-breaks) · `packages/shared` critical pure fns.

**Extension rule — there is more.** Any code on the three critical paths (money/entitlement, tenancy/RLS, parse idempotency + cap) gets a **mutation target the day it lands**; every such module must survive the 6-mutant smoke in `pnpm verify` and the full battery nightly — a surviving mutant is a **build-blocking gap, not a warning**. For any feature with a written GWT clause on a critical or irreversible path, a **second agent derives its test from the spec alone**. Add a mutation target and a spec-agent derivation for **each new critical-path branch as it is written** — never retrofit in bulk.

---

## Tier-1 — Property-based invariants for deterministic domain logic (fast-check)

**The signal, and why the author can't fake it.** The oracle is a mathematical **invariant** that holds over a generated input space — not a hand-picked expected value the author also computed. fast-check explores thousands of cases the author never enumerated and shrinks to a minimal counterexample, so the grading question is *"does this law hold everywhere"* rather than *"does f(3) equal the 3 I typed."* The author states the law (symmetry, determinism, monotonicity, totality); the framework hunts the violation. A wrong implementation that happens to match the author's few example points is still caught by an input the author never imagined.

**What it proves.** That the pure deterministic logic in `shared` — harmony rules (**F9**), the suggestion heuristic (**F5**), palette scoring (**B1**), phash Hamming compare (**F4** dedupe), and warmth-from-category — obeys its structural laws for **all** inputs, offline and server-free. These run **on-device**, so their correctness cannot be observed server-side and must be pinned by laws.

**Example tests.**
- **F9 harmony:** determinism (same pair → same verdict every call) and symmetry (`harmony(a,b) == harmony(b,a)`); verdict is always one of the documented rule-table values (total function, no `undefined`).
- **F5 suggestion:** NEVER emits a dirty/unavailable item (generate arbitrary wardrobes with mixed availability); given zero clean items it returns the defined non-empty fallback, never an empty/broken result (degraded-path law).
- **F5 weather bias:** colder generated temperature ⇒ suggested set's aggregate warmth is monotonic non-decreasing (metamorphic-flavored property).
- **F4 dedupe:** Hamming distance is symmetric and `d(x,x)=0`; a pair flagged duplicate stays flagged under lossless re-encode of the phash; keep-both is always representable (never a forced merge).
- **B1 palette:** scoring is a pure fn of the swatch answers only, order-independent; advisory highlight NEVER hides or blocks any item for any input (the advisory-not-prescriptive invariant).

**Applies to.** `packages/shared` harmony rules · suggestion heuristic · palette scoring · phash/dedupe compare · Zod boundary schemas (`parseBoundary` round-trip).

**Extension rule — there is more.** Every pure function added to `shared` ships with **at least one property** expressing a law it must obey (determinism, symmetry, totality, monotonicity, or an advisory-never-blocks safety law) — an example-only test for pure logic is treated as **incomplete**. When a new heuristic input is added (a new weather signal, a new harmony rule row), add the property that pins its directional or structural law — don't just add example rows.

---

## Tier-1 — Metamorphic tests for the ML-ish parse path (relations, not ground truth)

**The signal, and why the author can't fake it.** For GPT-4o attribute extraction and background-removal cutouts, per-image ground truth is scarce and expensive — the author cannot hand-write the "correct" JSON for every photo. Metamorphic testing sidesteps the missing oracle: instead of asserting an absolute label, it asserts a **relation between outputs of related inputs** that must hold regardless of the true label. Independence comes from the relation being a **property of the world** (rotation-invariance, near-duplicate agreement) that neither the model nor the author's expectation controls. A model that violates it is wrong even though we never knew the true answer.

**What it proves.** That the parse pipeline behaves **consistently under transformations that shouldn't change the semantic answer** — catching model instability, prompt regressions, and cutout non-determinism a scarce labeled corpus would miss. Bridges the gap where absolute ground truth is unavailable.

**Example tests.**
- **Attribute stability:** the same photo submitted twice (or lightly re-compressed/rotated within the app's normalization) yields the same category and primary color bucket within tolerance — parse must not flip `top` vs `dress` on a benign transform.
- **Near-duplicate agreement:** two crops of the same garment produce phash within the dedupe threshold AND the same category (feeds **F4** dedupe correctness without needing the true label).
- **Cutout idempotence:** running `CutoutPort` on an already-cut image is a near-identity (alpha mask stable); normalized front-view bounding geometry is transform-consistent.
- **Cap/gate invariance:** teaser vs full parse of the SAME photo produces the same per-item attributes (kind must not change extraction — only which photos and how many).
- **Adversarial-input relation:** a non-garment photo that slips the gate yields low-confidence/rejected attributes rather than a confident wrong garment (fail-safe relation).

**Applies to.** `packages/functions` parse-photo orchestration · `packages/shared` AIVisionPort contract (Zod-validated attributes) · CutoutPort contract · `packages/db` `wardrobe_items` write shape.

**Extension rule — there is more.** Every semantic-preserving transform the real pipeline can encounter (re-encode, rotate-to-normalize, crop, re-submit) gets a metamorphic relation asserting the output is invariant or moves in the defined direction. When a new attribute is extracted or a provider is swapped behind the port, **add the invariance relation for that attribute before trusting the new adapter** — the relations are provider-agnostic and outlive the vendor.

---

## Tier-1 — Bench-scan differential corpus (independent labels, adversary-validated gate)

**The signal, and why the author can't fake it.** This is the make-or-break oracle and the strongest anti-mirror device for parse *quality*: a **held corpus** of garment photos labeled by a source that is **NOT the pipeline** (human/independent labels the code never produced), scored against pipeline output. The author cannot grade themselves because the labels predate and are external to the run. Critically — mirroring fitapp's `bench-scan --adversary` — the gate itself is validated by running a deliberately-**wrong** model through it and proving the score **collapses** (the gate bites), and by a **keyless replay tier** that scores committed recordings deterministically (byte-compared) so the benchmark can't silently drift green. It also grades vision providers against each other on identical inputs — the differential that makes `AIVisionPort` swaps objective.

**What it proves.** Absolute parse quality against external truth: attribute accuracy (category/color/pattern) and cutout quality clear a **numeric floor** — the lever the whole conversion thesis rests on (**F1** aha). And that the quality gate is real (an adversary model fails it), and that provider A vs B is a decidable comparison, not a vibe.

**Example tests.**
- **Replay tier (keyless, free):** score committed recordings for attribute accuracy vs held labels; deterministic `--json` output byte-compared so a scoring-logic change is loud.
- **Adversary tier:** run a deliberately-miscategorizing model; assert the accuracy score drops below the floor — proves the gate discriminates and isn't rubber-stamping.
- **Differential:** GPT-4o vs a candidate model on the identical corpus; report per-attribute deltas to justify any `AIVisionPort` swap without touching callers.
- **Cutout quality:** mask IoU / edge cleanliness vs labeled reference cutouts clears the premium-bar threshold (this is the asset the reveal shows).
- **Generation-drift check:** re-read upstream corpus image metadata and fail on drift so the baseline reflects the real held images.

**Applies to.** `packages/functions` parse-photo (scored against corpus) · `packages/shared` AIVisionPort adapters (GPT-4o + candidates) · CutoutPort adapters · `scripts/bench-scan` corpus + baseline.

**Extension rule — there is more.** Every attribute the pipeline claims to extract gets a **labeled column** in the held corpus and a **numeric floor** in the baseline; every provider considered behind a port must clear the same corpus before it can be wired. The gate must always ship with **at least one adversary proving it bites**. Grow the corpus toward the hard/edge distribution (unusual garments, tricky lighting, patterns) as real misses surface — the corpus is a **living independent oracle, expanded from production failures, never frozen**.

---

## Tier-2 — Adversarial security + privacy: cross-tenant penetration, authz fuzzing, the never-uploads assertion

**The signal, and why the author can't fake it.** The oracle is an **attacker's independent observation, never the handler's own response** — the fitapp rule *THE RESPONSE IS NEVER THE ORACLE* (a handler can return 404 while having written the row). Every probe ends in a **fresh SELECT taken as the victim tenant under RLS**, plus a **container-superuser cross-owner join** that no RLS-scoped read can express (`count 0` = no foreign row exists anywhere). Independence comes from grading against actual database state from a vantage the handler doesn't control, with a **fully-valid attacker token** (nothing forged — the attacker simply names rows it doesn't own). For privacy, the oracle is the **network/upload boundary itself**: the assertion is that NO code path can transmit a non-approved photo, proven by the **absence** of any endpoint/Storage-write reachable without prior on-device approval + hash.

**What it proves.** That per-user isolation is real against a **malicious-but-authenticated** caller across all 7 tenant tables (default-deny holds on read AND write); that the money table is **structurally unwritable** by any `app_user` token; and that the privacy invariant is enforced by the **shape** of the system (no server gate endpoint, no upload path for an unapproved photo) rather than by a promise.

**Example tests.**
- **Cross-tenant WRITE:** tenant A (valid token) submits `outfit_items` naming B's `outfit_id` / `wardrobe_item` id; a fresh SELECT as B shows nothing, and the superuser cross-owner join (`child.user_id <> parent.user_id`) counts 0.
- **Server-injected identity:** a `user_id: B` field smuggled into any mutation body is inert — identity comes only from the verified JWT `sub`.
- **Money-table penetration:** every `app_user` attempt to INSERT/UPDATE `subscriptions.entitlement_active` is refused by RLS (no write policy exists) — granting yourself premium is **unrepresentable**; only `service_role` (webhook) writes.
- **Authz fuzzing:** malformed / expired / wrong-issuer / `alg:none` JWTs and boundary-fuzzed request bodies must 401/400 and write **zero rows** (assert row count, not just a mocked-factory-never-called).
- **Privacy never-uploads (backend seam):** assert there is **NO** Edge endpoint that accepts a raw camera-roll photo, and Storage RLS refuses any object write whose path/metadata lacks the approved `source_photo_hash` — an unapproved photo has no representable upload path.
- **Idempotency-collision attack:** A replays B's exact `client_id` on `wear_log` to try to make a partial-UNIQUE arbiter resolve onto B's row.

**Applies to.** `packages/functions` withAuth/serveAuthed · `packages/db` repos + RLS policies on all 7 tenant tables · Supabase Storage RLS (uploads + cutouts buckets) · `subscriptions` table (money boundary) · parse-photo upload/approval seam.

**Extension rule — there is more.** Every new tenant table and every new mutation endpoint is added to the **standing cross-tenant penetration suite the same wave it lands** — a permanent fixture, not a one-time audit, and it must attack **WRITE** paths with a valid token, not just reads. Each new byte-storing bucket gets a **real Storage-RLS test** (not a table-RLS proxy) proving the path-prefix policy binds to the requester's `sub`; each new self-authed endpoint gets a **signature-forgery probe**.

---

## Tier-3 — Backend E2E against real Postgres + RLS FORCE (testcontainers, `SET LOCAL ROLE app_user`)

**The signal, and why the author can't fake it.** Independence comes from running the **real production chain** — handler → `withAuth` (JWKS-verified token) → `pgExecutor` (`BEGIN` → set `jwt.claim.sub` → `SET LOCAL ROLE app_user` → `COMMIT`) → repo → real Postgres with the **full migration chain applied** — against a database whose RLS the test does **not** get to bypass. The critical discipline (fitapp's #1 non-obvious rule) is **`SET LOCAL ROLE app_user`**: the container superuser bypasses RLS, so a test that forgets it proves nothing. Grading is a **fresh independent SELECT through the tenant's own RLS-scoped view**, with only the grant matrix the migrations actually issue (no hand-granted extras), so the test cannot prove more than prod allows. The oracle is **real persisted state under real policies**, not an in-memory mock the author wired.

**What it proves.** That the endpoints, repos, RLS policies, constraints, and grants actually **compose in production form**: rows land where they should, RLS scopes them to the owner, UNIQUE/idempotency constraints hold, and the `parse_jobs` resume path creates **no duplicate garments** — all on the same schema and role matrix that ships.

**Example tests.**
- **parse-photo resume (F3):** apply full chain, submit a photo, kill mid-parse (`job=processing`), resubmit; independent SELECT confirms **exactly the right garment count** (partial items cleaned, no duplicates) and `job=done` — idempotency keyed on `parse_jobs UNIQUE(user_id, source_photo_hash)`, **NOT** on `wardrobe_items`.
- **wear-log append (F8):** caller-minted `client_id`, retried insert; partial UNIQUE dedups to one row; SELECT as owner under `app_user` confirms per-item rows share `outfit_id` + `worn_at`.
- **F7 availability toggle** round-trips and the **F5** suggestion read excludes non-clean — proven against real rows, as `app_user`.
- **outfit_items insert** validates every `item_id` belongs to the caller BEFORE insert; a foreign `item_id` is rejected and no row lands (SELECT-verified).
- **RLS-per-table suite:** for each of the 7 tables, `app_user` sees only own rows; a second tenant's rows are invisible; grants come only from the migration chain.
- **pgExecutor role test:** confirm `SET LOCAL ROLE app_user` is actually in effect (a query that would succeed as superuser but must fail as `app_user`).

**Applies to.** `packages/functions` all 6 handlers · `packages/db` all repos · full migration chain (`applyMigrations`) · RLS policies + grant matrix on all 7 tables.

**Extension rule — there is more.** Every endpoint and every repo gets a `*.integration.test.ts` (exact suffix) that runs the **real chain** and `SET LOCAL ROLE app_user` before a wave is declared done — affected-only masks regressions, so `verify:full` gates the wave. Each new table adds its own `.rls.integration.test.ts`; each new idempotency constraint adds a **retry/collision integration test** that proves the arbiter resolves onto the caller's own row only.

---

## Tier-4 — Chaos + load: webhook replay/dup/out-of-order, migrations on POPULATED data, parse fan-out, offline/jitter

**The signal, and why the author can't fake it.** Independence comes from grading against **adversarial temporal/scale conditions the author's happy-path tests never create**, with the oracle being real persisted state or a real external event — never a self-mocked success. The money path is verified against a **REAL RevenueCat event** (a self-mocked "success" is explicitly a mirror oracle and does not count). Migrations are proven against **POPULATED tables with hand-crafted duplicate/edge rows** chosen so a WRONG survivor rule keeps a DIFFERENT row — because on a fresh empty container the dangerous DML affects 0 rows and both the drift gate and a redo round-trip produce identical fingerprints, leaving the logic **unexecuted** (the exact fitapp DB-1 trap). The grading signal comes from conditions and data the author's normal fixtures **structurally cannot produce**.

**What it proves.** That the system survives the real world: out-of-order/duplicate/replayed webhook events yield correct entitlement (or are provably deferred to the human gate where they can't); destructive/narrowing migrations do the right thing on live-shaped data and round-trip DOWN; parse fan-out on a full camera roll degrades gracefully under the teaser time budget instead of spinning; and API behavior under offline/jitter/retry is idempotent.

**Example tests.**
- **Webhook chaos (HUMAN-GATED):** against REAL RevenueCat events — replay the same event twice (`last_event_id` dedups to one entitlement change), deliver renewal-before-purchase out-of-order (recency guard picks the right final state), deliver expiry then late renewal; independent SELECT of `entitlement_active` is the oracle. **Flag out-of-order arrival as the known `last_event_id` limitation for human review.**
- **Migration round-trip on POPULATED data:** apply chain, drop the target UNIQUE, insert hand-crafted duplicate groups where the correct survivor is **NEITHER newest NOR highest-id**, apply only the dedup migration, assert the EXACT survivor per key; then prove DOWN reverses on the populated table.
- **Parse fan-out load:** submit a full camera-roll batch (2 serial providers/photo); assert client-fanned concurrency + per-call timeout holds the teaser within the aha budget and the degraded path **reveals fewer items rather than a spinner**; `parse_jobs` statuses resume correctly after simulated provider failures.
- **Offline/jitter at the API:** wear-log and availability writes retried under simulated network loss produce **exactly one row** (`client_id` idempotency), never duplicates or lost writes.
- **Identity-before-teaser (no anon session):** assert every `parse_jobs`/`wardrobe_items` write — including teaser — carries the real authenticated `user_id`; there is no code path that parses under an anonymous session (the former anon→permanent boundary is designed out, docs/06 §8.4).
- **Weather provider downtime:** Open-Meteo 5xx/timeout ⇒ suggestions run **without** weather bias, never a broken screen.

**Applies to.** `packages/functions` revenuecat-webhook (real event) · `packages/db` destructive/narrowing migrations · `packages/functions` parse-photo fan-out · wear-log + wardrobe idempotent writes · auth anonymous→permanent linking · WeatherPort degraded path.

**Extension rule — there is more.** Every destructive or narrowing migration gets a **populated-data round-trip test with an adversarially-chosen fixture** (wrong rule keeps a different row) BEFORE it can land — never trust a fresh-container apply. Every webhook/event path is tested against a **real captured event** with replay + dup + out-of-order, and stays human-gated. Each new external provider adds its **downtime/timeout degraded-path test**, and each new idempotent write adds a **retry-under-jitter test**; load tests target the current hot path (parse fan-out today) and move as the bottleneck moves.

---

## Out-of-scope here — Device/simulator E2E + visual regression (pointers only, Frontend phase)

These are **real and required** oracles, but they belong to the **frontend phase** and are named here only so the backend taxonomy stays honest about what it does NOT cover. Their independence, when built, comes from an outside-sourced signal: a **real iOS/Android simulator screenshot** (unobservable visual output is an agent-arch escalation trigger — you may not claim a UI works without seeing it) and **pixel-diff visual regression** against an approved baseline. Notably, the on-device privacy-gate **classifier recall** (does it actually drop intimate/non-her photos) is a **device-ML oracle graded by an independent labeled corpus on-device** — the backend can only assert the never-uploads seam (Tier-2), never the classifier's recall.

**When the frontend phase runs it will prove:** the onboarding reveal renders the aha within budget on real devices (iOS first, Android parity); the light-theme token system renders correctly; and the on-device gate classifier clears its recall floor on a labeled corpus.

- `[frontend]` Real iOS simulator screenshot of the reveal screen (via the ios-sim skill; ask before booting).
- `[frontend]` Android parity screenshot of the same flow.
- `[frontend]` Visual-regression pixel-diff of wardrobe grid + paywall against approved baselines.
- `[frontend/device-ML]` On-device gate recall against an **independent labeled intimate/not-her corpus** — the make-or-break privacy safety metric, graded by an external corpus, not self-report.

**Extension rule — there is more.** Do NOT build these in the backend phase. Every new user-visible screen and every device-ML model gets its screenshot/visual-regression/labeled-corpus oracle when its frontend/device task lands. The privacy-gate corpus in particular grows from any real false-negative and is treated as a standing safety benchmark once the device layer exists.

---

## Execution model

### (a) Synchronous (fast wall, `pnpm verify`, p95 < 90s) vs post-merge / nightly

The synchronous budget is a hard agent-arch constraint (Rule 4: the safe path is the fast path). What runs where:

| Runs synchronously in `pnpm verify` (affected-only, < 90s) | Runs post-merge / nightly (`pnpm verify:full` + scheduled) |
|---|---|
| Tier-1 property tests (bounded fast-check runs — fast, pure, no I/O) | Tier-0 **full** mutation battery (minutes-to-hours; the 722-mutant-class run) |
| Tier-0 **6-mutant smoke** on touched critical-path modules | Tier-3 **full** integration suite across all 7 tables + all handlers |
| Tier-2 authz/tenancy tests for **affected** tables/endpoints | Tier-4 load/chaos: parse fan-out, populated-migration round-trips |
| Tier-3 integration tests for the **affected** repo/handler | Tier-1 bench-scan **replay tier** (keyless) on every merge; **live-provider + adversary + differential** nightly (cost + latency) |
| Structural gates: gen-check, edge-graph/edge-type, typecheck, lint | Tier-4 real-RevenueCat webhook chaos (human-gated; never in the autonomous wall) |

Rule: **affected-only masks regressions**, so `verify:full` (whole Tier-2 + Tier-3 + populated-migration + replay corpus) gates a wave before it is declared done, and the **full mutation battery + live/adversary bench-scan + load/chaos** run nightly. Add a synchronous gate only by naming what it replaces; anything that pushes the wall past 90s moves to nightly or gets parallelized first.

### (b) The standing adversarial gauntlet

The tiers above are the *scaffold*; the gauntlet is the *engine that keeps them honest*, because a fully AI-coded system will always grow new mirror oracles faster than any fixed list catches them.

- **Loop-until-dry finder + refuter swarm.** A **finder** agent hunts for an untested branch, an unasserted row-count, a missing `SET LOCAL ROLE`, a bypassed cap, a cross-tenant write path. A **refuter** agent tries to prove each candidate is actually safe. The loop runs until the finder comes up **dry** (no new candidate survives the refuter) — the cheap metric is *count of surviving candidates*, and it must trend to zero. Neither agent is the code-author, so the signal escapes the mirror.
- **Fire-drills (gate-liveness proofs).** Periodically **inject a synthetic bug** — flip a survivor tie-break, widen the teaser cap, drop an RLS `WITH CHECK`, delete a `SET LOCAL ROLE`, smuggle `user_id` from the body — and confirm the gate that should catch it goes **red**. A gate that stays green on an injected bug is a dead gate; the fire-drill is the only thing that proves a gate is *alive* rather than *present*. Every critical-path gate (mutation smoke, cross-tenant suite, money-table penetration, populated-migration) gets a recurring fire-drill.

The gauntlet is where "there is more" becomes operational: new critical-path branches, new tables, new providers, and production failures all enter the standing suites through it, and the injected-bug drills keep the tiers from silently rotting green.

### (c) Device/sim E2E + visual regression are the FRONTEND phase

Real-simulator screenshots, pixel-diff visual regression, and the on-device privacy-gate **classifier recall** corpus are **not built in this backend phase**. The backend proves the *never-uploads seam* (Tier-2) — the structural absence of any upload path for an unapproved photo — but it **cannot** prove the classifier's recall. That is a device-ML oracle graded by an independent labeled corpus, and it lands with the frontend/device task, not here.