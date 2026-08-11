# Observability audit — logging & metrics vs. "set metrics for everything, make sure everything's logged"

Date: 2026-08-11. Read-only audit. Scope: `packages/functions`, `packages/mobile`,
`packages/db`. Every claim below is from reading the implementation, not the name.

## 1. The logging seam as it exists today

There is exactly ONE structured logger, in the **functions** package:
`packages/functions/src/auth/logger.ts`.

- Shape: `logger.info|warn|error({ correlationId, event, ...fields })`. It emits a
  single JSON line per event via a bracketed `globalThis.console.log` (the one
  sanctioned sink; `console.` member access is lint-banned everywhere else).
- Field type is `string | number | boolean | undefined` keyed on a fixed vocabulary —
  it is structurally impossible to pass a raw `Error` or a request body object, which
  is what enforces the "never log raw error messages / PII" invariant at the type
  level, not by convention.
- `correlationId` is minted per-request in `withAuth` (`packages/functions/src/auth/withAuth.ts:94`,
  `newRandomId` → `crypto.randomUUID()`) and threaded into `AuthContext`. The webhook
  mints its own (`revenuecat-webhook.ts:98`).

**Mobile has no logger.** The only `console` use in mobile is a single one-shot
`config.dev_placeholder_used` warn in `packages/mobile/src/api/config.ts:51` for a
missing EXPO_PUBLIC_* var. There is no logger module, no correlation id, no event
vocabulary on-device. `git grep logger -- packages/mobile` returns only config.ts.

**DB (repos) do not log at all** and hold no logger dependency (by design — repos are
pure SQL seams). The `metric`/`duration` grep hits in `packages/db/src/repos/*` are all
prose comments, not code.

## 2. What emits structured logs today (complete list)

Only 4 of ~20 edge handlers log. Enumerated from `git grep -n 'logger\.'`:

| Handler | Events emitted |
|---------|----------------|
| `parse/parse-photo.ts` | `parse.rate_limited` (warn), `parse.replay`, `parse.done` (info), `parse.provider_failed` (error) |
| `billing/revenuecat-webhook.ts` | `revenuecat.unauthorized`, `.invalid_timestamp`, `.unmapped_type`, `.replay`, `.stale_ignored`, `.applied`, `.error` |
| `account/delete-account.ts` | `account.deleted` (info, row counts), `account.delete_failed` (error) |
| (that is the entire set) | |

**Handlers with ZERO logging** (read confirmed — no logger import, no emit):
`wardrobe/list`, `wardrobe/availability`, `wardrobe/dedupe`, `outfits/create`,
`outfits/list`, `palette/read-entitlement`, `palette/read-palette`,
`palette/upsert-palette`, `wear-log/log-wear`, `account/export-data`.

Notably `export-data` (a GDPR bulk read that the docs flag as a memory-envelope risk)
and `log-wear` / `availability` (the idempotent write paths) emit nothing — no success
signal, no failure signal, no correlation id surfaced on the wire.

There is also no logging in the **shared error mapper** `auth/respond.ts`: a 400
(`errorFromThrown` → `BoundaryParseError`) and a 500 (`internal_error`) both return a
safe envelope but emit NO log. So every boundary-parse rejection and every unexpected
500 across the 10 unlogged handlers is currently invisible.

## 3. What is TIMED / has latency metrics today

**In production code — only two handlers self-time**, both money/conversion-critical:

