# Performance profile — ranked bottleneck audit

**Date:** 2026-08-11 · **Scope:** read-only audit of all Tier-5 `*.perf.test.ts` lanes, recorded
numbers in `docs/RUN-LOG.md` + `docs/LAUNCH-READINESS.md` + `docs/05`, the DB repos, and the
pagination module. No source/build/git changes.

## Bottom line

The prior memory note **`closet-db-layer-not-the-bottleneck` HOLDS** — confirmed, not assumed.
Every measured DB and full-stack op is comfortably inside its SLO (single/double-digit ms vs
80–600ms budgets), the read path is keyset-paged on a matching composite index (no OFFSET
anywhere, no N+1 in the repos), and the ranking is dominated by shared-VM jitter, not algorithmic
cost. **The only genuinely slow operation is the parse-photo provider block, and its cost is
undeployed (no OpenAI/Photoroom keys exist), so its real latency has never been measured.**

There **is** one agent-completable win with real payoff, and the prior note missed it: inside the
parse-photo provider block the two paid provider calls (`vision.extractAttributes` then
`cutout.removeBackground`) are **awaited serially even though neither consumes the other's result**
— both need only the minted `sourcePhotoUrl`. At the documented ~2s-per-provider assumption that is
~4s serial where ~2s (the max of the two) is achievable. See "Highest-value win" below.

## Ranked table (slowest → fastest)

Latency is the **measured p95** from the cited test/commit, run on the shared dev VM with the
provider latency INJECTED at a scaled-down 75ms/call (not a real 2s). The "REAL projected" column
extrapolates the parse path to the docs/06 ~2s-per-provider assumption; every other row has no
provider leg so its measured number is its real number.

| # | Operation | Measured p95 (dev VM) | REAL projected | Source | Addressable by agent? |
|---|-----------|----------------------|----------------|--------|-----------------------|
| 1 | **parse-photo TTFP (full, serial)** — mint + vision + cutout + 6 queries + commit | **247ms** (2×75ms injected floor + overhead) | **~4.2s** (2×~2s serial providers + ~0.2s server) | RUN-LOG `a3ce9fb`; `teaser-parse-ttfp.perf.test.ts`; docs/05:174 | **PARTIAL** — the serial→parallel provider change (win below) is agent-completable NOW; the real 2s RTT is BLOCKED (no keys, docs/05:200) |
| 2 | **parse-photo TTFP (degraded fan-out @16, 4 failures)** | 277ms | ~2s+ (bounded by injected sleep) | RUN-LOG `a3ce9fb`; `teaser-parse-ttfp.perf.test.ts` | Same as #1; degraded path already returns fewer items, never hangs (verified) |
| 3 | **POST /wear-log (append+flip) @24 burst** | 138ms | 138ms (no provider) | RUN-LOG L340; `api-load.perf.test.ts` | Already fast (SLO 600ms); no action |
| 4 | **GET /wardrobe (full page) @24 burst** | 92ms (~674 req/s) | 92ms | RUN-LOG L340; `api-load.perf.test.ts` | Already fast (SLO 600ms); no action |
| 5 | **spend-limiter consume() @24 burst (one hot row)** | 55ms | 55ms | RUN-LOG `a3ce9fb`; `spend-limiter-contention.perf.test.ts` | Already fast (SLO 600ms); serialized upsert, correct |
| 6 | **RC webhook apply (distinct users) @24 burst** | 48ms | 48ms | RUN-LOG `a3ce9fb`; `revenuecat-webhook-load.perf.test.ts` | Already fast (SLO 200ms); one-tx apply, exactly-once |
| 7 | **GET /wardrobe (full page) serial** | ~20ms | 20ms | RUN-LOG L340; `api-load.perf.test.ts` | Already fast (SLO 150ms) |
| 8 | **POST /wear-log serial** | ~17ms | 17ms | RUN-LOG L340; `api-load.perf.test.ts` | Already fast (SLO 150ms) |
| — | **All 10 DB repo ops** (create/list/getById/setAvailability/outfits/wearLog) | p50 4–8ms / **p95 10–23ms** | same | RUN-LOG `ebceda1` L319; `repos.perf.test.ts` (SLOs 80–100ms) | Already fast; ranking is VM noise, nothing to optimize |

