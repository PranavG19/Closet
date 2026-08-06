# closet-app — Backend Design

## 1. The spine, in one paragraph

**Identity is established up front, before the teaser parse** — one-tap Sign in with Apple / Google (no anonymous session). This is the genre norm for hard-paywall apps and it is a net *simplification*: there is no anonymous→permanent account link (so no `sub`-preservation risk, no orphaned teaser rows, no double-parse), and the teaser item cap becomes a real per-user server guarantee rather than best-effort. The only cost is one tap before the scan; account creation before payment also seeds commitment. Payment still comes only at the hard paywall after the reveal.

The daily loop runs **on-device**: the privacy gate, hashing, dedupe compare, color harmony (F9), the suggestion heuristic (F5), and palette scoring (B1) are all pure functions over the user's own data, so 100k users cost zero server compute for the morning question and need zero endpoints. The **remote side is deliberately small**: **8 tables**, all `RLS FORCE` default-deny keyed on the verified JWT `sub`; **6 Edge Functions**, five under the caller's user-JWT (running as `app_user`, never `service_role`) and one self-authed webhook that is the *sole* writer of the money table. **Client-direct-to-Supabase is used only for Storage bytes** (upload originals, download cutouts) under Storage RLS — never for table access, because repos-only is a locked invariant (`supabase.from()` is lint-banned in mobile/functions). Paid providers (GPT-4o attributes, Photoroom cutout) sit behind ports and are called **only** from `parse-photo`, which holds their secrets, enforces the teaser cap and the entitlement gate server-side, and is made idempotent/resumable by an **atomic job-claim on `parse_jobs`** plus `UNIQUE(user_id, source_photo_hash)`. No queue, no worker, no scheduler, no event bus. Weather is a keyless provider (Open-Meteo) called from an on-device adapter, so no proxy function exists. The money/entitlement path is built and verified but **human-gated** before ship.

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
| Purchase/renewal/expiry event → entitlement | **Edge (`revenuecat-webhook`)** | No user session; authenticates the SENDER by signature (`verify_jwt=false`). SOLE writer of the money table via `service_role`. HUMAN-GATED. |
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

### `subscriptions` — money table (HUMAN-GATED)
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

### `webhook_events` — replay/ordering dedup (system)
| Column | Type / notes |
|---|---|
| `event_id` | text **pk** — RevenueCat event id |
| `received_at` | timestamptz not null default now() |
- **Why it exists (names what it replaces):** it replaces a racy `last_event_id` column on `subscriptions`. A read-then-write column check cannot dedup **concurrent** duplicate deliveries (TOCTOU). `INSERT ... ON CONFLICT (event_id) DO NOTHING` makes dedup **atomic** — if zero rows inserted, the event is a duplicate and is skipped before any entitlement write.
- **RLS intent:** no `app_user` policy at all; written/read only by `service_role`. Not tenant data.

---

## 4. Edge Functions (6)

Five run `verify_jwt=true` as `app_user` under the caller's JWT (least privilege — a bug cannot write cross-user rows because RLS refuses them). The webhook is the only `service_role` writer.

### `parse-photo` — user-jwt · the make-or-break endpoint
Invoked per approved photo with `{source_photo_path, source_photo_hash, kind}`. Runs `AIVisionPort` (attributes) + `CutoutPort` (cutout), writes the cutout to Storage, inserts `wardrobe_item` rows + `phash`, advances `parse_jobs`.
- **Why not client-direct:** holds the vision + cutout SECRETS; enforces the teaser cap and the entitlement gate server-side.
- **Concurrency (decided now — two transactions, not one):** you cannot wrap the ~2s provider HTTP calls in a DB transaction (one tx per `query()` call; a held connection pins a pooled lock → pool exhaustion at scale). So:
  1. **Claim tx:** `UPDATE parse_jobs SET status='processing', claimed_at=now() WHERE id=? AND status IN ('pending','failed') AND (claimed_at IS NULL OR claimed_at < now() - interval '2 min')`. Proceed **only if rowcount = 1**; a lost race returns "already in progress" and never reprocesses. `claimed_at` is the crash lease.
  2. Call providers.
  3. **Commit tx (one plpgsql fn):** delete any partial items by `parse_job_id`, insert the new items, set `status='done'` — atomically. A prior failed job's partial items are cleaned before reprocess, so retries never double-insert.
- **Teaser gate + cost abuse (money-path — §8):** `kind=full` first verifies `subscriptions.entitlement_active` and 402s otherwise. `kind=teaser` does not check entitlement (that is its point) but — because identity is established up front — it runs under a **real authenticated `user_id`**, so the per-user teaser cap is a **hard server guarantee** (an atomic counter on `parse_jobs` WHERE `kind='teaser'`, mutation-tested), not best-effort. Still add an **edge rate-limit** (per-`user_id` token bucket) as defense against a single account hammering the paid providers.
- **Teaser backpressure (decided now):** bounded per-provider concurrency limiter in the adapter + retry-with-jittered-backoff + strict per-call timeout; degraded path = reveal the items that succeeded, never a spinner or error.

### `wardrobe` — user-jwt
List/filter items by category/color/availability (keyset-paginated, **server-clamped `limit ≤ 100`**); availability toggle (F7); dedupe keep-one **merge** resolution (F4, see §7). Not client-direct only because repos-only is locked; RLS scopes every row.

### `outfits` — user-jwt
Outfit + `outfit_items` CRUD (F6). Composite FKs guarantee every referenced item/outfit belongs to the caller; `client_id`-idempotent. Endpoint solely because DB access is repos-only.

