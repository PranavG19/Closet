# Edge Functions — deploy contract

These are the Deno deploy-shims Supabase deploys. Each is a ~3-line entrypoint that
wires the concrete Postgres pool (`_shared/pool.ts`) to a runtime-agnostic handler
already built + committed under `packages/functions`. The shims are the ONLY place
a real pg driver is imported; the handler layer stays driver-free and unit-testable.

**No business logic lives here.** A shim only: (1) imports its handler from the
built `@closet/functions` dist, (2) constructs the pool adapter over an env-supplied
connection string, and (3) serves it — via `serveAuthed(handler, sql)` for the
user-JWT routes, or `Deno.serve(revenueCatWebhook(sql))` for the webhook.

## Layout

- `_shared/pool.ts` — the single `Sql` pool adapter over node-postgres. Prefixed
  with `_` so Supabase does not deploy it as its own function.
- `<route>/index.ts` — one directory = one Edge Function = one HTTP route.
- `../import_map.json` — maps `npm:pg` / `npm:jose` and the built `@closet/*` dist.
- `../config.toml` — per-function config (`verify_jwt = false` on all; see below).

## Route → handler → pool role

| Route (`/functions/v1/…`) | Handler (`@closet/functions`)      | Entry         | Pool role (env)                          |
|---------------------------|------------------------------------|---------------|------------------------------------------|
| `wardrobe-list`           | `wardrobe/list#listWardrobe`       | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `wardrobe-availability`   | `wardrobe/availability#toggleAvailability` | `serveAuthed` | app_user-capable (`DATABASE_URL`) |
| `wardrobe-dedupe`         | `wardrobe/dedupe#resolveDedupe`    | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `outfits-create`          | `outfits/create#createOutfit`      | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `outfits-list`            | `outfits/list#listOutfits`         | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `wear-log`                | `wear-log/log-wear#logWear`        | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `palette-upsert`          | `palette/upsert-palette#upsertPalette` | `serveAuthed` | app_user-capable (`DATABASE_URL`)     |
| `parse-photo`             | `parse/parse-photo#parsePhoto`     | `serveAuthed` | app_user-capable (`DATABASE_URL`)        |
| `revenuecat-webhook`      | `billing/revenuecat-webhook#revenueCatWebhook` | `Deno.serve` | **service_role** (`SUPABASE_DB_SERVICE_URL`) |

The two pool roles are non-negotiable (see `_shared/pool.ts`):
- **app_user-capable** — a role GRANTed `app_user`. `makePgExecutor` runs `SET LOCAL
  ROLE app_user` + binds the verified JWT `sub` per transaction, so RLS confines
  every row to the caller. This role must NOT be able to bypass RLS.
- **service_role** — the RLS-exempt system identity. `makeServiceExecutor` issues NO
  `SET LOCAL ROLE`, so the webhook writes the money + ledger tables as this identity.
  Used by the webhook ONLY — never point a user-JWT route at this connection string.

## Env vars per function

Set with `supabase secrets set …` (never commit values; the shims read them at
runtime via `Deno.env`).

| Env var                     | Used by                        | Purpose                                              |
|-----------------------------|--------------------------------|------------------------------------------------------|
| `DATABASE_URL`              | all 8 user-JWT functions       | pg connection string for the app_user-capable role   |
| `JWKS_URL`                  | all 8 user-JWT functions       | asymmetric JWKS endpoint `withAuth` verifies against  |
| `SUPABASE_DB_SERVICE_URL`   | `revenuecat-webhook` only      | pg connection string for the service_role identity   |
| `REVENUECAT_WEBHOOK_SECRET` | `revenuecat-webhook` only      | shared secret compared in constant time              |

## `verify_jwt = false` on every function

Auth is owned by the HANDLER, not the Supabase gateway:
- The 8 user-JWT functions verify the caller's token against the asymmetric JWKS
  (no shared secret) inside `withAuth` — stronger than the gateway's symmetric
  verify, which would double-guard with a different scheme and can reject a valid
  asymmetric JWT.
- `revenuecat-webhook` has no end-user JWT; it authenticates a shared secret.

## parse-photo is inert until the provider-adapter task lands

`parsePhoto` is currently bound to `unwiredPorts` — the GPT-4o / Photoroom provider
adapters are NOT wired (a SEPARATE task that needs API keys). The shim is correct
as-is: the handler returns **502** until those adapters ship. Deploying the route now
stands up the auth + DB seam; the parse worker stays inert until the adapter task
lands (it will add provider-key env vars, e.g. `OPENAI_API_KEY` / `PHOTOROOM_API_KEY`,
and bind real ports — no change to this shim required).

## Deploy

Build the workspace first (the shims import the built `dist/` of `@closet/*`):

```
pnpm -w exec tsc --build
supabase functions deploy <route>   # per function, or omit <route> to deploy all
```
