# Task: revenuecat-webhook — the entitlement WRITE path (money table, service_role)

**slug:** `task-15-revenuecat-webhook`
**wave:** 5
**reversibility:** reversible (additive handler + schema + executor + test; no migration, no schema change)

## 1. Intent

`revenuecat-webhook` is the **sole writer** of `subscriptions.entitlement_active` — the money table `parse-photo` only ever reads. A RevenueCat server-to-server event arrives, is authenticated by a **shared secret** (NOT a user JWT — there is no end-user in this request), deduped for **replay idempotency** on the RevenueCat event id, mapped to an entitlement state, and written under a **service_role executor** (RLS-exempt system job). The two hard invariants:

1. **Replay-safe:** RevenueCat retries deliver the same event id more than once. A replay must be a 200 no-op that writes nothing new (dedup via `webhook_events.record()`).
2. **Monotonic:** a late-arriving OLDER event must NOT revoke a NEWER entitlement (the repo's `applyEvent` `DO UPDATE ... WHERE excluded.event_ts >= existing.event_ts` guard already enforces this — the handler must pass the real event timestamp so the guard bites).

The whole endpoint is: authenticate shared secret → parse event (parse-don't-cast) → `record(eventId)` (null = replay → 200 no-op) → map event to `ApplyEventInput` → `applyEvent` under a service_role executor → 200.

## 2. Context and constraints

**The DB write path is ALREADY BUILT (W3, committed) — consume as-is, author NO SQL:**
- `makeSubscriptionsRepo(exec).applyEvent(input: ApplyEventInput) -> Promise<SubscriptionRow | null>`. `ApplyEventInput = { userId: string, rcAppUserId: string | null, entitlementActive: boolean, eventTs: string, expiresAt: string | null }`. Returns null when the monotonic guard rejected a stale event (older `event_ts`) — that is a **success no-op**, return 200.
- `makeWebhookEventsRepo(exec).record(eventId: string) -> Promise<WebhookEventRow | null>`. Returns null when `event_id` was **already seen** (a replay) — return 200 and stop, write nothing else.
- Both are refused under an `app_user` executor (no INSERT grant on `subscriptions`/`webhook_events`; RLS FORCE + no policy). They REQUIRE a **service_role executor** (RLS-exempt). This is a structural guarantee: a client literally cannot mint entitlement.

**Schemas (extend `packages/shared/src/schemas/billing.ts` — it exists, has `SubscriptionRow`/`WebhookEventRow`/`EntitlementResponse`):**
- Add `RevenueCatEvent` — the INBOUND event Zod schema (parse-don't-cast at the boundary). Model the RevenueCat v1 webhook `event` envelope: at minimum `{ id: string, type: string, app_user_id: string, event_timestamp_ms: number, expiration_at_ms: number | null }` (`.passthrough()` is acceptable for the fields not consumed — RevenueCat adds many; but the CONSUMED fields are `.strict`-typed). Decide the entitlement mapping from `type`: `INITIAL_PURCHASE|RENEWAL|PRODUCT_CHANGE|UNCANCELLATION` → active; `CANCELLATION|EXPIRATION|BILLING_ISSUE` (past grace) → the mapping the handler owns. Document the exact type→active map in a comment; keep it small and named. `app_user_id` is the RevenueCat app user id = the Supabase `user_id` (identity is set at RC login to the JWT sub — state this assumption).

**Codebase patterns (inlined — do NOT open ../fitapp):**
- *Executor (the security-critical new piece):* the existing `packages/functions/src/auth/executor.ts` `makePgExecutor(sql, userId)` opens a tx, does `SET LOCAL ROLE app_user` + binds the sub, one tx per query(). The webhook needs a **service_role variant**: same one-tx-per-query shape, but it does **NOT** `SET LOCAL ROLE app_user` and sets **no** sub — it runs as the connection's own (service_role) identity, RLS-exempt, so `applyEvent`/`record` can write. Add `makeServiceExecutor(sql): QueryExecutor` to `executor.ts` (or a sibling), with a comment that this is the ONLY sanctioned RLS-bypass seam and it is used solely by system jobs (webhook, and later the parse worker). It sets no role explicitly IF the injected pool already connects as service_role; if the pool connects as a superuser/owner, `SET LOCAL ROLE` to the service role is acceptable — the test harness's superuser executor is the analog. Keep atomicity inside one statement (both repo methods are single statements already).
- *Auth:* this handler does NOT use `withAuth`/`serveAuthed` (those verify a user JWT via JWKS — wrong for a server-to-server webhook). Authenticate by comparing an `Authorization` header (RevenueCat sends a configured bearer/secret) against `requireEnv('REVENUECAT_WEBHOOK_SECRET')` via `envValue`/`requireEnv` (already in `auth/env.ts`) using a **constant-time comparison** (avoid a raw `===` timing oracle — a length-checked constant-time compare is fine; no new dep). Wrong/absent secret → `errorResponse(401, ...)`, write nothing. Use `jsonResponse`/`errorResponse`/`errorFromThrown` from `auth/respond.js` and the structured `logger`.
- *Repos-only, no supabase.from, const>let, parse-don't-cast, envValue not process.env, structured logger not console, NEVER log the raw event body / secret / PII (only event id + type + correlationId).* 

**What NOT to touch:** no migration (0008/0009 tables + grants already exist), no `packages/db` repo edits (methods exist), no `conventions.json`/`.claude`/`scripts`/`eslint`/`tsconfig`/`gate-budget`/`lefthook`. The Deno shim `supabase/functions/revenuecat-webhook/index.ts` is OUT of scope (deploy-wiring task) — flag it. If `makeServiceExecutor` belongs in a shared spot, put it in `packages/functions/src/auth/executor.ts` (that file is functions-owned, not a gate).

## 3. Technical requirements (dependency-ordered)

1. `packages/shared/src/schemas/billing.ts` — add `RevenueCatEvent` (+ export the type). Consumed fields strict-typed; document the `type` → `entitlementActive` map.
2. `packages/functions/src/auth/executor.ts` — add `makeServiceExecutor(sql): QueryExecutor` (RLS-exempt system-job seam; comment its narrow purpose + that it is NEVER used for a user request). One tx per query.
3. `packages/functions/src/billing/revenuecat-webhook.ts` — the handler. Constant-time secret check → 401 on mismatch. `parseBoundary(RevenueCatEvent, body)`. `record(event.id)` → null → `jsonResponse(200, { deduped: true })` no-op. Map event → `ApplyEventInput` (`userId = app_user_id`, `eventTs = new Date(event_timestamp_ms).toISOString()`, `expiresAt` from `expiration_at_ms` or null, `entitlementActive` from the type map). `applyEvent(input)` (null = stale monotonic no-op → still 200). `jsonResponse(200, ...)`. On unexpected throw → `errorFromThrown` (never leak the raw provider message).
4. Signature shape: this is a plain `(req: Request) => Promise<Response>` built over an injected `{ makeExec: () => QueryExecutor, secret: string, newCorrelationId }` deps object (mirror `withAuth`'s DI so the test injects a real service executor over the test pool + a known secret). Export both the deps-taking factory and a production-bound entry.

## 4. Acceptance criteria (Given-When-Then)

- **Happy path (grant):** Given a valid secret + an `INITIAL_PURCHASE` event for user A, When posted, Then `subscriptions` for A has `entitlement_active=true`, `event_ts` = the event time, `webhook_events` has the event id, response 200.
- **Replay is a no-op:** Given the SAME event id posted twice, When the second arrives, Then `record` returns null, `applyEvent` is NOT called a second time, the row is byte-unchanged from after the first, response 200.
- **Monotonic (no stale revoke):** Given A is active from a `RENEWAL` at t2, When an older `CANCELLATION` at t1<t2 arrives (different event id), Then `applyEvent` returns null, A stays `entitlement_active=true`, response 200.
- **Revoke on newer expiration:** Given A active at t1, When an `EXPIRATION` at t2>t1 arrives, Then A becomes `entitlement_active=false`.
- **Bad secret:** Given a wrong/absent `Authorization`, When posted, Then 401, and `subscriptions`/`webhook_events` are unchanged (independent SELECT count = 0 / row unchanged).
- **Malformed event:** Given a body missing a consumed field, When posted with a valid secret, Then `parseBoundary` rejects → 4xx, nothing written.

## 5. Verification requirements — the independent oracle

**Tier (docs/05):** Tier-3 backend E2E against real Postgres (full migration chain), **the money path** — plus the docs/05 "real webhook event" bar. The oracle is a **real RevenueCat event PAYLOAD** (a committed fixture of an actual RC v1 webhook JSON shape, not a hand-minted `{active:true}`), driven through the REAL handler + a REAL service_role executor over a real `subscriptions`/`webhook_events`, with every assertion an **independent SELECT** (a superuser/service SELECT confirms the write; an app_user executor confirms it CANNOT write). This is NOT a mocked "success" — per CLAUDE.md the entitlement path is verified against a real webhook event, never a mirror.

**File:** `packages/functions/test/revenuecat-webhook.integration.test.ts` (EXACT `.integration.test.ts` suffix under `packages/functions/test/`, or vitest's integration project silently skips it — the src/ glob trap).

**The oracles (green = all of):**
1. **Grant writes entitlement** — real RC `INITIAL_PURCHASE` fixture → independent SELECT shows `entitlement_active=true` + the event id recorded.
2. **Replay no-op** — post the same fixture twice; assert `applyEvent` invoked once (spy/count via an injected repo or a row-`updated_at`-unchanged check), row byte-identical after the 2nd, 200 both times.
3. **Monotonic guard bites** — older event after newer does NOT revoke (independent SELECT still active). Green proves the handler passes the real `event_ts` so the repo guard engages.
4. **Structural: app_user CANNOT write** — drive `applyEvent`/`record` through an app_user executor and assert it is REFUSED (42501 / RLS), proving the service_role seam is load-bearing and a client cannot mint entitlement. This is the sovereign-structural money guarantee.
5. **Bad secret → 401, zero writes** (independent SELECT).

**Red-first:** show the monotonic assertion fails against a handler that passes `now()` instead of the event's timestamp (guard never bites); show the replay assertion fails if `record`'s null is ignored. Mutation targets: the type→active map, the secret comparison, the `record`-null short-circuit.

## 6. Money path

Per CLAUDE.md (2026-08-06) the owner GRANTED full build+verify+commit+MERGE autonomy on the entitlement path — do NOT park this. The autonomy does NOT lower the oracle bar: verify against a **real RevenueCat event payload** (committed fixture of the actual webhook JSON), the app_user-cannot-write structural control must be green, and the replay + monotonic guards must be proven (not asserted). The webhook is the SOLE entitlement writer; `parse-photo` (W4) only reads. This closes the money loop: webhook writes `entitlement_active` → parse-photo's `kind=full` gate reads it.

## Metadata

- **Parent spec:** docs/06 §4 (revenuecat-webhook), §3 (subscriptions/webhook_events columns + grants), §8 rule 1 (money path). docs/05 Tier-3 + "real webhook event" bar.
- **Depends on:** `@closet/db` `makeSubscriptionsRepo.applyEvent` + `makeWebhookEventsRepo.record` (built, W3); `@closet/shared` billing schemas (extend); `packages/functions/src/auth/*` (respond, env, logger; NEW `makeServiceExecutor`). W1 test helpers. No new npm deps. No migration.
- **Reversibility:** reversible — additive files only.
- **Concerns:** (1) service_role executor is a genuine RLS-bypass seam — its blast radius is the money + system-job tables; the app_user-cannot-write oracle is what proves the seam is not over-broad. (2) Deno shim out of scope (deploy-wiring). (3) The exact RС event `type` set + grace-period semantics should be confirmed against RevenueCat's live docs before production; the committed fixture pins the shape used for the oracle.
