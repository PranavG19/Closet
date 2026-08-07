# DEPLOY-RUNBOOK — standing up the real Supabase project

*The ordered sequence for LAUNCH-READINESS step 4. Written to be executed, not read:
copy-paste in order, and do not skip step 9 (preflight), which is the whole point of
the other eight. **[H]** = human-required (escalation trigger), **[A]** = agent-doable,
**[A→H]** = agent prepares, human gates — same convention as LAUNCH-READINESS §7.*

*Honest scope. This runbook does NOT make the product work. `parse-photo` still returns
502 (no provider adapters — LAUNCH-READINESS §3), no screen has ever rendered, and the
on-device privacy classifier does not exist. It makes the DEPLOY step **safe**: the two
silent-failure traps (§6.2 service_role, §6.5 Storage RLS) become loud failures before
a real user or a real dollar arrives.*

---

## 0. What preflight is, and why it comes last

`packages/functions/test/preflight.integration.test.ts` is the deploy gate. It is a
normal integration-project test file, so it needs no new tooling:

```
pnpm -w exec vitest run --project integration packages/functions/test/preflight.integration.test.ts
```

Without preflight env set it **SKIPS** every project-dependent check and prints a
`PREFLIGHT SKIPPED — NOT RUN AGAINST A REAL PROJECT. THIS IS NOT A PASS.` banner. That
is deliberate: `pnpm verify:full` in CI stays green *and* honest, and a skip can never
be mistaken for a proof.

**As of 2026-08-07, checks A.1 / A.2 / A.3 / A.4 / B.1 are WRITTEN BUT HAVE NEVER
EXECUTED.** No Supabase project exists. Their first real run *is* step 9. Treat a first
green as the first time anything about this deploy has been externally verified — and
expect A.1 or B.1 to be RED on the first attempt, because they are testing exactly the
things a human wires by hand.

| Check | Proves | Trap |
|---|---|---|
| **A.0** | every shim dir has a `verify_jwt = false` stanza in `config.toml` | gateway 401s every request |
| **A.1** | `SUPABASE_DB_SERVICE_URL` really bypasses RLS, `DATABASE_URL` really does not | **§6.2 — the money write** |
| **A.2** | `JWKS_URL` resolves and the production verifier accepts a real token | §6.6 — every authed request |
| **A.3** | the deployed migration ledger matches the files on disk, in order | half-applied deploy |
| **A.4** | every deployed route answers with `withAuth`'s 401, not the gateway's | gateway 401s every request |
| **B.1** | Storage RLS binds the path prefix to the requester's `sub`, both buckets, read AND write | **§6.5 — the privacy invariant** |

**A.0 runs everywhere, needs no project, and already caught a real defect** — three
shims (`account-delete`, `account-export`, `palette-entitlement`) had no `config.toml`
stanza, so they would have deployed with the gateway's JWT verification ON and 401'd
every real request. Fixed in the same change that added the check. Run A.0 now, before
you provision anything: it costs nothing and it is the cheapest of these to get wrong.

---

## 1. Create the project **[H]**

Irreversible-op escalation: provisioning infra and issuing credentials is not
autonomous (LAUNCH-READINESS §5).

1. Create the Supabase project. Record the **project ref** (the `<ref>` in
   `https://<ref>.supabase.co`) and the region.
2. `cp .env.example .env.deploy` — it is gitignored. Fill in real values as you go.
   **Never `cat` it, never `echo` a value into a chat.** SOURCE it (step 4).
3. `supabase link --project-ref <ref>` (the CLI writes no secret into the tree).

`.env.example` is the authoritative list of every var, the exact identity each one
must have, and the blast radius if it is wrong. Read it once before continuing.

---

## 2. Create the `app_user` role and the two connection identities **[H]**

This is the step that arms trap A. **`SUPABASE_DB_SERVICE_URL`'s identity IS the
privilege boundary** — `makeServiceExecutor` (`packages/functions/src/auth/executor.ts:42`)
issues **no** `SET LOCAL ROLE`, so whatever role that pool connects as is the authority
the money write runs with. There is no runtime check. Preflight A.1 is the check.