### `wear-log` — user-jwt
Append per-item wear rows for an item or a saved outfit (F8); `client_id`-idempotent (partial UNIQUE); optionally flips worn items to dirty. Append-only.

### `palette` — user-jwt
UPSERT `palette_profile` from the swatch quiz (B1); also serves the entitlement read for UI gating.

### `revenuecat-webhook` — self-authed signature (`verify_jwt=false`) · HUMAN-GATED
Maps purchase/renewal/expiry events to `subscriptions.entitlement_active`. SOLE writer of the money table via `service_role`.
- **Order of operations (decided now):** (1) **verify the RevenueCat signature FIRST**, before any branch; (2) `INSERT INTO webhook_events(event_id) ON CONFLICT DO NOTHING` — if zero rows, it's a replay, return 200 and stop (atomic dedup); (3) upsert `subscriptions` with a **monotonic guard** `WHERE excluded.event_ts >= subscriptions.event_ts`, so a late-arriving expiry cannot revoke a paying user superseded by a newer renewal.
- **Why not user-jwt / client-direct:** it has no user session and authenticates the sender by signature.

---

## 5. Ports (in `packages/shared`)

- **`AIVisionPort`** (GPT-4o) — garment ATTRIBUTE extraction; called only from `parse-photo`. A port because parse quality is the make-or-break lever and must be A/B-swappable against the bench-scan oracle without touching callers. Only Zod-validated attributes cross the boundary.
- **`CutoutPort`** (Photoroom) — background removal → normalized front-view cutout; called only from `parse-photo`. Distinct concern + vendor from attributes (remove.bg is a drop-in; SAM avoided — implies self-hosted infra). The cutout is the exact asset a future try-on renderer consumes.
- **`WeatherPort`** (Open-Meteo, runs **on-device**) — local weather for the heuristic. KEYLESS in MVP ⇒ no proxy Edge Function is forced. Only normalized weather crosses the boundary. Degraded path: suggestions run without weather bias, never a broken screen.
- **RevenueCat is deliberately NOT a port** — entitlement is a first-class domain concept, not a swappable vendor detail; abstracting it would hide the human-gated money boundary.
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

---

## 7. Migration & idempotency rules

- **node-pg-migrate**, numbered, real UP + round-trip-tested DOWN. Additive changes (new nullable column/table) are agent-autonomous under monitoring. **Destructive DDL (DROP/TRUNCATE/narrowing) is an escalation trigger** — numbered migration + human approval token in `packages/db/migrations/approvals/`; expand/contract for live data. The `db-guard` hook blocks ad-hoc shell DROPs.
- **Parse idempotency/resumability:** `parse_jobs UNIQUE(user_id, source_photo_hash)` prevents duplicate job rows; the **atomic claim** (§4) prevents two workers acting on one row; the single-statement **commit fn** (delete-partial-by-`parse_job_id` + insert + mark done) prevents double-inserted garments. The idempotency key is on the *photo*, never on items.
- **Dedupe keep-one is a MERGE, not a hard delete (decided now):** re-point `wear_log.item_id` and `outfit_items.item_id` from the discarded item to the kept item, then delete the now-unreferenced item in one plpgsql fn. `wear_log`'s FK is `ON DELETE RESTRICT`, so the moat cannot be silently cascaded away and the append-only claim stays honest. Keep-both is always a no-op. Both `wear_log(item_id)` and `outfit_items(item_id)` are indexed so this and the FK checks don't seq-scan the ~180M-row moat table.
- **`client_id`** is minted by the caller at tap time (never inside `mutationFn`); partial UNIQUE dedups retries.

---

## 8. Escalation triggers — what stays human-gated

1. **The money/entitlement path** (`revenuecat-webhook` + the full-parse entitlement gate inside `parse-photo` + the teaser cost cap). Sole writer of `subscriptions`. Verified against a **real RevenueCat event** (a self-mocked success is a mirror oracle), signature-checked before any branch, atomic dedup via `webhook_events`, monotonic ordering guard, mutation-tested. If out-of-order arrival proves real beyond the `event_ts` guard, extend `webhook_events` with per-user ordering. Built and verified, **parked for human review before ship** (Rule 6). The full-parse gate is app-layer (a cost leak if buggy, not a data leak — RLS still scopes rows) and needs a surviving-mutant-free test on the entitlement branch.
2. **Destructive migrations** — any DROP/TRUNCATE/narrowing: numbered migration + human approval token; real round-trip DOWN.
3. **The privacy gate quality** — the structural guarantee is "no upload without an explicit tap"; what a photo *appears as an approvable candidate* rests on an on-device classifier with **no server backstop by design**. A false negative uploads an intimate photo. Grade **recall against an independent labeled corpus** (bench-scan style), never self-report; hard-block NSFW/intimate; "not her" is best-effort. Treat recall as a make-or-break safety metric with a real number.
4. **RESOLVED — no anonymous session.** Identity is established up front via one-tap Sign in with Apple / Google before the teaser parse (decision 2026-08-06). This *removes* the former anon→permanent cross-system temporal boundary: teaser rows are written under the real `user_id` from the start, so nothing orphans and nothing re-parses. The "sole `service_role` writer = webhook" claim holds unqualified. (Kept in the list as a resolved note so the reasoning is traceable.)
5. **Storage RLS policy text** — the single control for cross-user bytes; proven only by the dedicated integration test above.

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