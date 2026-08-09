# Edge Functions — deploy contract

These are the Deno deploy-shims Supabase deploys. Each is a ~3-line entrypoint that wires the concrete Postgres pool (`_shared/pool.ts`) to a runtime-agnostic handler already built + committed under `packages/functions`. The shims are the ONLY place a real pg driver is imported; the handler layer stays driver-free and unit-testable.

**No business logic lives here.** A shim only: (1) imports its handler from the built `@closet/functions` dist, (2) constructs the pool adapter over an env-supplied connection string, and (3) serves it — via `serveAuthed(handler, sql)` for the user-JWT routes, or `Deno.serve(revenueCatWebhook(sql))` for the webhook.

Re-derive the counts in this file before trusting them:

```
ls -d supabase/functions/*/ | wc -l           # → 13 dirs; one is _shared → 12 routes
grep -c '^\[functions' ../config.toml         # → 12 — must equal the route count
grep -c 'verify_jwt = false' ../config.toml   # → 13 (12 stanzas + the header comment)
```

## Layout

- `_shared/pool.ts` — the single `Sql` pool adapter over node-postgres. Prefixed with `_` so Supabase does not deploy it as its own function.
- `<route>/index.ts` — one directory = one Edge Function = one HTTP route.
- `../import_map.json` — maps `npm:pg` / `npm:jose` and the built `@closet/*` dist.
- `../config.toml` — per-function config. **`verify_jwt = false` on all 12; see below.**

## Route → handler → pool role (12 routes)

| Route (`/functions/v1/…`) | Handler (`@closet/functions`) | Entry | Pool role (env) |
|---|---|---|---|
| `wardrobe-list` | `wardrobe/list#listWardrobe` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `wardrobe-availability` | `wardrobe/availability#toggleAvailability` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `wardrobe-dedupe` | `wardrobe/dedupe#resolveDedupe` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `outfits-create` | `outfits/create#createOutfit` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `outfits-list` | `outfits/list#listOutfits` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `wear-log` | `wear-log/log-wear#logWear` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `palette-upsert` | `palette/upsert-palette#upsertPalette` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `palette-entitlement` | `palette/read-entitlement#readEntitlement` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `parse-photo` | `parse/parse-photo#parsePhoto` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `account-export` | `account/export-data#exportData` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `account-delete` | `account/delete-account#deleteAccount` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `revenuecat-webhook` | `billing/revenuecat-webhook#revenueCatWebhook` | `Deno.serve` | **service_role** (`SUPABASE_DB_SERVICE_URL`) |

**11 user-JWT routes + 1 webhook = 12.** For what *breaks* when each env var is wrong, see `docs/DEPLOY-RUNBOOK.md` §"Route → env-var mapping" — that table is the canonical one and carries the failure mode per route.

**`packages/mobile/src/api/routes.ts` has 11 entries, not 12, and that is correct.** `revenuecat-webhook` is server-to-server with no client caller. Do not "reconcile" it.

The two pool roles are non-negotiable (see `_shared/pool.ts`):
- **app_user-capable** — a role GRANTed `app_user`. `makePgExecutor` runs `SET LOCAL ROLE app_user` + binds the verified JWT `sub` per transaction, so RLS confines every row to the caller. This role must NOT be able to bypass RLS.
- **service_role** — the RLS-exempt system identity. `makeServiceExecutor` issues NO `SET LOCAL ROLE`, so the webhook writes the money + ledger tables as this identity. Used by the webhook ONLY — **never point a user-JWT route at this connection string.**

**This is the single most dangerous misconfiguration in the system.** If `SUPABASE_DB_SERVICE_URL` is not wired to a real `service_role`, the entitlement write hits RLS and raises `42501` — exactly the refusal the tests prove for `app_user` — so a valid RevenueCat purchase 500s, entitlement never flips, and the paying customer stays locked out. Preflight A.1 checks it (and checks the inverse, that `app_user` *is* refused, so it is a real discriminator rather than a tautology). **A.1 has never executed** — no project exists.

## Env vars

Set with `supabase secrets set …` (never commit values; the shims and handlers read them at runtime via `Deno.env`, always through `requireEnv`/`envValue`, never bare `process.env`).

Re-derive: `git grep -ohE "(requireEnv|envValue)\('[A-Z_]+'" -- packages/functions/src | sort -u`

**Required — a missing value is a hard failure:**

| Env var | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | all **11** user-JWT functions | pg connection string for the app_user-capable role |
| `JWKS_URL` | all **11** user-JWT functions | asymmetric JWKS endpoint `withAuth` verifies against |
| `SUPABASE_DB_SERVICE_URL` | `revenuecat-webhook` only | pg connection string for the service_role identity |
| `REVENUECAT_WEBHOOK_SECRET` | `revenuecat-webhook` only | shared secret compared in constant time |
| `OPENAI_API_KEY` | `parse-photo` (vision adapter) | GPT-4o attribute extraction. Never placed in a URL or a log |
| `PHOTOROOM_API_KEY` | `parse-photo` (cutout adapter) | background removal |
| `SUPABASE_URL` | `parse-photo` (storage reader/writer) | Storage REST base for the signed-URL mint + cutout upload |
| `SUPABASE_ANON_KEY` | `parse-photo` (storage reader/writer) | the `apikey` header; the caller's own JWT is the `Authorization` |