Notes on the numbers:
- The parse rows (#1, #2) are the only ones with an injected provider leg. Their measured p95 uses
  `INJECTED_MS=75` per provider (`teaser-parse-ttfp.perf.test.ts:67`), NOT the real ~2s — the lane
  proves *bounded server overhead on top of provider time*, not the absolute reveal time. Scaling
  the 75ms up to the ~2s assumption is what produces the ~4.2s REAL-projected figure.
- No lane runs in the gate wall; all are the nightly/on-demand `pnpm test:perf` project (Rule 4).
- The **teaser TTFP SLO in docs/05:174 is p95 ≤ 12s / ≤ 8s happy-path** — a real 2s×2 serial parse
  (~4s) fits, and a parallelized ~2s fits with far more headroom. The 12s budget is server-side
  only; the client render+upload gap to the ~30s aha is an open question (docs/05:199).

## Is the DB layer the bottleneck? — CONFIRMED NO

- **Read path is keyset-paged, not offset.** `wardrobe.repo.ts:82-85` filters on
  `(created_at, id) < ($cursor)` and `ORDER BY created_at DESC, id DESC LIMIT $n`; the matching
  composite index `wardrobe_items_keyset_idx (user_id, created_at DESC, id DESC)` exists
  (`0002_wardrobe_items.sql:40-41`). `git grep OFFSET` over the repos = **0 hits**. wear_log
  list is `ORDER BY worn_at DESC` backed by `wear_log_worn_at_idx (user_id, worn_at DESC)`
  (`0006_wear_log.sql:37-38`). Filters have supporting indexes (availability, category).
- **No N+1.** Every repo method issues one statement per `query()`; `createWithItems`,
  `mergeKeepOne`, `appendWear`, and the webhook apply are each a single writable-CTE / plpgsql
  call. The one two-query path (`appendWear`'s lost-race fallback SELECT, `wear-log.repo.ts:71`)
  is a correctness requirement under READ COMMITTED, not an N+1, and only fires on a true
  concurrent-dup tap.
- **Measured:** p50 4–8ms / p95 10–23ms across all 10 ops, "slowest-op ranking UNSTABLE run-to-run
  … p95 spread is shared-VM measurement noise, not an algorithmic bottleneck" (RUN-LOG L319). The
  full-stack serial p95 (~17–20ms) is ~2× the DB-only lane — that delta is the
  withAuth+parseBoundary+serialize overhead, itself tiny in absolute terms.

The prior note's second half also holds: the real latency lives in **(a) the undeployed provider
calls (~2s each)** and **(b) React-Native client render + upload**, neither of which an agent can
measure without keys / a real device (docs/05:199-200 explicitly defer both).

## Highest-value agent-completable win

**Parallelize the two independent paid-provider calls in `parse-photo.ts` (lines 233, 237).**

Today:
```
const sourcePhotoUrl = await ports.mintSourcePhotoUrl(...);   // needed by both
const vision  = await ports.vision.extractAttributes({ imageUrl: sourcePhotoUrl });
const cutout  = await ports.cutout.removeBackground({ imageUrl: sourcePhotoUrl, userId, parseJobId });
```
`cutout` does not read `vision` — both depend only on `sourcePhotoUrl`. Running them concurrently
(`Promise.all`) turns the provider block from **sum(vision, cutout) ≈ 4s** into **max(vision,
cutout) ≈ 2s** at the documented assumption — roughly halving the single most load-bearing product
number (time-to-first-preview, the F1 "aha"). It is a localized, reversible change an agent can
make and verify by the TTFP lane's own clock oracle (the injected-latency floor drops from
`2×INJECTED_MS` to `1×INJECTED_MS`).

**The one caveat that keeps this an audit finding, not a silent fix:** the serial order has a
money property on the *failure* path — if `vision` throws, `cutout` (Photoroom, a paid call) never
fires. Parallelizing means a vision failure still incurs a cutout charge. This is a real
provider-spend tradeoff on the failure path only (the happy path charges both regardless), so the
change belongs to whoever owns the parse-cost budget, verified against the degraded-fan-out oracle.
Invariants are untouched: identity still from the verified sub, path still server-derived, no new
DB seam, privacy gate unaffected (only approved photos ever reach this handler).

**Honest caveat on payoff:** the *latency benefit* only materializes once real providers are
deployed (in tests it's injected). The code change and its test-floor change are agent-completable
today; the real ~2s→~2s-halved win is realized at deployment. Every other addressable op is already
an order of magnitude inside its SLO — there is nothing else worth optimizing at the DB or
API-handler layer.

## What is blocked (needs a vantage the agent cannot reach)

- **Real provider RTT** (OpenAI vision, Photoroom cutout): no keys exist (docs/05:200); every parse
  p95 is grounded in the ~2s ESTIMATE and must be re-baselined on first real response.
- **React-Native render + upload budget** filling the gap to the ~30s client aha (docs/05:199).
- **First-traffic unknowns**: JWKS reachability/latency per authed request, pg pool sizing under
  Edge concurrency, migration apply against a live populated DB (LAUNCH-READINESS §6). Not code
  defects — first-contact risks with no local oracle.
- **Concurrency guarantees under real parallelism**: local `Promise.all` serializes the dev pool, so
  three prior concurrency oracles passed locally and failed on main (LAUNCH-READINESS §5). Confirming
  vantage is prod under load, not this VM.
</content>
</invoke>