The `app_user` role itself is created by **migration 0001** (`0001_substrate.sql`,
idempotent `CREATE ROLE app_user NOLOGIN`) — do **not** create it by hand. What you
create here is the **login role** that will be GRANTed it.

```sql
-- Run in the Supabase SQL editor AFTER step 4 (migrations create app_user).
-- A login role for the 11 user-JWT routes. NOT RLS-exempt, NOT superuser.
CREATE ROLE closet_app LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';
GRANT app_user TO closet_app;
GRANT USAGE ON SCHEMA public TO closet_app;
```

Then set the two connection strings in `.env.deploy`:

| Var | Identity it MUST have | If wrong |
|---|---|---|
| `DATABASE_URL` | `closet_app` — GRANTed `app_user`, **not** RLS-exempt | Too weak → all 11 routes 500. **Too strong** → RLS confines nothing and any user can mint entitlement. |
| `SUPABASE_DB_SERVICE_URL` | the RLS-exempt `service_role` (Supabase's built-in), or a `BYPASSRLS` role with INSERT/UPDATE on `subscriptions` + `webhook_events` | Every purchase raises **42501**; a paying customer stays locked out. |

Both point at the **same database**. Preflight A.1b catches it if they don't.

### Route → env-var mapping **[A]** — derived from `supabase/functions/*/index.ts`

Read off the `makePool('…')` argument and the entry function in each shim, not from
prose. `serveAuthed` → `withAuth` → needs `JWKS_URL`; `Deno.serve` → no JWT.

| Route (`/functions/v1/…`) | Shim entry | Pool env | Also needs | Breaks if that env is wrong |
|---|---|---|---|---|
| `wardrobe-list` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | the closet does not load |
| `wardrobe-availability` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | laundry / availability toggle dead |
| `wardrobe-dedupe` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | duplicate-item merge dead |
| `outfits-create` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | cannot save an outfit |
| `outfits-list` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | outfits screen empty |
| `wear-log` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | wear logging dead |
| `palette-upsert` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | palette quiz cannot save |
| `palette-entitlement` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | **paywall cannot read entitlement** — a paying user sees the paywall |
| `parse-photo` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | the core loop (already 502 pending adapters) |
| `account-export` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | **GDPR Art. 15** data export dead |
| `account-delete` | `serveAuthed` | `DATABASE_URL` | `JWKS_URL` | **App Store 5.1.1(v)** in-app account deletion dead — a review rejection |
| `revenuecat-webhook` | `Deno.serve` | **`SUPABASE_DB_SERVICE_URL`** | `REVENUECAT_WEBHOOK_SECRET` (no JWT) | **§6.2 — entitlement never flips** |

**11 user-JWT routes + 1 webhook = 12 shim directories.** (LAUNCH-READINESS §2 and
`supabase/functions/README.md` both say 9–10 — stale; see the "Contradictions" section.)

---

## 3. Set the runtime secrets on the project **[H]**

The deployed shims read these through `Deno.env`; they do **not** read `.env.deploy`.

Only the **four** runtime vars from `.env.example` section 1 belong on the project. The
`PREFLIGHT_*` vars are local-only test config — pushing them is harmless but pointless,
and `PREFLIGHT_USER_*_JWT` are short-lived tokens that should not be stored anywhere.
So keep a runtime-only file rather than pushing `.env.deploy` wholesale:

```
cp .env.example .env.runtime     # gitignored; keep ONLY section 1's four vars
supabase secrets set --env-file ./.env.runtime
```

`--env-file` reads the file directly (verified: `supabase secrets set --env-file`, CLI
2.34.3), so no value is ever echoed to a terminal or into an agent's context. If you must
set one at a time, source rather than paste:

```
set -a; . ./.env.runtime; set +a
supabase secrets set JWKS_URL="$JWKS_URL"
```

---

## 4. Apply the migrations **[A→H]**

`node-pg-migrate` is the only way schema changes. The migrate role needs DDL rights, so
use a privileged connection string here — put it in a **separate** `.env.migrate` so the
DDL credential is not the same file as the runtime app credential.

```
cp .env.example .env.migrate     # keep ONLY DATABASE_URL, set to the migrate role
set -a; . ./.env.migrate; set +a
pnpm db:migrate
```

`scripts/db-migrate.mjs` requires `DATABASE_URL` in env and exits with the sourcing
instructions if absent. **Never `cat`/`echo` `.env.migrate`** — the `secret-file-guard`
hook enforces this, and `set -a; . ./file; set +a` keeps the value out of context.

Migration 0001 is **dual-target**: on hosted Supabase it detects that GoTrue already
owns the `auth` schema and does not fabricate the local stand-in, while still defining
`auth.uid()` via `CREATE OR REPLACE`. It also creates `app_user`. Nothing to do
manually.

Then run step 2's `CREATE ROLE closet_app` SQL (it needs `app_user` to exist), and
verify with preflight A.3 at step 9 — not by eyeballing the CLI output.

**Do not** run `pnpm db:migrate:down` or `:redo` against this project. The DOWN
round-trip on populated, prod-shaped data is a separate human-gated Tier-4 exercise
(LAUNCH-READINESS §5); `redo` on a live database is destructive.

---

## 5. Create the Storage buckets **[H]**

`docs/06 §6` is authoritative: **two PRIVATE buckets**, `originals` (approved uploads)
and `cutouts` (parse output), both keyed on first path segment = owner:
`{user_id}/{parse_job_id}/{…}`.

**There is no CLI bucket-create command** — `supabase storage` (CLI 2.34.3) exposes only
`cp` / `ls` / `mv` / `rm`. Create both buckets in the **dashboard** (Storage → New bucket)
with **Public = off**, or via SQL:

```sql
-- Both PRIVATE. `public = false` is the load-bearing column.
INSERT INTO storage.buckets (id, name, public) VALUES ('originals', 'originals', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('cutouts', 'cutouts', false)
  ON CONFLICT (id) DO NOTHING;
```

Verify with `supabase storage ls ss:///originals` (empty, not an error) and confirm in the
dashboard that **neither is public**. A public bucket makes every RLS
policy below irrelevant: the objects are readable by URL and the privacy invariant is
void regardless of what B.1 asserts about the authenticated path.

> **Naming note.** LAUNCH-READINESS §6.5 and docs/05 say "**uploads** + cutouts". There
> is no `uploads` bucket anywhere in the design — docs/06 §6, `0014_delete_account_fn.sql`,
> the privacy policy, and the export/delete handlers all say `originals`. Doc drift, not
> a third bucket. Preflight B.1 hardcodes `originals` + `cutouts` deliberately: if the
> operator creates a differently-named bucket, B.1 must fail loudly rather than adapt.

---

## 6. Apply the Storage RLS policies **[A→H]** — NOT AUTHORED IN THIS RUNBOOK

The policy SQL lands in **`packages/db/migrations/0013_storage_rls.sql`**, authored
concurrently by another task. This runbook must not write it and does not duplicate it.

Nothing you can create in the dashboard substitutes for it — buckets alone grant no
access, and RLS on `storage.objects` is, per docs/06 §6, *"the ONLY control preventing
cross-user byte reads/writes."*

**What the operator must confirm about 0013 before proceeding** (docs/06 §6, verbatim
requirements — check each against the migration text):

1. It compares `(storage.foldername(name))[1] = auth.uid()::text`. **The `::text` cast
   is mandatory** — `auth.uid()` is `uuid`, `foldername()` returns `text`, and without
   the cast the comparison misbehaves.
2. It includes a `bucket_id` predicate, so a policy for one bucket cannot apply to the
   other.
3. It covers **read AND write** on **both** buckets (`SELECT`, `INSERT`, and `UPDATE` —
   an `INSERT`-only policy still lets a user overwrite a neighbour's object).
4. It is applied by `pnpm db:migrate` (re-run step 4 once 0013 lands) and shows up in
   preflight A.3's ledger comparison.

Then, and only then, does B.1 have something to prove. **Path obscurity is never the
control.**

---

## 7. Configure the RevenueCat webhook **[H]**

1. Generate a long random `REVENUECAT_WEBHOOK_SECRET` and put it in `.env.deploy`
   (step 3 pushes it to the project).
2. In the RevenueCat dashboard set the webhook URL to
   `https://<ref>.supabase.co/functions/v1/revenuecat-webhook` and the
   **Authorization header** to that exact same value, byte for byte. The handler
   compares the whole header in constant time
   (`packages/functions/src/billing/revenuecat-webhook.ts:82`) — no `Bearer ` prefix is
   added or stripped, so whatever you type in the dashboard is what must be in the env
   var.
3. Do **not** send a real purchase yet. Step 9's A.1 proves the *write authority*
   without money; the real-event chaos verification is step 10.

---

## 8. Deploy the Edge Functions **[A→H]**

The shims import the built `dist/` of `@closet/*` (see `supabase/import_map.json`), so
build first or you deploy stale code.

```
pnpm -w exec tsc --build
supabase functions deploy          # all 12; per-route: supabase functions deploy <route>
```

`supabase/config.toml` carries `verify_jwt = false` + the shared import map for all 12.
That is load-bearing, not a convenience: auth is owned by the **handler**
(asymmetric JWKS inside `withAuth`), and the gateway's symmetric verify would reject our
valid asymmetric tokens. Preflight A.0 proves the config covers every shim; A.4 proves
the *deployed* reality matches.

`parse-photo` deploys and answers, but returns **502** until the provider adapters land.
That is expected and documented — deploying it now stands up the auth + DB seam.

---

## 9. RUN PREFLIGHT — REQUIRED GREEN BEFORE ANY REAL TRAFFIC **[A]**

```
set -a; . ./.env.deploy; set +a
pnpm -w exec vitest run --project integration packages/functions/test/preflight.integration.test.ts
```

Read the output, do not just read the exit code:

- **`PREFLIGHT SKIPPED` banner appears** → your env did not load. `PREFLIGHT_PROJECT_REF`
  is the master opt-in and every env-gated check requires it. **A skip is not a pass.**
- **All green, no banner** → the two traps are closed *for this project, right now*.
- **Any red** → do not send traffic. Triage below.

Then run the standing wall to confirm nothing regressed:

```
pnpm verify:full
```

### When A.1 fails — triage **[H]**

A.1 is trap A. Read *which* sub-check failed; they mean different things.

**A.1a red, SQLSTATE `42501`** — the common case. `SUPABASE_DB_SERVICE_URL` is not a
service_role identity.
- Confirm the role in the connection string is Supabase's `service_role`, not
  `postgres`-with-no-grants, not `closet_app`, not `anon`.
- Check for a copy/paste swap: the two connection strings differ only in the role and
  password, and swapping them is the single most likely mistake at step 2.
- If you deliberately use a custom role, it needs `BYPASSRLS` **and** INSERT/UPDATE on
  `public.subscriptions` and `public.webhook_events`. `subscriptions` has RLS FORCE with
  a SELECT-only policy (0008); `webhook_events` has RLS FORCE and **no policy and no
  grant at all** (0009), so a non-BYPASSRLS role fails on the dedup insert even with
  table grants.
- **Do not "fix" this by loosening the migrations.** Granting `app_user` INSERT on
  `subscriptions` would turn A.1a green and hand every user the ability to mint their
  own entitlement — A.1c exists to catch exactly that attempted shortcut, and it would
  go red. The correct fix is always the connection string.
- Fix, re-run A.1, and only then let RevenueCat send anything.

**A.1a red, some other SQLSTATE** — likely `42P01` (relation does not exist) → the
migrations are not applied; go fix A.3 first. Or the string points at the wrong
database entirely.

**A.1b red** (service write landed, app_user read cannot see it) — `DATABASE_URL` and
`SUPABASE_DB_SERVICE_URL` are pointing at **different databases**, or 0008's policy/grant
did not apply. Check A.3, then compare the host+dbname of both strings.

**A.1c red** — the loudest possible failure, and it means the opposite of the others:
`DATABASE_URL` **can write the money table**. Its role is over-privileged (service_role,
superuser, or `BYPASSRLS`), or `app_user` was granted INSERT somewhere. Any authenticated
user can currently mint their own entitlement and the paywall is bypassable. **Stop.**
Re-point `DATABASE_URL` at the plain `closet_app` role from step 2. Note that A.1a can be
green while A.1c is red — that combination is precisely "everything can write the money
table," which is why A.1c exists.

### When B.1 fails — triage **[H]**

- **Own-prefix write refused** → the bucket does not exist, or 0013 was not applied
  (check A.3), or the `INSERT` policy is missing its `bucket_id` predicate.
- **Cross-prefix READ succeeded** → privacy breach. The `SELECT` policy is missing, or
  missing the `::text` cast, or lacks the `bucket_id` predicate so one bucket's policy is
  leaking onto the other. Do not ship.
- **Cross-prefix WRITE succeeded** → same, for `INSERT`/`UPDATE`. B.1 grades this by
  asking the *prefix owner* whether the object landed, so a "403 that still wrote" cannot
  hide.
- **`subA === subB` assertion failed** → the two `PREFLIGHT_USER_*_JWT` values are the
  same user; B.1 would be a tautology. Mint two distinct test users.

### When A.4 fails — triage **[H]**

A route returned something other than `withAuth`'s `{"error":{"code":"unauthorized"}}`
401. That means the **Supabase gateway** rejected the request before the handler ran —
`verify_jwt` is ON for that function. Add the stanza (or `--no-verify-jwt`) and redeploy.
`unreachable` instead means the function was never deployed; `account-delete` and
`account-export` are the likeliest to be missed, since they were the routes A.0 found
missing from `config.toml`.

---

## 10. Still human-gated after a green preflight **[H]**

A green preflight does **not** mean launch-ready. Preflight proves the *deploy* is wired
correctly. It does not prove:

- **The money path against a real RevenueCat event.** A.1 proves the write *authority*;
  it does not replay a real purchase, replay-dedup, or out-of-order event. That is
  LAUNCH-READINESS §7 step 8 and needs a real captured RC event — a self-mocked success
  is a mirror oracle.
- **The migration DOWN round-trip on populated, prod-shaped data.** Never `db:migrate:down`
  on this project casually (step 4).
- **The on-device privacy classifier.** B.1 proves the *storage* half of the privacy
  invariant. The classifier — which decides what is ever offered for upload — does not
  exist in any form. The invariant is not enforced end-to-end until it does.
- **Anything visual.** No screen has been rendered.
- **Rate limiting / provider-spend throttle** (docs/06 §8) — unbuilt; cost-abuse exposure
  is real from the first authenticated user.

---

## 11. ROLLBACK

Ordered least- to most-destructive. **Nothing here runs autonomously** — every step is
**[H]**.

**Bad secret / wrong identity (most likely).** Fully reversible, no data touched:
1. Fix the value in `.env.deploy`.
2. `supabase secrets set --env-file ./.env.deploy`.
3. Re-run step 9. Edge functions pick up new secrets on their next cold start; force one
   by redeploying the affected route.

**Bad function deploy.** Fix the source, `pnpm -w exec tsc --build`, redeploy that route.
Functions are versioned by deploy; a redeploy is the rollback. Nothing in the DB changes.

**Storage policy wrong (B.1 red).** Do **not** hand-edit policies in the dashboard —
that desynchronises the deployed state from the migration chain and A.3 will not catch
it. Append a **new numbered migration** correcting 0013 and re-run step 4. Never edit a
landed migration.

**Migration needs reverting.** `pnpm db:migrate:down` on a live database is destructive
and is an **escalation trigger**: DOWN must first be round-tripped on populated,
prod-shaped data (LAUNCH-READINESS §5), and narrowing/destructive DDL requires an
approval token under `packages/db/migrations/approvals/`. Prefer **expand/contract** —
append a forward-fixing migration instead of reverting. If a revert is genuinely
required: take a backup first, revert exactly one step, then re-run preflight A.3.

**Total abort before any real users.** The project has no real data yet, so the clean
option is to delete the project and start from step 1 rather than to unpick a
half-configured one. **Only** while `subscriptions` holds nothing but preflight's
`deadbeef-…` scratch row — after one real purchase this is destructive and off the table.

**If a real purchase has already landed and entitlement did not flip:** do not
hand-`UPDATE` `subscriptions`. Fix the identity (step 2 / triage above); RevenueCat
retries the event, and the webhook's replay-dedup + monotonic guard make the retry
correct and idempotent. A manual UPDATE bypasses the ledger and desynchronises
`event_ts`, which then silently suppresses the *next* legitimate event via the monotonic
guard.

---

## Contradictions with LAUNCH-READINESS §2 / §6 found while writing this

Reported, not silently corrected in that doc.

1. **Route count is wrong everywhere.** LAUNCH-READINESS §2 says "9 Edge handlers",
   `supabase/functions/README.md`'s table lists **9** routes and its env table says
   "all 8 user-JWT functions". Disk has **12** shim directories: the README's table omits
   `palette-entitlement`, `account-export`, and `account-delete` entirely. Proving line —
   `ls -1d supabase/functions/*/ | wc -l` = 12 (11 `serveAuthed` + 1 `Deno.serve`).
   `supabase/functions/README.md` needs its table and its "all 8 user-JWT functions"
   rows updated to 11.

2. **`config.toml` was missing three functions — a real day-1 outage, now fixed.**
   Before this change, `supabase/config.toml` had 9 `[functions.*]` stanzas while 12 shims
   existed. `account-delete`, `account-export`, and `palette-entitlement` would have
   deployed with the gateway's `verify_jwt` **ON**, and since our tokens are asymmetric
   while the gateway verifies symmetrically, **every real request to those three would
   have 401'd** — taking out App Store 5.1.1(v) account deletion, GDPR Art. 15 export,
   and the paywall's entitlement read. LAUNCH-READINESS §6 does not list this among the
   day-1 breakages; it should. Preflight A.0 found it on its first execution and now
   prevents its recurrence.

3. **"uploads" bucket does not exist.** LAUNCH-READINESS §6.5 and docs/05 Tier-2/§107 say
   "uploads + cutouts buckets". Every implementation-side source says **`originals`** +
   `cutouts` (docs/06 §6:199, `0014_delete_account_fn.sql:71`,
   `privacy-policy.md:129-130`, `export-data.ts`). Cosmetic in the doc, but a runbook
   operator reading only LAUNCH-READINESS would create a bucket the app never writes to
   and never create the one it does.

4. **§4's "12 migrations" is stale.** LAUNCH-READINESS §2 says "12 migrations …
   `0001`…`0012`. Count verified (`ls | wc -l` = 12)". Disk now has **13** files —
   `0014_delete_account_fn.sql` landed after that audit, and **there is no `0013`** (it is
   being authored concurrently for Storage RLS). Consequences the doc does not flag:
   preflight A.3a compares against whatever is on disk, so it is self-correcting; but
   A.3b exists because once 0014 is applied and 0013 lands afterwards, the next
   `pnpm db:migrate` **hard-fails** with node-pg-migrate's *"Not run migration
   0013_storage_rls is preceding already run migration 0014_delete_account_fn"*
   (`checkOrder`, `node-pg-migrate/dist/bundle/index.js:3712`) and applies nothing.
   **Ordering consequence for this runbook: do not run step 4 until 0013 exists, or
   0013 must be renumbered above 0014.** Flagged for the 0013 author.
