# closet-app — Backend Design

> **Accuracy note (re-derived 2026-08-08 at `ab25513`).** This is the most-cited authority in the repo (`D-001` calls §3 "authoritative on columns"), which makes its drift the most dangerous. §1/§3/§4 were re-derived against the tree in this pass; the counts they previously carried — "8 tables", "6 Edge Functions", "five run `verify_jwt=true`" — were **wrong on all three**. Re-derive before trusting any count here:
>
> ```
> node scripts/gates/check-rls.mjs                    # → 9 tenant tables, all RLS FORCE
> ls -d supabase/functions/*/ | wc -l                  # → 13 dirs; one is _shared → 12 routes
> grep -c '^\[functions' supabase/config.toml          # → 12
> ls packages/db/migrations/ | wc -l                   # → 16
> ```
>
> The canonical route→env mapping is `docs/DEPLOY-RUNBOOK.md` §"Route → env-var mapping" (derived by reading each shim's `makePool()` argument). Cite it; do not restate the list.

## 1. The spine, in one paragraph

**Identity is established up front, before the teaser parse** — one-tap Sign in with Apple / Google (no anonymous session). This is the genre norm for hard-paywall apps and it is a net *simplification*: there is no anonymous→permanent account link (so no `sub`-preservation risk, no orphaned teaser rows, no double-parse), and the teaser item cap becomes a real per-user server guarantee rather than best-effort. The only cost is one tap before the scan; account creation before payment also seeds commitment. Payment still comes only at the hard paywall after the reveal.

The daily loop runs **on-device**: the privacy gate, hashing, dedupe compare, color harmony (F9), the suggestion heuristic (F5), and palette scoring (B1) are all pure functions over the user's own data, so 100k users cost zero server compute for the morning question and need zero endpoints. The **remote side is deliberately small**: **9 tables**, all `RLS FORCE` default-deny keyed on the verified JWT `sub`; **12 Edge Functions** — **11** under the caller's user-JWT (running as `app_user`, never `service_role`) and **one** self-authed webhook that is the *sole* writer of the money table. **Client-direct-to-Supabase is used only for Storage bytes** (upload originals, download cutouts) under Storage RLS — never for table access, because repos-only is a locked invariant. Paid providers (GPT-4o attributes, Photoroom cutout) sit behind ports and are called **only** from `parse-photo`, which holds their secrets, enforces the teaser cap, the entitlement gate, and a per-user spend throttle server-side, and is made idempotent/resumable by an **atomic job-claim on `parse_jobs`** plus `UNIQUE(user_id, source_photo_hash)`. No queue, no worker, no scheduler, no event bus. Weather is a keyless provider (Open-Meteo) called from an on-device adapter, so no proxy function exists.

**The money/entitlement path is built, verified, and committed** (`fb60f22`, hardened by `0016`). `CLAUDE.md` granted full build/verify/commit/merge autonomy on it on 2026-08-06; it is **not** parked. What remains outstanding on money is only the *external* oracle — a real RevenueCat delivery — and the price/product configuration, which is an owner decision.

Two invariants stated as convention, **not** as enforcement, because the docs previously overclaimed: `supabase.from()` outside `packages/db` and bare `console`/`process.env` are **not** lint-banned — no such rule exists in `eslint.config.mjs`. The behaviour is clean by discipline. See `docs/LAUNCH-READINESS.md` §4 for the full list of gates that are claimed but absent.

---

## 2. On-device vs remote split

| Capability | Placement | Why |
|---|---|---|
| Privacy gate: drop intimate / non-person / screenshot / best-effort not-her photos | **on-device** | ABLATE-tier privacy invariant. There is deliberately no server gate — a server filter has already received the photo. The structural guarantee is "no upload without an explicit approval tap"; the classifier is a graded detection control (see §8). |
| Photo approval tap (promotes image to uploadable) | **on-device** | Explicit per-photo consent is the human backstop to the classifier; only an approved photo is ever eligible to upload. |
| `source_photo_hash` (idempotency) + `phash` (dedupe signal) | **on-device** | Computed pre-upload so re-parse is a no-op and dedupe needs no server pass. Pure compute over a local image. |
| Upload approved original photos to Storage | **client-direct-to-Supabase** | Direct write to the `originals` bucket at `{user_id}/...` under Storage RLS. Never stream image bytes through Edge CPU/egress. Not a DB access, so repos-only does not apply. |
| Download + cache cutout images | **client-direct-to-Supabase** | Storage read at `{user_id}/...` under Storage RLS; cached locally so the closet renders offline. No Edge hop to move bytes. |
| Parse orchestration (teaser + full): attributes + cutout, write items, advance jobs | **Edge (`parse-photo`)** | Holds the vision + cutout SECRETS, enforces the teaser cap and the entitlement gate server-side. Runs as `app_user` under the caller's JWT — RLS confines writes to the caller's rows. |
| Garment attribute extraction (category/color/pattern) | **external (AIVisionPort)** | GPT-4o, called only from `parse-photo`. Port so parse quality (the make-or-break lever) is A/B-swappable against the bench-scan oracle. |
| Background removal → normalized cutout | **external (CutoutPort)** | Photoroom, called only from `parse-photo`. Distinct concern + vendor from attributes; the cutout is the asset a future try-on renderer consumes. |
| Wardrobe browse / filter (F4) | **Edge (`wardrobe`)** | Plain SELECT, but repos-only is locked. Keyset-paginated, server-clamped page size. RLS scopes to the caller. |
| Availability toggle clean/dirty/unavailable (F7) | **Edge (`wardrobe`)** | Single-column UPDATE; DB access is repos-only. RLS `WITH CHECK` confines it to the caller's row. |
| Dedupe compare: surface likely-duplicate pairs (F4) | **on-device** | O(n²) Hamming compare over the `phash` the client already holds — trivial to low thousands of items. No server pass, no dedupe table. |
| Dedupe resolution: keep-one (**merge**) / keep-both (no-op) | **Edge (`wardrobe`)** | Keep-one **merges** (re-points wear/outfit refs, then deletes the now-unreferenced item) — never a bare destructive delete of worn history. User-gated. |
| Manual outfit builder CRUD (F6) | **Edge (`outfits`)** | DB writes under repos-only; composite FKs make cross-user item refs unrepresentable. |
| Daily wear log — one-tap "I wore this" (F8) | **Edge (`wear-log`)** | Append INSERT; caller mints `client_id`, partial UNIQUE dedups retries. Optionally flips worn items to dirty. |
| Weather-aware suggestions (F5, heuristic v1) | **on-device** | Pure fn in `shared` over clean items + weather + F9 + palette. Zero server cost for 100k morning opens; works offline. |
| Color harmony rules (F9) | **on-device** | Pure deterministic rule table in `shared`, property-tested (fast-check). Advisory only. |
| Palette quiz scoring (B1) | **on-device** | Pure fn over self-identified swatch answers; advisory highlighting is a local read. |
| Palette result persist / read (B1) | **Edge (`palette`)** | UPSERT of the hue-set. Only the RESULT is persisted, decoupled from derivation. |
| Local weather fetch | **external (WeatherPort, on-device)** | Keyless Open-Meteo adapter called directly. No secret ⇒ no forced proxy function. |
| Entitlement read (UI gating) | **Edge (`palette`)** | SELECT own `subscriptions` row. Client can read status but has no write path to the money table. |
| RevenueCat purchase flow | **external** | RevenueCat client SDK. Deliberately NOT a port — entitlement is a first-class domain concept. |
| Purchase/renewal/expiry event → entitlement | **Edge (`revenuecat-webhook`)** | No user session; authenticates the SENDER by signature. SOLE writer of the money table via `service_role`. Built + committed; autonomy granted. |
| Per-user provider-spend throttle | **Edge (`parse-photo`) + Postgres** | Fixed-window counter in `rate_limit_counters` via a SECURITY **INVOKER** fn, so the INSERT policy's `WITH CHECK` enforces identity rather than trusting an argument. Sits after the entitlement gate and before the first write, so a 429 costs zero provider dollars and zero rows. |
| Per-user tenant isolation | **Postgres** | RLS FORCE + default-deny on every tenant table. |
| Cross-user Storage isolation | **Postgres** | Storage RLS binds the first path segment to the requester's `sub` on both buckets. |

---

## 3. Data model

All tenant tables: `RLS FORCE`, a single policy `USING (user_id = (select auth.uid())) WITH CHECK (same)`, no other policy ⇒ **default-deny**. `id uuid pk default gen_random_uuid()`, `created_at/updated_at timestamptz default now()` unless noted. Repos cast `timestamptz→::text`, `numeric→::float` in SELECT.

### `wardrobe_items`
| Column | Type / notes |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid not null |
| `category` | text not null, check in (`top`,`bottom`,`dress`,`outerwear`,`shoes`,`accessory`) |
| `color` | text |
| `pattern` | text |
| `attributes` | jsonb — secondary colors, material, formality; enrichment lands here, no migration |
| `availability` | text not null default `clean`, check in (`clean`,`dirty`,`unavailable`) |
| `cutout_path` | text — Storage path of the cutout |
| `parse_job_id` | uuid fk `parse_jobs` — provenance |
| `phash` | bigint — on-device dedupe signal |
- **Constraints:** `UNIQUE(user_id, id)` (the anchor for composite FKs below). Indexes: `(user_id, created_at, id)` keyset; `(user_id, availability)` partial WHERE `availability='clean'`; `(user_id, category)`.
- **Tenancy:** owned by `user_id`; created only by `parse-photo` as `app_user` (so `user_id = verified sub`) or mutated by the caller under RLS. One source photo yields 1..N items. No `service_role` write path.
- **Cut:** `source_photo_hash` is **not** duplicated here — it lives on `parse_jobs` (where the UNIQUE lives) and is reached via `parse_job_id`.
- **RLS intent:** caller sees/writes only own rows; default-deny for everyone else.

### `parse_jobs`
| Column | Type / notes |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid not null |
| `source_photo_hash` | text not null |
| `source_photo_path` | text not null |
| `kind` | text not null, check in (`teaser`,`full`) |
| `status` | text not null default `pending`, check in (`pending`,`processing`,`done`,`failed`) |
| `claimed_at` | timestamptz — **stale-claim lease** for crashed workers |
| `error_reason` | text — fixed string, no PII |
- **Constraints:** `UNIQUE(user_id, source_photo_hash)`. The idempotency key lives **here (per photo)**, never on `wardrobe_items` — one photo yields many garments; a UNIQUE on items would silently cap every photo at one garment.
- **Tenancy:** one row per submitted photo = the work unit AND the resumability seam (F3). Progress UI = client counts rows by status for the batch it submitted. No session table, no queue.
- **RLS intent:** caller reads/writes only own jobs; written by `parse-photo` as `app_user`.

### `outfits`
| Column | Type / notes |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid not null |
| `name` | text (nullable) |
- **Constraints:** `UNIQUE(user_id, id)` (composite-FK anchor).
- **Tenancy:** owned by `user_id`; first-class self-contained object (roadmap polls/try-on/events consume unchanged).
- **RLS intent:** caller only; default-deny.

### `outfit_items`
| Column | Type / notes |
|---|---|
| `id` | uuid pk |
| `outfit_id` | uuid not null |
| `user_id` | uuid not null — denormalized so RLS is a column check, not a join |
| `item_id` | uuid not null |
| `slot` | text |
| `position` | int |
- **Constraints:**
  - `FOREIGN KEY (user_id, outfit_id) REFERENCES outfits(user_id, id) ON DELETE CASCADE`
  - `FOREIGN KEY (user_id, item_id) REFERENCES wardrobe_items(user_id, id) ON DELETE CASCADE`
  - `UNIQUE(outfit_id, item_id)`; index on `(item_id)` (FK-child index for the merge/delete path).
- **Composite FKs make a cross-user reference *unrepresentable*:** you cannot insert `(user_id=me, item_id=<another user's item>)` because no `wardrobe_items(me, that_id)` row exists. Handler validation becomes a redundant fast-fail, not the sole control.
- **Cut:** no `item_ref_type` discriminator. A future catalog reference is an additive migration (`item_ref_type` + `catalog_item_id`, backfill `owned`) — not pre-built.
- **RLS intent:** caller only; default-deny.

### `wear_log` — the moat
| Column | Type / notes |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid not null |
| `item_id` | uuid not null |
| `outfit_id` | uuid (nullable) — groups an outfit-wear into per-item rows |
| `worn_at` | timestamptz not null default now() |
| `client_id` | text not null |
- **Constraints:**
  - `FOREIGN KEY (user_id, item_id) REFERENCES wardrobe_items(user_id, id)` **ON DELETE RESTRICT** — a worn item cannot be silently deleted (see merge rule, §7). Dedupe keep-one re-points these rows first.
  - `FOREIGN KEY (user_id, outfit_id) REFERENCES outfits(user_id, id) ON DELETE SET NULL`
  - partial `UNIQUE(user_id, client_id)` WHERE `client_id is not null`. Indexes: `(user_id, worn_at desc)`, `(item_id)`.
- **Tenancy:** one row per item wear (an outfit-wear expands to N rows sharing `outfit_id`+`worn_at`). Ships MVP, never cut, impossible to backfill.
- **RLS intent:** INSERT + SELECT policy only; **no UPDATE/DELETE policy** ⇒ append-only structurally. `client_id` minted at tap time; partial UNIQUE dedups retries.

### `palette_profile`
| Column | Type / notes |
|---|---|
| `user_id` | uuid pk (1:1) |
| `hues` | jsonb not null — the flattering-hue result |
- **Cut:** `undertone`, `contrast`, `quiz_version` — B1 consumes only the hue set; the result is decoupled from derivation by design. Add them as additive nullable columns if a feature reads them.
- **RLS intent:** upsert on conflict `(user_id)`; caller only; default-deny.

### `subscriptions` — money table
| Column | Type / notes |
|---|---|
| `user_id` | uuid pk |
| `rc_app_user_id` | text — event→user mapping |
| `entitlement_active` | boolean not null default false — the one fact the MVP reads |
| `event_ts` | timestamptz — last applied event time, for the **monotonic ordering guard** |
| `expires_at` | timestamptz |
| `updated_at` | timestamptz |
- **Cut:** `status`, `product_id`, `rc_original_txn_id` — a second representation of "is she entitled" invites drift on the money path; nothing in F1–F9/B1 reads them. Derive `status` from `entitlement_active`/`expires_at` if ever needed.
- **Tenancy:** one row per user. **Sole writer** = `revenuecat-webhook` via `service_role`.
- **RLS intent:** **SELECT policy `USING (user_id = auth.uid())` ONLY** — no insert/update/delete policy for `app_user`, so a client granting itself entitlement is structurally **unrepresentable**.

### `rate_limit_counters` — the per-user provider-spend throttle (added `0015`)

The 9th tenant table. It existed for a full wave before any data-model doc mentioned it — recorded here so the count and the inventory agree.

| Column | Type / notes |
|---|---|
| `user_id` | uuid not null |
| `scope` | text not null — which paid surface is throttled (e.g. `parse_full`). Part of the key so one endpoint exhausting its budget cannot starve an unrelated one, and two callers with different limits don't fight over one row |
| `window_start` | timestamptz not null default now() |
| `request_count` | integer not null default 0 |
| `updated_at` | timestamptz not null default now() |
- **Constraints:** `PRIMARY KEY (user_id, scope)` — the ON CONFLICT arbiter. No surrogate `id`.
- **Algorithm — FIXED WINDOW, and the doc says so because the code does.** One row per `(user_id, scope)`; a row whose `window_start` is older than the window resets to `now()` with count 1, otherwise it increments; admitted iff the **post-increment** count ≤ limit. It is **not** a token bucket and does not smooth a burst at a window edge (worst case 2× limit across the boundary) — a bounded 2× traded for one row and one statement. Swapping the body for a leaky bucket later touches no caller.
- **Race-freedom is the `0012` lesson applied:** check-and-increment is ONE `INSERT … ON CONFLICT (user_id, scope) DO UPDATE … RETURNING`. The broken pattern is reading a count in one snapshot and writing based on it — and a `pg_advisory_xact_lock` **cannot** rescue that, because the MVCC snapshot is fixed at statement start, *before* the lock is granted (that is exactly what blew the teaser cap at 12≠3). `ON CONFLICT` row-locks and applies the SET to the **latest** row version, so N racers serialize and their `RETURNING` values are 1..N with no duplicates.
- **`consume_rate_token` is SECURITY INVOKER, and that is the stronger choice, not the lazy one.** The INSERT policy's `WITH CHECK (auth.uid() = user_id)` rejects a mismatched `p_user_id` with `42501`, so **identity is enforced by RLS rather than trusted from an argument.** A DEFINER fn would run as the migration role, bypass RLS, and turn `p_user_id` into unverified input.
- **RLS intent:** SELECT/INSERT/UPDATE policies bound to `auth.uid()`; **no DELETE policy and no DELETE grant**, so a client cannot drop its own counter row to clear its spend window.
- **A refused call still increments** — that is what makes each `RETURNING` a unique ticket and the race provable.

### `webhook_events` — replay/ordering dedup (system)
| Column | Type / notes |
|---|---|
| `event_id` | text **pk** — RevenueCat event id |
| `received_at` | timestamptz not null default now() |
- **Why it exists (names what it replaces):** it replaces a racy `last_event_id` column on `subscriptions`. A read-then-write column check cannot dedup **concurrent** duplicate deliveries (TOCTOU). `INSERT ... ON CONFLICT (event_id) DO NOTHING` makes dedup **atomic** — if zero rows inserted, the event is a duplicate and is skipped before any entitlement write.
- **RLS intent:** no `app_user` policy at all; written/read only by `service_role`. Not tenant data.

---

## 4. Edge Functions (12 deployed — 11 user-JWT + 1 webhook)

**Every one of the 12 runs `verify_jwt = false`, and that is the deploy contract, not an oversight.** Auth is owned by the **handler** (`withAuth` → asymmetric JWKS via `jose`), because the Supabase gateway verifies **symmetrically** and would reject our valid asymmetric tokens. A route deployed with `verify_jwt=true` **401s every real request before the handler runs** — that is not hypothetical: three routes shipped unregistered in `config.toml` (so the gateway default applied) and `8183aa5` fixed a real day-1 outage of `account-delete`, `account-export`, and `palette-entitlement`. Preflight A.0 now fails if the stanza set and the shim dirs diverge.

The 11 user-JWT routes run as `app_user` under the caller's JWT (least privilege — a bug cannot write cross-user rows because RLS refuses them). The webhook is the only `service_role` writer.

Supabase's convention is **one directory = one function = one URL**, so each operation is its own flat route rather than a sub-path under a domain function:

| Route | Handler | Feature |
|---|---|---|
| `wardrobe-list` | `wardrobe/list#listWardrobe` | F4 browse/filter |
| `wardrobe-availability` | `wardrobe/availability#toggleAvailability` | F7 |
| `wardrobe-dedupe` | `wardrobe/dedupe#resolveDedupe` | F4 keep-one merge |
| `outfits-create` | `outfits/create#createOutfit` | F6 |
| `outfits-list` | `outfits/list#listOutfits` | F6 |
| `wear-log` | `wear-log/log-wear#logWear` | F8 |
| `palette-upsert` | `palette/upsert-palette#upsertPalette` | B1 |
| `palette-entitlement` | `palette/read-entitlement#readEntitlement` | F2 paywall read |
| `parse-photo` | `parse/parse-photo#parsePhoto` | F1/F3 |
| `account-export` | `account/export-data#exportData` | GDPR Art. 15 |
| `account-delete` | `account/delete-account#deleteAccount` | Apple 5.1.1(v) |
| `revenuecat-webhook` | `billing/revenuecat-webhook#revenueCatWebhook` | the money write (no JWT) |

**The client-callable surface is 11, not 12.** `packages/mobile/src/api/routes.ts` correctly omits `revenuecat-webhook` — it is server-to-server and has no client caller. That is a non-bug; do not "fix" it.

For the env var each route needs and what breaks if it is wrong, see **`docs/DEPLOY-RUNBOOK.md`** §"Route → env-var mapping" — it is derived from the shims themselves and is the single source for that table.

### `parse-photo` — the make-or-break endpoint
Invoked per approved photo with `{source_photo_hash, kind}`. Runs `AIVisionPort` (attributes) + `CutoutPort` (cutout), writes the cutout to Storage, inserts `wardrobe_item` rows + `phash`, advances `parse_jobs`.

- **`source_photo_path` is NOT a request field — this is a security boundary.** It was one, and that was the worst defect found in this project (fixed `44812c5`): a body-supplied path let user A name B's object and receive B's photo described back as garment attributes with the cutout persisted into A's wardrobe, and let any URL become an SSRF fetch on the vendor's servers at our expense. **The trap: Storage RLS does NOT cover this** — `0013` governs what `app_user` may touch inside Postgres, while the fetch happens on OpenAI's/Photoroom's servers from a URL we hand them. No DB policy can reach it. The fix is structural: the field is removed from `CreateParseJobRequest` (`.strict()` rejects it) and the key is **derived server-side** as `{user_id}/{hash}/original`, so naming another tenant's object is *unrepresentable*, not merely refused. Providers receive a short-lived signed URL minted under the **caller's own JWT** — never `service_role`, which would bypass the very control `0013` establishes and make a wrong path succeed silently. The minter re-checks the key against the caller's prefix and fails closed.
- **Why not client-direct:** holds the vision + cutout SECRETS; enforces the teaser cap, the entitlement gate, and the spend throttle server-side.
- **Concurrency — two transactions, not one.** You cannot wrap the ~2s provider HTTP calls in a DB transaction (one tx per `query()`; a held connection pins a pooled lock → pool exhaustion at scale). So:
  1. **Claim tx:** conditional `UPDATE parse_jobs SET status='processing', claimed_at=now()` with a **stale-claim lease** so a job abandoned by a dead isolate becomes re-claimable. Proceed only if rowcount = 1; a lost race returns "already in progress" and never reprocesses. **The lease predicate must admit a `processing` row** — it originally gated on `status IN ('pending','failed')` only, which made the lease dead code and **bricked any crashed photo permanently at 409** (fixed `44812c5`; no test had covered a `processing` row).
  2. Call providers.
  3. **Commit tx (one plpgsql fn):** delete partial items by `parse_job_id`, insert the new items, set `status='done'` — atomically. Retries never double-insert.
- **Gate order is load-bearing, and it is money order:** entitlement first (`kind=full` verifies `subscriptions.entitlement_active`, else 402), then the **spend throttle** (429), and only then `resolveJob` — the first statement that writes. So a 402 never burns budget and a 429 costs **zero provider dollars, zero teaser-cap slots, zero rows.** Verified by a provider-call counter asserting 0, not by the status code.
- **Teaser cap is a hard per-user guarantee** (`TEASER_JOB_CAP = 10`, `teaser-cap.ts:5`), not best-effort, because identity is established up front. It is enforced by migration `0012`'s plpgsql fn, **not** a single CTE: a `pg_advisory_xact_lock` inside a CTE serializes execution but **not** the READ COMMITTED snapshot, which is fixed at statement start *before* the lock is granted — that is precisely how 12 concurrent racers blew a cap of 3.
- **Backpressure:** per-call `AbortController` timeout, bounded retry on 429/5xx only with jittered backoff (`adapters/http.ts`), tunable via `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RETRIES`. Degraded path = reveal the items that succeeded, never a spinner or an error.
- **Status: wired, quality unmeasured.** The real adapters are bound in production (`parse-photo.ts:248` → `makeProviderPorts`). **No adapter has ever received a response from OpenAI or Photoroom** — the keys do not exist yet. So "parse fails closed" is proven; "parse works" is not.

### `wardrobe-list` / `wardrobe-availability` / `wardrobe-dedupe`
List/filter by category/color/availability (keyset-paginated, **server-clamped `limit ≤ 100`**); availability toggle (F7); dedupe keep-one **merge** (F4, see §7). Not client-direct only because repos-only is locked; RLS scopes every row.

### `outfits-create` / `outfits-list`
Outfit + `outfit_items` CRUD (F6). Composite FKs guarantee every referenced item/outfit belongs to the caller; `client_id`-idempotent (D-001).

### `wear-log`
Append per-item wear rows for an item or a saved outfit (F8); `client_id`-idempotent via the partial UNIQUE; optionally flips worn items to dirty. Append-only. **Response-idempotency subtlety:** on the ON-CONFLICT-no-row path the canonical row is re-read in a **fresh `query()`** (a new tx = a new snapshot that sees the committed winner). An in-statement fallback SELECT ran on the loser's pre-commit snapshot and threw → a spurious 500 under simultaneous duplicate taps. `DO UPDATE` was **not** viable: `app_user` has SELECT+INSERT only on the append-only moat (`0006`), no UPDATE grant.

### `palette-upsert` / `palette-entitlement`
`palette-upsert` UPSERTs `palette_profile` from the swatch quiz (B1). `palette-entitlement` serves the entitlement read the paywall gates on — **it deploys as its own route**, and it was one of the three that shipped unregistered in `config.toml` and would have 401'd, taking out the paywall for paying users.

### `account-export` / `account-delete` — the compliance pair (added `b389a64`)
Absent from earlier editions of this doc despite being launch blockers.

- **`account-delete`** — Apple Guideline **5.1.1(v)** makes in-app account deletion mandatory; without it submission is an automatic rejection. Backed by `0014`'s `public.delete_my_account()`, SECURITY DEFINER and **ZERO-ARG**: "A deletes B" is structurally unrepresentable because *no parameter exists to name another tenant*. Identity is read from `auth.uid()` inside the body (`RAISE 28000` on NULL) and every DELETE is independently filtered `WHERE user_id = v_uid`. `search_path = ''` (enforced by `check-definer-search-path`), `REVOKE PUBLIC` + `GRANT app_user`. **Purge order is load-bearing:** `wear_log` FIRST — its item FK is ON DELETE RESTRICT, the append-only moat guard, so any other order raises `23503` — then `outfit_items` → `outfits` → `wardrobe_items` → `parse_jobs` → `palette_profile` → `subscriptions`. A DEFINER fn is *required*: `app_user` has DELETE on `wardrobe_items` only, so an inline purge would `42501` on `wear_log` and silently no-op elsewhere. The handler takes a strict `{confirm:'DELETE'}` so a stray call cannot nuke an account.
  **KNOWN INCOMPLETE:** it erases every row pointing at a photo but **not the Storage bytes** (`originals`/`cutouts`) nor the `auth.users` identity record — both need service_role/admin API and are a deploy-wired step. Mechanically satisfies 5.1.1(v); **not yet a complete GDPR erasure.**
- **`account-export`** — GDPR Art. 15 / CCPA subject access. Reads all owned tables in **ONE statement** (a single MVCC snapshot, so a concurrent write cannot yield a document referencing an outfit whose items are missing), as plain `app_user` under RLS with **no** definer — RLS already scopes it, and that is the point. The outbound document is validated through a schema composed from the frozen `@closet/shared` row schemas.

### `revenuecat-webhook` — self-authed signature, no user JWT
Maps purchase/renewal/expiry events to `subscriptions.entitlement_active`. SOLE writer of the money table via `service_role`. **Built, verified, and committed** — autonomy granted 2026-08-06; it is not parked.
- **Order of operations:** (1) **verify the shared secret in constant time FIRST**, before any branch; (2) `INSERT INTO webhook_events(event_id) ON CONFLICT DO NOTHING` — zero rows means a replay: return 200 and stop (atomic dedup, no TOCTOU); (3) apply to `subscriptions` with a **monotonic guard** on `event_ts`, so a late-arriving expiry cannot revoke a user superseded by a newer renewal. The **real event `ts`** is passed, not `now()` — using `now()` makes the guard useless and a stale expiry revokes a paying customer (that mutant is a committed red-first demo). Poison-pill handling landed as `0016`.
- **Structural guarantee (VERIFIED):** an `app_user` token calling the write path is refused `42501` — a client literally cannot mint entitlement.
- **Still unproven (ASSERTED-NOT-EXERCISED):** no real RevenueCat delivery has ever hit this. The committed fixture is a real captured v1 payload *shape*, which beats an invented one, but signature-as-RC-signs-it, retry semantics, and real ordering are untested. `CLAUDE.md`'s money rule is explicit that a self-mocked success is a mirror oracle.
- **The day-1 trap:** this writes under `makeServiceExecutor` over `SUPABASE_DB_SERVICE_URL`. If that pool connects as anything but a real `service_role`, the write hits RLS and raises `42501` — the exact refusal the tests prove for `app_user` — so a valid purchase 500s, entitlement never flips, and **the paying customer stays locked out.** Preflight A.1 is the check for it, and it has never executed.

---

## 5. Ports (in `packages/shared`)

- **`AIVisionPort`** (GPT-4o) — garment ATTRIBUTE extraction; called only from `parse-photo`. A port because parse quality is the make-or-break lever and must be A/B-swappable against the bench-scan oracle without touching callers. Only Zod-validated attributes cross the boundary.
- **`CutoutPort`** (Photoroom) — background removal → normalized front-view cutout; called only from `parse-photo`. Distinct concern + vendor from attributes (remove.bg is a drop-in; SAM avoided — implies self-hosted infra). The cutout is the exact asset a future try-on renderer consumes.
- **`WeatherPort`** (Open-Meteo, runs **on-device**) — local weather for the heuristic. KEYLESS in MVP ⇒ no proxy Edge Function is forced. Only normalized weather crosses the boundary. Degraded path: suggestions run without weather bias, never a broken screen. **Status: the interface exists in `shared` and has no mobile adapter or caller** (`git grep -i weather -- packages/mobile` → 0 hits), so F5 is not actually weather-aware yet.
- **`AuthPort`** (Supabase Auth, runs **on-device**) — `packages/mobile/src/session/AuthPort.ts`, adapter `supabaseAuthPort.ts`. **A fourth port, and it deliberately lives in `packages/mobile`, not `packages/shared`**, because it is device-only: nothing server-side has a session to abstract. Two non-obvious invariants belong with it and are stated in `src/App.tsx:6-10`: (a) **`SessionProvider` MUST sit above `ApiProvider`** — the client's `TokenSource` reads through the port, and the gate below it guarantees no screen mounts (so no endpoint is called) before a session exists; (b) the bearer is **re-read per request** rather than captured once, so a token rotated by `autoRefreshToken` reaches every call instead of a stale one. **Status: sign-in cannot complete as shipped** — `makeSupabaseAuthPort()` is constructed with no credential providers, so both buttons throw `provider_unavailable`; it needs `expo-apple-authentication` / a Google provider installed by a human.
- **The 3 provider adapters** (`packages/functions/src/adapters/`) are the concrete implementations of `AIVisionPort` + `CutoutPort` plus a Storage reader/writer, over an injectable `FetchFn` in `http.ts` (timeout via `AbortController`, retry on 429/5xx only, jittered backoff). Tunables: `PROVIDER_TIMEOUT_MS`, `PROVIDER_MAX_RETRIES`, `OPENAI_BASE_URL`, `OPENAI_VISION_MODEL`, `PHOTOROOM_BASE_URL`. Keys via `requireEnv`, never in a URL or a log. **The cutout writer uploads under the CALLER'S OWN token, deliberately not `service_role`** — a bypassing key would make a wrong path *succeed*, silently voiding the only cross-user control on photo bytes; under the user's token a path-composition bug fails closed. (An earlier revision composed `{job_id}/{user_id}/` — segment 1 the job, not the owner — which `0013` refuses; it was caught only because the test asserts against hand-written literals rather than recomputing the path from the helper.)
- **RevenueCat is deliberately NOT a port** — entitlement is a first-class domain concept, not a swappable vendor detail; abstracting it would hide the money boundary.
- **Supabase Auth/Storage/Postgres is deliberately NOT a port** — it is the sovereign runtime, not a swappable boundary; abstracting it would dilute the RLS-FORCE guarantee.
- **No `NotificationPort`** — no MVP feature needs push; its future addition is purely additive, so declaring an unused interface now buys nothing.

---

## 6. Storage / bucket security

Two **private** buckets: `originals` (approved uploads) and `cutouts` (parse output). Both keyed by first path segment = owner: `{user_id}/{parse_job_id}/{...}`.

- **Storage RLS on `storage.objects`** is the ONLY control preventing cross-user byte reads/writes. The policy must:
  - compare `(storage.foldername(name))[1] = auth.uid()::text` — `auth.uid()` is `uuid`, `foldername()` returns `text`, so the explicit `::text` cast is mandatory or the comparison misbehaves;
  - include a `bucket_id` predicate so a policy for one bucket cannot apply to the other;
  - cover **both** read and write on **both** buckets.
- **Proof (not by construction):** a Storage-RLS-specific integration test that `SET LOCAL ROLE app_user` and asserts user A gets **0 rows** for user B's prefix on both buckets, for read AND write. Mutation-test the folder-index literal. Do not rely on any table-RLS test to cover this. Path obscurity is never the control.
- **Bytes never transit Edge:** upload and cutout-download are client-direct under these policies; `parse-photo` reads the original and writes the cutout as `app_user`, still bound by the same policies.

**Status (`0013_storage_rls.sql`, landed `7d1c3e3`):** all 8 policies are authored (select/insert/update/delete × `originals` × `cutouts`), and `packages/db/test/storage-rls.integration.test.ts` exercises them in 6 tests — including a **mutation probe proving the folder-index literal `[1]` is load-bearing** (`[2]` leaks across users), a `bucket_id`-predicate check, and a real up→down→up redo.

**But grade it honestly: ASSERTED-NOT-EXERCISED against real Supabase Storage.** The migration is dual-target — on hosted Supabase the `storage` schema is platform-owned and the bootstrap block is a no-op, while on a bare `postgres:17` container it **fabricates a faithful stand-in** (buckets + objects + `foldername()`, with RLS FORCE) so the *same policy text* is genuinely enforced. That is real coverage of the policy's semantics, and it is **not** coverage of hosted `storage.objects`, which has never seen these policies. Preflight B.1 is the check that would prove it — graded by asking the **prefix owner** whether bytes landed, so the response is never the oracle — and it has never executed.

**Two adjacent warnings worth keeping:**
- **`0013`'s DOWN was rewritten before it landed.** As first authored it ran `DROP SCHEMA storage CASCADE` + `DROP ROLE authenticated`, guarded only by an ownership check — on a real Supabase project one mis-evaluation destroys **every user's photo bytes.** It now uses explicit named drops, no CASCADE, and a **second independent discriminator** (Supabase's real `storage.objects` has a `path_tokens` column the test stand-in never creates) so ownership is not trusted alone.
- **Storage RLS does NOT protect the provider fetch.** It governs Postgres access; the vision/cutout providers fetch a URL *we hand them* from *their* servers. That gap was a live cross-tenant read + SSRF (§4 `parse-photo`) and is closed by deriving the key server-side, not by any policy here.

---

## 7. Migration & idempotency rules

- **node-pg-migrate**, numbered, real UP + round-trip-tested DOWN. Additive changes (new nullable column/table) are agent-autonomous under monitoring. **Destructive DDL (DROP/TRUNCATE/narrowing) is an escalation trigger** — numbered migration + human approval token in `packages/db/migrations/approvals/`; expand/contract for live data. The `db-guard` hook blocks ad-hoc shell DROPs.
- **Parse idempotency/resumability:** `parse_jobs UNIQUE(user_id, source_photo_hash)` prevents duplicate job rows; the **atomic claim** (§4) prevents two workers acting on one row; the single-statement **commit fn** (delete-partial-by-`parse_job_id` + insert + mark done) prevents double-inserted garments. The idempotency key is on the *photo*, never on items.
- **Dedupe keep-one is a MERGE, not a hard delete (decided now):** re-point `wear_log.item_id` and `outfit_items.item_id` from the discarded item to the kept item, then delete the now-unreferenced item in one plpgsql fn. `wear_log`'s FK is `ON DELETE RESTRICT`, so the moat cannot be silently cascaded away and the append-only claim stays honest. Keep-both is always a no-op. Both `wear_log(item_id)` and `outfit_items(item_id)` are indexed so this and the FK checks don't seq-scan the ~180M-row moat table.
- **`client_id`** is minted by the caller at tap time (never inside `mutationFn`); partial UNIQUE dedups retries.

---

## 8. Escalation triggers — what stays human-gated

1. **The money/entitlement path — NO LONGER PARKED. `CLAUDE.md` granted full build/verify/commit/merge autonomy on 2026-08-06, and this path is built and committed** (`fb60f22`, hardened by `0016`). This entry previously said "parked for human review before ship (Rule 6)", which was true when written and has been false since. Signature-checked before any branch, atomic dedup via `webhook_events`, monotonic `event_ts` guard, and mutation-tested (the entitlement-comparison flip and the constant-time-compare flip were both re-derived from main and both go red). **What remains human-gated on money is only:** (a) verification against a **real RevenueCat delivery** — the autonomy grant is permission to ship, explicitly *not* permission to lower the oracle bar, and a self-mocked success is a mirror oracle; (b) the price and store-product configuration, which is an owner decision and currently blocks the paywall (it displays **no price** — an App Store 3.1.2 rejection). If out-of-order arrival proves real beyond the `event_ts` guard, extend `webhook_events` with per-user ordering.
2. **Destructive migrations** — any DROP/TRUNCATE/narrowing: numbered migration + human approval token; real round-trip DOWN. **Note: `packages/db/migrations/approvals/` does not exist on disk** — the mechanism is declared in `conventions.json`/CODEOWNERS and has never been exercised, because no destructive migration has been needed. `0013`'s originally-authored `DROP SCHEMA storage CASCADE` DOWN is the closest call so far (§6) and was rewritten rather than approved.
3. **The privacy gate quality** — the structural guarantee is "no upload without an explicit tap"; what a photo *appears as an approvable candidate* rests on an on-device classifier with **no server backstop by design**. A false negative uploads an intimate photo. Grade **recall against an independent labeled corpus** (bench-scan style), never self-report; hard-block NSFW/intimate; "not her" is best-effort. Treat recall as a make-or-break safety metric with a real number.
4. **RESOLVED — no anonymous session.** Identity is established up front via one-tap Sign in with Apple / Google before the teaser parse (decision 2026-08-06). This *removes* the former anon→permanent cross-system temporal boundary: teaser rows are written under the real `user_id` from the start, so nothing orphans and nothing re-parses. The "sole `service_role` writer = webhook" claim holds unqualified. (Kept in the list as a resolved note so the reasoning is traceable.)
5. **Storage RLS policy text** — the single control for cross-user bytes. Now authored (`0013`) and exercised against a container stand-in, **never against real Supabase Storage** (§6). Preflight B.1 is the confirming check and has not run.
6. **Any value that names a tenant-scoped object.** Added after `44812c5`, because the existing rules did not catch it: `source_photo_path` came in through the request body and was handed to third-party servers as a URL to fetch, while every DB call correctly used the verified `sub` — so the code *looked* compliant. The rule generalizes: **an identity-scoped value must be DERIVED from the verified `sub`, never accepted, and a boundary that leaves our runtime (a URL a vendor fetches) is outside every DB policy's reach.**

---

## 9. Deliberately NOT built

- **`get-weather` / weather-proxy function** — Open-Meteo is keyless; the on-device adapter calls it directly. Add a thin proxy only if we adopt a keyed provider.
- **`dedupe_candidates` table + server-side dedupe pass** — one `phash` column per item; on-device Hamming compare surfaces pairs, the merge resolves via `wardrobe`. One column beats a table + a server pass.
- **Suggestions / harmony / palette-scoring server endpoints** — all pure fns in `shared`, on-device over the user's own data. Zero server cost for the daily loop at 100k users; the biggest simplicity+scale win.
- **Parse worker queue / `parse_tasks` / pg-boss / event bus / pg_cron drain** — full parse is device-driven idempotent Edge invocations; `parse_jobs` + the atomic claim give resumability with zero extra infra. `pg_cron` over `parse_jobs` is the named escalation lever *only* if fan-out ever bends.
- **Separate teaser-parse and full-parse functions** — one `parse-photo` parameterized by `kind`.
- **Client-direct-to-Supabase TABLE access** — rejected; violates repos-only. Client-direct is used only for Storage bytes.
- **`outfit_items.item_ref_type` discriminator** — a single-value CHECK enables nothing in MVP; the catalog seam is a cheap additive migration later.
- **`subscriptions.status` / `product_id` / `rc_original_txn_id`** — redundant/unread on the money path.
- **`NotificationPort` + push wiring + scheduler** — no MVP feature needs push.
- **Original-photo deletion after parse** — deletion is irreversible and forecloses cheap re-parse / provider-swap; originals are retained in the user's own RLS-scoped bucket (privacy already guaranteed by the on-device gate). A lifecycle rule is a purely additive change if storage cost bends.
- **catalog / gap-fill / affiliate, share-grant / visibility / social / poll / event, analytics read-models, server-side body twin / try-on storage, fit-ledger columns** — RLS default-deny and the first-class outfit/cutout objects are the seams; each future feature is an additive change, never a reshape or a loosened default.
- **Free-trial / promo / grace-period logic** — hard paywall only; every extra money-path state is attack surface.
- **`audit_logs` / `healthz` / `readyz`** — ops surface, added at deploy time, not MVP data proof.

**Scale levers deferred with a note:** `wear_log` monthly range-partition + BRIN only past ~100M rows; swap `AIVisionPort` to a cheaper model behind the port if provider cost bends; per-user Storage lifecycle deletion of originals if object count bends. None are pre-built.