- `parse-photo.ts` uses `performance.now()` (monotonic, chosen over `Date.now()` so a
  clock adjustment can't yield a negative duration — see comment at line 124). It logs
  `providerMs` (the vision+cutout paid-provider block, the real bottleneck) SEPARATELY
  from `totalMs` (whole handler) on `parse.done`, `parse.replay`, and
  `parse.provider_failed`. This is the model to copy.
- `revenuecat-webhook.ts:101,173` times the money-write and logs `totalMs` on
  `revenuecat.applied`.

**No other handler is timed.** `delete-account` logs counts but no duration.

**The perf-test lane** (`docs/05` Tier-5) is a separate, non-production measurement
system — it does NOT instrument the running app; it drives the real chain under
testcontainers and grades a p95 against an SLO the author can't move:

- Primitive: `packages/db/test/helpers/perf.ts` — `measure()` (serial,
  `process.hrtime.bigint`, nearest-rank percentiles), `measureConcurrent()` (worker-pool
  load generator), `summarize()`, `rankedTable()`. Unit-oracled in `perf.test.ts`.
- Lanes (`*.perf.test.ts`, nightly `pnpm test:perf`, VM-gated, NOT in the gate wall):
  `db/test/repos.perf.test.ts` (10 repo ops), `functions/test/api-load.perf.test.ts`
  (wardrobe list + wear-log serial+burst), `teaser-parse-ttfp.perf.test.ts` (parse TTFP,
  injected provider latency, superuser COUNT oracle),
  `spend-limiter-contention.perf.test.ts`, `revenuecat-webhook-load.perf.test.ts`.
- First observed dev-VM numbers (docs/05:165, NOT prod-baselined): GET /wardrobe serial
  p95 ≈ 20ms / burst-@24 ≈ 92ms; POST /wear-log serial p95 ≈ 17ms / burst-@24 ≈ 138ms.

So "timing" exists in two disconnected forms: **ad-hoc `performance.now()` in 2
handlers**, and a **test-only p95 harness**. There is no production metric emission
seam, no counter, no per-route latency line for 18 of 20 handlers.

## 4. Gaps — user-facing operations with NO metric and NO log

| Operation | Log today? | Metric/timing today? |
|-----------|-----------|----------------------|
| Wardrobe list / filter (F4) | none | none (perf-test only) |
| Toggle availability (F8 write) | none | none |
| Dedupe resolve | none | none |
| Create outfit / list outfits | none | none |
| Log wear (idempotent write) | none | none |
| Read/upsert palette (B1 quiz) | none | none |
| Read entitlement (money read) | none | none |
| Export my data (GDPR bulk) | none | none |
| Boundary-parse 400s / 500s (all handlers) | none (respond.ts silent) | n/a |
| **Suggestion compute** (daily pick) | none | none — and there is NO server endpoint; it is client-side in `packages/mobile/features/suggestions` over shared pure fns. Never timed, never logged. |
| **On-device photo gate → upload → parse** (`mobile/src/photo/addGarment.ts`, `uploadApproved.ts`) | none | none — no timing of the privacy classifier, upload bytes, or the client-perceived tap→reveal wall |
| **Every mobile screen load / API call** (`mobile/src/api/client.ts`, `hooks.ts` react-query) | none | none — react-query has no `onError`/`onSuccess` logging, no request timing, no correlation id echoed from the server |

The single biggest hole: **the client half is entirely dark.** docs/05:199 explicitly
flags that the ~30s "aha" is *client-inclusive* wall time but the only SLO measures
server-side; nothing on-device measures tap→reveal, upload duration, or screen mount.
The server's `correlationId` is minted but never returned to the client, so a mobile
error cannot be tied to its server log line.

## 5. Proposed minimal metrics plan (respects every invariant)

Principle: ONE seam per package, emit at the wrapper, not scattered per-handler. "Metric"
here = a structured log line with a `durationMs` (or count) field — the same JSON the
existing logger emits — so a log drain (Supabase/Logflare) aggregates p50/p95 from the
`event` + `durationMs` fields. No separate metrics SDK, no extra network hop, negligible
latency (`performance.now()` twice + one JSON line, which parse-photo already proves is
cheap enough for the hot path).

### 5a. Server: one line in the wrapper, not 18 edits

Add request logging in `withAuth` (`packages/functions/src/auth/withAuth.ts`), the single
choke every user-JWT handler already passes through — NOT in each handler:

- Wrap the `handler(req, ctx)` call: capture `performance.now()` before, compute
  `durationMs` after, and emit `logger.info({ correlationId, event: 'request', route,
  status, durationMs })`. `route` = a static label derived from the handler (pass it as
  a param to `serveAuthed`/`withAuth`, since the URL path is the same function name).
- Emit `logger.error({ correlationId, event: 'request_error', route, durationMs })` if
  the handler throws (today an unlogged 500). This gives every one of the 18 dark
  handlers a latency + status + error signal with ONE edit, and cannot leak PII (the
  logger's field type forbids passing the error object).
- Also emit the correlationId to the client: add an `x-correlation-id` response header in
  `respond.ts::jsonResponse`, so a mobile failure log can carry the same id (§5b) and the
  two halves join. This is the missing thread between the dark client and the server log.

This subsumes the ad-hoc `totalMs` in parse-photo/webhook (keep their *domain* events —
`parse.done` with `providerMs` is a finer signal the wrapper can't see — but the generic
`request` line covers the other 18 for free).

Do NOT log in repos (keeps the DB seam pure) — the wrapper's `durationMs` minus the
provider block is enough to localize DB vs. app time; the perf lane already isolates
repo-level p95.

### 5b. Mobile: a mirror logger + one ApiClient hook

Create `packages/mobile/src/api/logger.ts` mirroring the functions logger EXACTLY (same
JSON-line-through-bracketed-console shape config.ts already uses at line 51-59; same
`{correlationId, event, ...}` field type forbidding raw errors). Then instrument the ONE
transport choke, `ApiClient.request()` in `client.ts` (not 12 call sites):

- Time each request with `performance.now()`; on completion emit
  `{ event: 'api', route, status, durationMs, correlationId }` where `correlationId` is
  read from the server's `x-correlation-id` response header (§5a). On `!response.ok`
  emit `{ event: 'api_error', route, status, code, durationMs }` — `code` only, never the
  server message (ApiError already keeps the message off-screen; keep it off the log too).
- For the client-perceived reveal (the ~30s aha, docs/05:199): time `addApprovedGarment`
  in `mobile/src/photo/addGarment.ts` — emit `{ event: 'add_garment', durationMs,
  outcome }` where `outcome` is the existing closed `AddGarmentOutcome` token set (never
  free text). This is the ONLY place the tap→upload→reveal wall is observable.
- Suggestion compute: wrap the pure-fn call in `features/suggestions` with one timing line
  `{ event: 'suggestion_compute', durationMs, itemCount }`.

Privacy invariant preserved: the on-device gate runs BEFORE any of this; we log
durations and counts, never a photo path, never image bytes, never a classifier verdict
tied to content. Skin tone stays self-identified — no metric touches it.

### 5c. What to instrument, ranked (do the top 3, they close 80% of the dark area)

1. `withAuth` request-line + error-line + `x-correlation-id` header (covers 18 handlers +
   all 400/500s in one edit).
2. `ApiClient.request()` mobile transport line (covers every screen's API call + joins to
   the server via correlationId).
3. `addApprovedGarment` client reveal timing (the make-or-break F1 aha, currently
   unmeasured end-to-end).

Lower priority: suggestion-compute timing; a mobile `react-query` global `onError` for
non-API failures.

## 6. How a metric would be VERIFIED (independent oracle, not a self-count)

A logged `durationMs` graded against its own emission is a mirror oracle. Verify the same
way docs/05 Tier-5 already does — the signal lives OUTSIDE the code under test:

- **Latency**: the existing `*.perf.test.ts` clock is the oracle. It drives the REAL chain
  (handler → withAuth → pgExecutor → real Postgres) and asserts a p95 from
  `process.hrtime.bigint()` samples the handler never sees. When §5a lands, add ONE
  assertion to `api-load.perf.test.ts`: capture the emitted `request` log lines during the
  burst and assert their reported `durationMs` distribution tracks the harness's
  independently-measured wall-clock (within a tolerance) — this proves the *instrument
  itself* is accurate, not just that the path is fast. The harness clock is the oracle the
  author can't fake; the log line is the thing under test.
- **Coverage ("everything is logged")**: a structural test, not a count. Add a test that
  asserts every route registered in `serveAuthed` produces exactly one `request` line per
  invocation (spy the logger sink, drive each handler once, assert one line with the right
  `route`). This makes "a handler with no log" a red test, i.e. unrepresentable-by-gate
  rather than caught by eyeballing — the same discipline as the repos-only lint.
- **Money path** (unchanged bar): the webhook latency line is graded by
  `revenuecat-webhook-load.perf.test.ts` against a REAL replayed RevenueCat event, never a
  mocked success (docs/05:194). Do not add a self-mocked success to "verify" the metric.
- **Client reveal**: the honest oracle is a real simulator run (the dev-client sim loop in
  memory `closet-sim-loop-works-devclient`) reading the `add_garment` durationMs line from
  device logs against a stopwatch on the visible reveal — not an assertion the client
  computes about itself.

## 7. Latency budget (safe path = fast path)

Every proposal is `performance.now()` × 2 + one `JSON.stringify` + one `console.log` per
request — the exact cost parse-photo already carries on its hot path with no SLO impact
(its serial p95 ≈ handler+2×provider, docs/05). No new network hop, no metrics agent, no
per-statement instrumentation. The `x-correlation-id` header is a fixed-size string. This
adds well under the 10% gate-latency ceiling (Rule 4); if a future log-drain export is
added it must be fire-and-forget (never awaited in the request path).

## 8. Concerns

- The wrapper-line approach needs a `route` label passed into `withAuth`/`serveAuthed`;
  today `serveAuthed(handler, sql)` has no route name. Adding it touches the cage-adjacent
  entrypoint signature for ~20 shims — mechanical but wide. Keep it a plain string arg, not
  config.
- `x-correlation-id` on responses is a (small) new piece of wire surface; confirm no
  reverse proxy strips it and that it carries no tenant info (it's a random uuid — safe).
- Mobile logger duplicates the functions logger by copy, not import (mobile imports
  `shared` only, never `functions`). That duplication is the existing accepted pattern
  (config.ts already hand-rolls the same shape); a shared logger in `packages/shared`
  would be cleaner but is a larger change than asked — flag, don't do.
</content>
</invoke>