**Optional tunables — `envValue`, safe defaults, a missing value is not an error:**

| Env var | Default behaviour |
|---|---|
| `OPENAI_BASE_URL` / `OPENAI_VISION_MODEL` | vendor defaults; override to point at a proxy or pin a model |
| `PHOTOROOM_BASE_URL` | vendor default |
| `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RETRIES` | per-call `AbortController` timeout and bounded retry (429/5xx only, jittered backoff) |
| `PARSE_RATE_LIMIT_MAX` / `PARSE_RATE_LIMIT_WINDOW_SECONDS` | **20 requests / 3600s.** These defaults are the ENFORCED values, not a fallback to "off": unset, `''`, `'0'`, `'-1'`, `'off'`, `'Infinity'`, `'12.5'` all fall back to the default. **There is deliberately no value meaning unlimited** — misconfiguration can only tighten, never open |

The templates live in `.env.example` (root) + `packages/mobile/.env.example`. **Both are currently UNTRACKED by git** — the `bash-guard` hook blocks staging any dotenv path, which is the correct default and was not routed around. On a fresh clone they do not exist. Staging them is an open owner decision.

## `verify_jwt = false` on every function — this is the contract, not an oversight

Auth is owned by the **HANDLER**, not the Supabase gateway:

- The 11 user-JWT functions verify the caller's token against the **asymmetric** JWKS (no shared secret) inside `withAuth`. The gateway verifies **symmetrically**, so leaving it on double-guards with a different scheme and **rejects a valid asymmetric JWT before the handler ever runs.**
- `revenuecat-webhook` has no end-user JWT; it authenticates a shared secret in constant time.

**This has already caused a real day-1 outage, which is why it is stated this emphatically.** Before `8183aa5`, `config.toml` registered only **9** stanzas while 12 route dirs existed — `account-delete`, `account-export`, and `palette-entitlement` had none, so the gateway default (`verify_jwt` ON) applied and **every real request to those three would have 401'd**: App Store 5.1.1(v) account deletion, GDPR Art. 15 export, and the paywall's entitlement read, all silently dead while the routes "existed." **Preflight A.0 now fails if the stanza set and the shim dirs diverge** — it is the one preflight check that has actually executed, and it was fire-drilled three ways (missing stanza / `verify_jwt=true` / orphan stanza → red, then restored).

## `parse-photo` — wired to REAL providers; quality unmeasured

**This section previously said `parsePhoto` was bound to `unwiredPorts` and returned 502 until adapters shipped. That has been false since `7d1c3e3` / `8db9eda`** (`git grep -n unwiredPorts -- packages` → **0 hits**). `parse-photo.ts:248`:

```ts
export const parsePhoto: AuthedHandler = makeParsePhoto(makeProviderPorts, dbSpendLimiter);
```

`makeProviderPorts` builds the real GPT-4o vision + Photoroom cutout adapters plus the Supabase Storage reader/writer. The shim is unchanged and needs no change.

**What still fails, and where:** a real parse now fails on a **missing key or a missing bucket**, not on an unwired port. It needs `OPENAI_API_KEY`, `PHOTOROOM_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the private `originals` + `cutouts` buckets to exist. **No adapter has ever received a response from OpenAI or Photoroom** — every test drives an injected fake `FetchFn`. So the wiring is proven and the *output quality is unmeasured*; the handler's 502 (`parse-photo.ts:223`, `parse_provider_failed`) is the fail-closed path, not the default one.

Two security properties of this route that the shim does not show and that must not be undone:

- **`source_photo_path` is not a request field.** It was, and that was a cross-tenant photo read + SSRF (user A could name B's object and receive B's photo as garment attributes with the cutout landing in A's wardrobe). The key is now derived server-side as `{user_id}/{hash}/original`. **Storage RLS does not cover this** — the fetch happens on the vendor's servers from a URL we hand them, which no DB policy can reach.
- **The cutout is uploaded under the CALLER'S OWN token**, deliberately not `service_role`: a bypassing key would make a wrong path *succeed*, silently voiding the only cross-user control on photo bytes. `withAuth` threads `ctx.accessToken` for this and this only — it is never logged and is never an identity source; every tenant operation still keys off the verified `sub`.

## Deploy

Build the workspace first (the shims import the built `dist/` of `@closet/*`):

```
pnpm -w exec tsc --build
supabase functions deploy <route>   # per function, or omit <route> to deploy all
```

Then run the preflight suite against the real project — its 14 tests are the deploy gate and they have never executed:

```
set -a; . ./.env.deploy; set +a
pnpm -w exec vitest run --project integration packages/functions/test/preflight.integration.test.ts
```

Without `PREFLIGHT_PROJECT_REF` they self-skip and print `PREFLIGHT SKIPPED — THIS IS NOT A PASS`. Read that banner literally.
