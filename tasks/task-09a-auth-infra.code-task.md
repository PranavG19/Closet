# Task: Auth infra — withAuth (JWKS) + per-request executor + respond + serveAuthed

## 1. Intent
Build the production request-context seam every authed endpoint depends on: `withAuth` verifies the caller's asymmetric-JWKS JWT, extracts the `sub` into `ctx.userId`, and constructs a per-request `QueryExecutor` that runs each query inside `BEGIN; SET LOCAL ROLE app_user; set_config('request.jwt.claim.sub', <sub>, true); … ; COMMIT` — the production analogue of the test executor, so RLS scopes every row to the verified caller. Identity comes ONLY from the verified token, never the request body. This is the security substrate for all of Wave 3–5.

## 2. Context & constraints
- **Spec reference:** docs/06 §4 (all five user-jwt functions run as `app_user` under the caller's JWT), §8 (identity from verified JWT `sub`; asymmetric JWKS, no shared secret). CLAUDE.md "Data access + security".
- **Codebase patterns:** docs/PATTERNS.md — the "Handler" and "Integration test" blocks; the prod executor mirrors `packages/db/test/helpers/executor.ts` (`makeTenantExecutor`), which is already committed — read it. Backup (do NOT open): `../fitapp/packages/functions/src/auth/`.
- **Code-style rules (CLAUDE.md):** identity ALWAYS from `ctx.userId` (verified `sub`), NEVER from the body; `parseBoundary` at every boundary, no `as` across trust boundaries; `envValue()` not bare `process.env` (Edge runs Deno — `SUPABASE_URL`/JWKS URL via `envValue`); structured logger, never `console`; never log raw `err_message` (PII); one tx per `query()` call; `const` over `let`; early returns.
- **What NOT to touch:** the migrations, `packages/db` (except importing its exported `QueryExecutor` type), `packages/shared` schemas, `conventions.json`, `.claude/`, `scripts/`, `eslint.config.mjs`, `tsconfig*.json`. Only create files under `packages/functions/src/auth/`.
- **Reversibility class:** reversible.

## 3. Technical requirements
1. `packages/functions/src/auth/respond.ts` — `jsonResponse(status, body)` and `errorResponse(status, code, message, correlationId)` returning a `Response` (Web Fetch `Response`, Deno-compatible); JSON content-type; error shape `{ error: { code, message }, correlationId }`.
2. `packages/functions/src/auth/executor.ts` — `makePgExecutor({ pool|client, userId })` returning a `QueryExecutor` (import the interface from `@closet/db`) that, per `query()`, checks out a connection and runs `BEGIN` → `SET LOCAL ROLE app_user` → `SELECT set_config('request.jwt.claim.sub', $1, true)` (the `userId`) → the caller's statement → `COMMIT`, rolling back + releasing on error. Signature identical to the test executor so repos are driven unchanged.
3. `packages/functions/src/auth/withAuth.ts` — `AuthedHandler` type `(req: Request, ctx: { userId: string; exec: QueryExecutor; correlationId: string }) => Promise<Response>`; `withAuth(handler)` returns `(req) => Response` that: extracts the bearer token; verifies it against the project JWKS (`jose` `createRemoteJWKSet` + `jwtVerify`, ES256/RS256, issuer/audience checked) — asymmetric, NO shared secret; on success builds `ctx` (userId = verified `sub`, a fresh per-request executor, a correlationId) and calls the handler; on any verification failure returns 401 via `errorResponse` and NEVER calls the handler.
4. `packages/functions/src/auth/serveAuthed.ts` — `serveAuthed(handler)` = the Deno-shim entrypoint (`Deno.serve(withAuth(handler))`), isolated so the Node package builds without Deno types (guard the `Deno` reference; it is only invoked in the shim runtime).
5. Re-export `AuthedHandler`, `withAuth`, `serveAuthed`, `jsonResponse`, `errorResponse`, `makePgExecutor` from a `packages/functions/src/auth/index.ts` barrel.
6. Add `jose` to `packages/functions` dependencies.

## 4. Acceptance criteria (Given-When-Then)
1. **Valid token → identity + role scope.** Given a JWT signed by the test JWKS with `sub = U`, When a trivial handler runs under `withAuth` against real Postgres, Then `ctx.userId === U`, the executor runs as `app_user`, and a row inserted is visible to U and invisible to another tenant.
2. **Forged / wrong-key token → 401, no handler.** Given a token signed by a key NOT in the JWKS (or `alg:none`), When the request hits `withAuth`, Then it returns 401 and the handler is never invoked and zero rows are written.
3. **Expired token → 401.** Given an `exp` in the past, Then 401.
4. **Missing/malformed bearer → 401.** Given no `Authorization` header, Then 401.
5. **Body-supplied identity is inert.** Given a body containing `user_id: <other>`, When the handler reads identity, Then it uses `ctx.userId` (the verified sub), not the body.
6. **Executor is transactional.** Given a query that errors mid-statement, Then the transaction rolls back and the connection is released (no leaked/poisoned connection).

## 5. Verification requirements (independent signal)
docs/05 **Tier-3** (real Postgres) + **Tier-2** (authz). Integration test (`packages/functions/test/auth.integration.test.ts`, exact suffix) that:
- Boots real Postgres via the W1 helper (`startPg` / `applyMigrations`), mints tokens with a local test JWKS (generate an ES256 keypair in-test; point `withAuth` at a local JWKS via `envValue`), drives a trivial insert-then-read handler.
- **Independent oracle:** identity + isolation graded by a fresh SELECT as the *other* tenant (0 rows) and a superuser cross-owner check — NOT the handler's own response. Bad-token cases assert **row count 0**, not just a 401 status (the response is never the sole oracle).
- **Red-first:** first assert a forged-token request is rejected; demonstrate the test would fail if `withAuth` trusted a body `user_id`. Green = all 6 criteria pass against real Postgres as `app_user`.

## 6. Failure & degradation
- JWKS endpoint unreachable → 401/503 (fail closed; never fall through to unauthenticated). Log a fixed reason string + correlationId, never the token.
- Malformed JSON body in a handler → the handler's `parseBoundary` throws → 400 via `errorResponse`; `withAuth` itself only owns auth failures.

## Metadata
- **Parent spec:** docs/06 §4, §8
- **Step:** Wave 3 (prerequisite for all endpoints)
- **Demo:** A trivial authed handler returns the caller's own rows and 401s a forged token, proven against real Postgres.
- **Complexity:** High
- **Dependencies:** W1 (packages/db QueryExecutor type + test helpers), `jose`.
