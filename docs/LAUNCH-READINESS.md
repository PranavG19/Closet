# LAUNCH-READINESS — pre-launch audit

> ⚠️ **STALE AS OF 2026-08-12 — this edition is pinned at HEAD `ab25513` (2026-08-08); the tree
> has moved many commits since (F1 onboarding, F4/F5/F6/F7 UI, the design-system redesign, and
> screen re-lays all landed after this audit). Per this file's own rule — "re-run the command; do
> not trust the number" — the following headline claims are now KNOWN-STALE and must NOT be relied
> on until this audit is re-derived from the current HEAD:**
> - **§1/§4 "F1 ABSENT — no onboarding dir, no on-device privacy gate in any form."** FALSE now:
>   `packages/mobile/features/onboarding/` exists (`AddGarmentScreen`, `intake.ts`, `stage.ts`),
>   and the privacy chokepoint + `ApprovedPhoto` brand + upload seam are in `packages/mobile/src/photo/`
>   (`chokepoint.ts`, `useAddGarment.ts`, `uploadApproved.ts`). The scan→approve→upload path is
>   wired (the NATIVE photo picker is still unbound — the port reports `available:false` — so the
>   flow is code-complete but not runnable on a device build; that narrower claim is what's true).
> - The "5 dead mutation hooks" count and the per-feature "mutation wired: no" verdicts predate the
>   F4/F5/F6/F7 UI work — re-derive `git grep` before quoting them.
> - What has NOT changed and remains accurate: **nothing is deployed** (no Supabase project, no
>   provider/RevenueCat keys), so every backend guarantee is still testcontainer-proven only, and
>   real-webhook / real-provider / real-Storage-RLS external oracles have still never run. The
>   launch-blocking verdict ("not launch-ready: nothing is deployed") still holds; it is the
>   *feature-absence* findings that have gone stale, not the deployment blocker.
>
> *Full re-derivation is a larger task; this banner exists so the stale feature-absence claims stop
> reading as current. The grading legend and the deployment/oracle findings below remain valid.*

*Adversarial, re-derived-from-the-tree audit. **Not** a status report — a stop-check against a false "we're ready." Re-derived at **HEAD `ab25513` (2026-08-08)**; the previous edition (2026-08-07, at `ac46ac0`) had gone stale in 5 of its 6 §6 findings within a day, so **every count below carries the command that produces it.* Re-run the command; do not trust the number.

**How to read a claim in this file.** Three grades, used literally:
- **VERIFIED** — a command in this file reproduces it, right now, in this repo.
- **ASSERTED-NOT-EXERCISED** — the code/policy exists and is authored correctly, but the *confirming vantage* (a real deployed Supabase project, a real RevenueCat delivery, a real provider response) has never been reached. Not a proof.
- **ABSENT** — re-derived as not existing.

---

## 1. Executive verdict

**Still NOT launch-ready — but the failure mode has changed, and the previous verdict ("there is no product") is now false.**

What changed since 2026-08-07: the real provider adapters landed (`7d1c3e3`), so `parse-photo` is no longer hard-wired to a 502; Storage RLS landed as a real migration with a real exercising test (`0013`); account deletion + data export landed (`0014`); the day-1 cost-abuse hole was closed by a per-user spend throttle (`0015`); three genuinely serious security defects were found and fixed (`44812c5`, including a cross-tenant photo read + SSRF on the parse path); and — the single largest change in what is *knowable* — **the Expo app now boots and renders, and 17 simulator screenshots are committed as evidence (`ab25513`).** Visual output is no longer unobservable. It is observed, and it has defects (§3).

What has NOT changed, and is what actually blocks launch:

1. **Nothing is deployed.** No Supabase project, no secrets, no provider keys. Every backend guarantee below is proven against a testcontainer, never against the runtime that ships.
2. **The app cannot take money — but the reason has changed from "unbuilt" to "unconfigured".** The purchase path now exists end to end: a `BillingPort` in `@closet/shared`, the store-read localised price, the §7-required disclosure text as a tested pure function, a real purchase call, and a Restore Purchases control. The dead `onPress={() => {}}` and the missing price are gone. **What is still missing is entirely the owner's:** `react-native-purchases` is not installed and cannot be configured without RevenueCat API keys and real App Store / Play product IDs, so `src/billing/revenueCatNative.ts` returns a port with no offer and the paywall renders an honest "Membership isn't available right now" with **no button and no price** (never a blank price, which is the 3.1.2 failure). The remaining work is mechanical once keys exist — the 20 adapter unit tests already pin every SDK mapping — and the oracle for "done" is unchanged: **a real RevenueCat webhook event flipping `entitlement_active`, never a mocked success.**
3. **The product's conversion engine does not exist as a UI.** There is no `features/onboarding/` directory, no photo-picker, and **no on-device privacy gate in any form** — the app's defining constraint (`CLAUDE.md` "the privacy invariant") is unimplemented. `useParsePhoto()` exists and is called by zero screens.
4. **The product has no name.** `[App Name]` is a live token in 9 content files.

The honest shape of it: the *backend* is genuinely built and genuinely hard-verified against real Postgres. The *frontend* now demonstrably renders, which is new and real. But the **two revenue-critical paths — F1's scan→reveal and F2's purchase — are both absent**, so there is still no path from "a woman installs this" to "she pays."

---

## 2. What is BUILT + VERIFIED

Every count here is followed by the command that re-derives it.

### Migrations — **16**

```
ls packages/db/migrations/ | wc -l          # → 16
ls packages/db/migrations/                  # → 0001_substrate.sql … 0016_apply_webhook_event_fn.sql, no gaps
```

`0001` substrate · `0002` wardrobe_items · `0003` parse_jobs · `0004` outfits · `0005` outfit_items · `0006` wear_log · `0007` palette_profile · `0008` subscriptions · `0009` webhook_events · `0010` wardrobe_delete · `0011` dedupe_merge_fn · `0012` resolve_teaser_job_fn · `0013` storage_rls · `0014` delete_account_fn · `0015` rate_limit_counters · `0016` apply_webhook_event_fn.

### Tenant tables under RLS FORCE — **9**

```
node scripts/gates/check-rls.mjs
# → check-rls: clean — all 9 public data table(s) are RLS FORCE
```

The 9th is `rate_limit_counters` (`0015`), which no data-model doc described until this pass — see `docs/06` §3.

### Repos — **11** (the only DB-access seam)

```
ls packages/db/src/repos/                   # 12 files = 11 repos + index.ts
```
`account` · `export` · `outfit-items` · `outfits` · `palette` · `parse-jobs` · `rate-limit` · `subscriptions` · `wardrobe` · `wear-log` · `webhook-events`.

### Edge routes — **12 deployed, 11 client-callable**

```
ls -d supabase/functions/*/ | wc -l          # → 13 dirs, one of which is _shared → 12 routes
grep -c '^\[functions' supabase/config.toml  # → 12
grep -c 'verify_jwt = false' supabase/config.toml  # → 13 (12 stanzas + the header comment)
```

**The reconciliation that is a non-bug, stated here so nobody "fixes" it:** `packages/mobile/src/api/routes.ts` has **11** entries, not 12. The missing one is `revenuecat-webhook`, which is server-to-server and has no client caller — its absence from `routes.ts` is correct. So: **12 deployed = 11 user-JWT routes + 1 webhook**, and **11 client-callable**.

**Every one of the 12 runs `verify_jwt = false`.** This is deliberate and is the deploy contract: auth is owned by the handler (`withAuth` → asymmetric JWKS via `jose`), because the Supabase gateway verifies *symmetrically* and would reject our valid asymmetric tokens. Any doc that says `verify_jwt=true` is describing a configuration that would 401 every real request.

The 11 user-JWT routes: `wardrobe-list`, `wardrobe-availability`, `wardrobe-dedupe`, `outfits-create`, `outfits-list`, `wear-log`, `palette-upsert`, `palette-entitlement`, `parse-photo`, `account-export`, `account-delete`. The canonical route table — the only one in the repo that has never been wrong — is `docs/DEPLOY-RUNBOOK.md` §"Route → env-var mapping". **Cite that one; do not restate the list.**

### Provider adapters — REAL, bound in production (was 502-stubbed until `7d1c3e3`)

```
ls packages/functions/src/adapters/
# → http.ts index.ts openai-vision.adapter.ts photoroom-cutout.adapter.ts
#   supabase-storage.reader.ts supabase-storage.writer.ts + 4 .test.ts
git grep -n unwiredPorts -- packages       # → 0 hits. The stub is GONE.
```
`parse-photo.ts:248` reads `export const parsePhoto: AuthedHandler = makeParsePhoto(makeProviderPorts, dbSpendLimiter);` — the real ports, with timeout / retry / bounded backoff in `http.ts`.

**Grade: the wiring is VERIFIED; the output quality is ASSERTED-NOT-EXERCISED.** No adapter has ever received a response from OpenAI or Photoroom — `OPENAI_API_KEY` and `PHOTOROOM_API_KEY` are unset (no key exists to set). The adapter unit tests drive fake `FetchFn`s. The bench-scan replay tier scores a *pinned corpus*, not live provider output. **So "parse works" is unproven; "parse is wired and fails closed" is proven.**

### Storage RLS — landed as `0013`, and genuinely exercised

`0013_storage_rls.sql` authors 8 policies (select/insert/update/delete × `originals` × `cutouts`), each pinning `bucket_id` and binding `(storage.foldername(name))[1] = auth.uid()::text`. `packages/db/test/storage-rls.integration.test.ts` has 6 tests including a **mutation probe** proving the folder-index literal `[1]` is load-bearing (`[2]` leaks across users) and a real up→down→up redo.

**The buckets are `originals` and `cutouts`. There is no `uploads` bucket** — the previous edition of this file said "uploads", and an operator who followed it would create a bucket the app never writes to and skip the one it does.

**Grade: ASSERTED-NOT-EXERCISED against real Supabase Storage.** The migration is dual-target: on a bare `postgres:17` container it fabricates a `storage` schema stand-in so *the same policy text* is really enforced (that part is VERIFIED — RLS FORCE on the stand-in, superuser confirms the row exists while the other tenant sees 0). But hosted Supabase owns the real `storage.objects`, and the policies have never been applied there. **Storage-RLS-in-production remains unproven.**

### Money loop — closed, structurally proven, and now poison-pill-hardened

`revenuecat-webhook` is the sole writer of `subscriptions.entitlement_active`: constant-time secret auth → `webhook_events` atomic replay-dedup → monotonic `event_ts` guard → write under `makeServiceExecutor` (the one sanctioned RLS-bypass seam). `parse-photo kind=full` reads that entitlement and 402s otherwise. `0016_apply_webhook_event_fn.sql` was added by `44812c5` for the poison-pill case.

**The structural guarantee is VERIFIED:** an `app_user` token calling the write path is refused `42501` — a client cannot mint its own entitlement. **The end-to-end guarantee is ASSERTED-NOT-EXERCISED:** no real RevenueCat event has ever been delivered. Per `CLAUDE.md`'s own money rule, a self-authored success fixture is a mirror oracle. The committed fixture is a *real captured RC v1 payload shape*, which is better than invented, but the delivery path (signature as RC actually signs it, retry semantics, real ordering) is untested.

### Per-user provider-spend throttle — landed `8c33365`, closing a real day-1 hole

`packages/functions/src/parse/rate-limit.ts` is a per-user token bucket over `rate_limit_counters` (`0015`) + `rate-limit.repo.ts`, bound into `parse-photo` as `dbSpendLimiter`. Defaults `DEFAULT_PARSE_RATE_LIMIT = 20` per `DEFAULT_PARSE_RATE_WINDOW_SECONDS = 3600` (`rate-limit.ts:25-26`).

The design choice worth naming, because it is the opposite of the usual bug: **the defaults are the ENFORCED values, not a fallback to "off."** `positiveIntOrDefault` rejects `''`, `'0'`, `'-1'`, `'off'`, `'Infinity'`, `'12.5'` — "there is deliberately NO env value that means unlimited" (`rate-limit.ts:22-27`). Misconfiguration can only fail *back to conservative*, never open. Exercised by `rate-limit.repo.integration.test.ts` + `parse-photo-throttle.integration.test.ts`.

### The three Audit-R2 security fixes (`44812c5`) — the most consequential commit in the repo

Recorded here because they were security defects found *after* the previous audit declared the backend done:

1. **Cross-tenant photo read + SSRF on the parse path.** `source_photo_path` was a bare `z.string()` from the request body, stored verbatim, and handed to OpenAI/Photoroom as a URL *their* servers fetch. User A could POST B's path and receive B's photo described back as garment attributes, with its cutout persisted into A's wardrobe; any attacker URL became an SSRF fetch at our expense. **The trap worth remembering: this looks covered by `0013`'s Storage RLS and is not** — that policy governs what `app_user` may touch inside Postgres; the fetch happens on the vendor's servers. No DB policy can reach it. Fixed *structurally*: the field is removed from `CreateParseJobRequest` (`.strict()` now rejects it) and the key is derived server-side as `{user_id}/{hash}/original`, so naming another tenant's object is unrepresentable rather than merely refused. Vendors get a short-lived signed URL minted under the **caller's own JWT**, never `service_role`.
2. **A crashed parse bricked the photo forever.** `claim()` gated on `status IN ('pending','failed')`, so the 2-minute crash lease was dead code for a row stuck at `processing` by a dead isolate; with `UNIQUE(user_id, source_photo_hash)` every retry then got a permanent 409.
3. **Webhook poison pill** → `0016_apply_webhook_event_fn.sql`.

### Tests — **53 files on disk; 247 unit (22 files) + 221 passed / 14 skipped integration (31 files)**

```
find packages -name "*.test.ts" -not -path "*/node_modules/*" | wc -l   # → 53
npx vitest run --project unit
# → Test Files 22 passed (22) / Tests 247 passed (247)
npx vitest run --project integration
# → Test Files 31 passed (31) / Tests 221 passed | 14 skipped (235)
```

Per package (`find … | sed -E 's|packages/([^/]+)/.*|\1|' | sort | uniq -c`): **db 17 · functions 18 · shared 10 · mobile 8**. (The 18 in `functions` = 14 integration under `test/` + 4 adapter unit tests under `src/adapters/`.) 22 + 31 = 53, so the file count and the two project runs reconcile exactly.

The 2 files / 19 tests added after this section was first written are the native sign-in credential adapters (`aa025e9`) — see §3's note on which visual defects that commit closed.

**The 14 skipped are not passes.** They are `preflight.integration.test.ts` (A.1–A.4 + B.1), which asserts against a **real deployed Supabase project** and self-skips without `PREFLIGHT_PROJECT_REF`, printing a deliberate `PREFLIGHT SKIPPED — THIS IS NOT A PASS` banner. That banner is the best anti-mirror device in the repo; it is the reason the 14-test gap between `find` and "passed" is visible at all.

**Caveat that must not be lost:** these are the coding agents' own suites. The strongest independence claims (the money mutant, the secret-auth mutant, the concurrency races, the `44812c5` SSRF kill) were re-derived by the orchestrator *from main*, which is real but still same-model. The genuinely external oracles — a real webhook delivery, real Storage RLS, real provider output, a populated-migration round-trip on prod-shaped data — **have still never run.** The one external oracle that HAS now run is the simulator screenshot (§3).

---

## 3. STATE OF THE UI — the app renders. That was previously unknown.

**This is the single biggest change since the last edition, and it inverts a claim.** The previous audit said "no screen has ever been rendered on a real device or simulator (visual output is explicitly unverified)." That is **false as of `ab25513`**: 17 PNGs are committed under `packages/mobile/screenshots/`, captured from a real booted iOS simulator.

```
ls packages/mobile/screenshots/ | wc -l     # → 17
```

`account-default` · `account-delete-armed` · `laundry-{empty,error,populated}` · `outfits-{empty,error,populated}` · `paywall-{error,member,offer}` · `signin-default` · `suggestions-{error,populated}` · `wardrobe-{empty,error,populated}`.

**What the screenshots prove:** the Expo app boots, the session gate resolves, `NavShell` renders 6 tabs, every screen's loading / empty / populated / error state is real and reachable, `AccountScreen`'s two-step delete arms correctly (type `DELETE` → red `Permanently delete everything` + `Keep my account`), and the token system produces a coherent light theme. This is genuine progress and it was not knowable before.

**What the screenshots also prove — 6 confirmed visual defects, in severity order:**

1. **The paywall shows NO PRICE.** — **FIXED IN CODE, NOT YET RE-CAPTURED.** Was an App Store Guideline 3.1.2 rejection. `paywall-offer.png` displays three value bullets, a `Subscribe` button, and "Billed through the App Store. No hidden charges." — and no number anywhere. `git grep` over `PaywallScreen.tsx` finds no price string, no `react-native-purchases`, and `onPress={() => {}}`. Apple requires price, duration, and renewal terms *on the purchase surface*. **A reviewer rejects this build.** It is also the F2 blocker: the app cannot charge.
2. **Every screen title collides with the Dynamic Island.** — **CODE FIXED at `aa025e9`, NOT YET RE-CAPTURED.** Visible in 11 of 17 shots: "Your clos⬛", "Go prem⬛", "Profi⬛e", "Tod⬛y", "Lau⬛dry", "Out⬛its" — the title text renders *behind* the status bar and pill. Worse in `paywall-member.png` and `account-delete-armed.png`, where the first card is *under* the status bar entirely and "Sign out" is clipped to a sliver at the top edge. Root cause was `src/ui/Screen.tsx`, which never applied insets ("intentionally deferred: they arrive with the real navigation library"). `aa025e9` applies the measured `useSafeAreaInsets().top` **on the outer canvas rather than the content padding** — padding on a ScrollView's `contentContainerStyle` scrolls away, so the collision would return the moment she scrolled — and mounts `SafeAreaProvider` outermost in `App.tsx`, above the session gate, because the gate renders a `Screen` before `NavShell` mounts and `useSafeAreaInsets` silently returns zeros outside the provider. **The 17 committed PNGs are all PRE-fix. Re-capture is the oracle; this line is a code claim, not a visual one.**
3. **The "Membership" tab label wraps mid-word to "Membersh / ip".** — **CODE FIXED at `aa025e9`, NOT YET RE-CAPTURED.** In all 16 shots that show the tab bar. `NavShell.tsx` gave each tab `flex: 1` with no `numberOfLines` — 6 equal tabs cannot fit 11 characters at `caption` size (13pt). The label is now **"Plan"** (the `profile` KEY is unchanged — that is the contract `App.tsx` keys its screen map by), and every tab label carries `numberOfLines={1}` so a future long label truncates rather than breaking the bar. The tab bar also now adds `insets.bottom` below its own padding, so taps land on labels instead of the system swipe-up region.
4. **`text.tertiary` fails WCAG AA — and so do 6 other tokens.** — **FIXED IN CODE AND NOW GATED, NOT YET RE-CAPTURED.** The accent is split by role (`accent.*` text/fill-legal at ≥4.61:1; `accentDecorative.*` keeps the original brand hexes for dots/rules/borders), every hue preserved to within 2°, and `packages/mobile/src/tokens/contrast.test.ts` now fails the build on any regression — restoring the old palette turns 11 tests red. The table below is the PRE-FIX measurement, kept as the record of what shipped. Computed from `tokens.ts:131-152` (sRGB relative luminance, WCAG 2.x; recompute with the snippet in `docs/07-ui-state.md`):

   | Foreground | on `bg.canvas` | on `bg.surface` | on `bg.sunken` | AA (4.5 text / 3.0 large+UI) |
   |---|---|---|---|---|
   | `text.primary` #1A1A1A | 16.69 | 17.40 | 15.45 | pass |
   | `text.secondary` #5C5A57 | 6.59 | 6.87 | 6.10 | pass |
   | **`text.tertiary` #9A9793** | **2.79** | **2.91** | **2.58** | **FAIL — fails even 3.0** |
   | **`accent.pink` #E8709A** | **2.79** | **2.91** | **2.58** | **FAIL — and this is the brand accent** |
   | **`accent.red` #D8483F** | **4.10** | **4.27** | **3.79** | **FAIL as text** (large-text only) |
   | **`accent.blue` #5A8FC7** | **3.26** | **3.39** | **3.01** | **FAIL as text** |
   | **`state.clean` #6FA98A** | **2.61** | 2.72 | 2.42 | **FAIL — sub-3.0 as a UI indicator** |
   | **`state.dirty` #C9A96A** | **2.15** | 2.24 | 1.99 | **FAIL** |
   | **`state.unavailable` #B7B4B0** | **1.98** | 2.07 | 1.83 | **FAIL** |

   Plus **`text.onAccent` #FFFFFF on `accent.pink` = 2.91** — the filled `Button`'s own label fails AA. That is the `Subscribe` label and the `I wore this` label. **7 of 10 foreground tokens fail.** `docs/03` §Accessibility calls AA contrast "baseline, non-negotiable" — so this is a real accessibility defect in the palette, not merely a doc error. The `docs/03` mitigation for the *state* colors ("never encode meaning in hue alone — icon + label") is real and is honored (`AvailabilityChip.tsx`), but that addresses colour-blindness, not contrast.
5. **No typeface is set at all.** — **FIXED IN CODE, NOT YET RE-CAPTURED.** `typography.family` is now REQUIRED (was `string | undefined`) and set to `'System'`, so "no typeface" is unrepresentable rather than merely unnoticed. Previously `tokens.ts:178` was `family: undefined` — the platform default (SF Pro on iOS, Roboto on Android). `docs/03` §Typography specifies "a modern humanist/geometric sans; one family". The screenshots are SF Pro. Nothing enforces the choice, and nothing fails when it is still `undefined` at ship.
6. **A blue gear button floats over every screen, top-right, and belongs to no closet-app code.** Present in all 17 shots. `git grep -ni 'gear|settings|FloatingAction' -- packages/mobile` → **0 hits.** So it is the simulator's own accessibility/QuickAction overlay, not the app — **but it is in the committed evidence**, which means these 17 PNGs are diagnostic captures and **must not be reused as App Store assets**. `content/store/screenshot-plan.md` must be shot fresh.

**What the screenshots do NOT prove.** Nothing about F1: there is no scan screen, no reveal, no processing animation, no cutout — the emotional peak of the product has no pixels because it has no code. Nothing about "does it feel premium" (that is owner taste). Nothing about Android. Nothing about real data — every populated shot is fixture data against `.invalid` placeholder config (`src/api/config.ts` DEV fallback), because no backend is deployed.

Full inventory, per-shot notes, and the capture procedure (including a warning that already cost one wrong-app capture) are in **`docs/07-ui-state.md`**.

---

## 4. What is NOT built

### The conversion engine (F1) — ABSENT, and it is the whole thesis

```
ls packages/mobile/features/                  # → auth laundry monetization navigation outfits suggestions wardrobe
                                              #   NO onboarding/ NO palette/
git grep -niE 'classifier|intimate|nsfw|privacy.gate' -- packages   # → 0 hits
git grep -niE 'imagepicker|medialibrary|exif|gps' -- packages       # → 0 hits
git grep -n useParsePhoto -- packages/mobile/features               # → 0 hits
```

There is no photo-ingestion path of any kind. **The on-device privacy gate — this app's defining, ABLATE-tier constraint — does not exist in any form.** `useParsePhoto()` (`hooks.ts:119`) is dead code. The scan → teaser → reveal → paywall sequence that the entire conversion thesis rests on has no screen.

### Feature status, re-derived from `packages/mobile/features/`

| # | Feature | Dir | Screen | Mutation wired | Verdict |
|---|---|---|---|---|---|
| F1 | Onboarding scan (gate→teaser→reveal) | **none** | **none** | — | **ABSENT.** No dir, no picker, no gate. |
| F2 | Hard paywall | `monetization/` | `PaywallScreen` | **no** | Read-only `useEntitlement()`. `onPress={() => {}}`, no price, no RC SDK. **Cannot take money.** |
| F3 | Post-payment full parse | **none** | **none** | — | Backend `kind=full` gate exists + tested; no UI. |
| F4 | Wardrobe + dedupe-by-pick | `wardrobe/` | `WardrobeScreen` | **no** | Read-only list. No filter UI (F4 requires category/color/availability). Dedupe pick sheet absent; `useResolveDedupe()` dead. |
| F5 | Weather-aware suggestions | `suggestions/` | `SuggestionsScreen` | partial | `useLogWear()` wired (`:79`, `client_id` correctly minted at tap time). **Not weather-aware:** `WeatherPort` exists in `shared`, `git grep -i weather -- packages/mobile` → 0 hits. |
| F6 | Manual outfit builder | `outfits/` | `OutfitsScreen` | **no** | List surface only; the builder canvas is "a later screen" (`:1-3`). `outfits-empty.png` shows a **dead "Build an outfit" button** (`:27` `onAction={() => {}}`). `useCreateOutfit()` dead. **Cannot create an outfit.** |
| F7 | Availability tracking | `laundry/` | `LaundryScreen` | **yes** | Only dirty→clean (`:60`). No clean→dirty, no →unavailable — 2 of 3 documented transitions unreachable. |
| F8 | Daily wear log | via `suggestions/` | — | **yes** | Per-item from the suggestion hero only. No per-outfit wear, no history view. |
| F9 | Color harmony | pure fn in `shared` | — | n/a | `harmony.ts` + tests exist. **No UI surfaces it** — `docs/01` F9 requires it score/filter suggestions and give feedback in the builder; neither happens. |
| B1 | Swatch quiz | **none** | **none** | — | No `palette/` dir. `useUpsertPalette()` dead. Backend route + repo + tests all exist. |
| — | **Auth + data rights** | `auth/` | `SignInScreen`, `AccountScreen` | **yes** | `useExportMyData` + `useDeleteAccount` wired. The most complete feature in the app — and it had **no F-number in `docs/01` until this pass** (now F10). |

**4 of 11 surfaces have a mutation wired. 5 of the 11 mutation hooks in `hooks.ts` are dead code.** The two revenue-critical paths (F1 reveal, F2 purchase) are both absent.

### Gates claimed in docs that DO NOT EXIST

This is the category most likely to produce a false sense of safety, so it is enumerated. The real gate list is `scripts/verify.mjs` STEPS (`:31-53`) + `ls scripts/gates/` (4 files):

`gen:check` · `check-budget` · `check-secrets` · `check-definer-search-path` · `typecheck` · `lint` · `check-rls` (full) · `test:unit` · `test:integration` (full) · `bench-scan:replay` (full). **That is all of them.**

| Claimed | Reality |
|---|---|
| **no-literal-colors CI gate** (`CLAUDE.md`, `docs/02` §8, `docs/03` header, `CONTRIBUTING.md`, `tokens.ts:3`) | **Does not exist.** Not in `verify.mjs`, not in `scripts/gates/`, not in `eslint.config.mjs` (which names it as a *future* rule in a comment, `:6-10`). The *behavior* is clean (`git grep -nE '#[0-9a-fA-F]{3,8}' -- packages/mobile/features packages/mobile/src/ui` → 0 hits) — by discipline, not enforcement. |
| **`supabase.from()` lint-ban** | **Does not exist.** `eslint.config.mjs` is `tseslint.configs.recommended` + an `ignores` block, nothing else. |
| **`no-console` lint-error** | **Does not exist.** |
| **cross-feature import ban** | **Not wired.** `eslint.config.mjs:36-42` computes `crossFeatureZones` and exports it; it is passed to no rule. `:33-35` says so plainly. `eslint-plugin-import` is not a dependency. |
| **bare `process.env` ban** | Convention only, no rule. |
| **`pnpm mutation` battery** (`docs/05` Tier-0: "a surviving mutant is a build-blocking gap") | **No `mutation` script in `package.json`.** No mutation tooling, no nightly runner. Mutants have been hand-derived by the orchestrator on the money/secret/SSRF paths — real, but not a standing gate. |
| **nightly bench-scan adversary/differential tiers** | No scheduler. |
| `check-route-schema`, `check-unbounded-select`, `check-migration-drift` | Commented out in `verify.mjs:50-52`. |
| **"CI gate" anywhere, in any doc** | **There is no CI.** `ls .github/` → `CODEOWNERS` only. Nothing runs on any trigger except the local lefthook pre-commit and manual invocation. |

**And the cage itself is advisory.** `.github/CODEOWNERS:6` says "PARKED: not enforced until a GitHub remote + branch protection ruleset exist," and there is no remote. `CLAUDE.md`, `AGENTS.md`, `docs/02` §7 and `docs/04`'s enforcement table all state the cage as a mechanical guarantee. It is prose. The only real enforcement is the prompt-level CAGE list each agent is given.

Two supporting drifts, both now corrected in place: `packages/db/migrations/approvals/` **does not exist** (the approval mechanism has never been exercised), and `conventions.json` declares 10 `featureRoots` while disk has 7 — `onboarding`, `palette`, `wearlog` are phantom, and `gen:check` passes anyway because it only checks generated-file freshness, not disk correspondence. `conventions.json` is human-owned; both are reported, not edited.

### Also absent

- **`docs/BUG-QUEUE.md`** — referenced by `AGENTS.md`, `docs/04`, `RUN-LOG.md`, and printed by the `session-start` hook. `ls docs/BUG-QUEUE.md` → not found.
- **Marketing/creator research** (`docs/04` Phase 4) — nothing on disk.
- **Dynamic type / reduced-motion** — `docs/03` calls both "non-negotiable baseline". No `allowFontScaling`, no `PixelRatio.getFontScale()`, no `AccessibilityInfo` in `packages/mobile`. (Screen-reader labels and ≥44pt hit targets, by contrast, **are** partly implemented — 7 `accessibilityLabel`/`Role` sites and 3 `minHeight: 44` sites. Partial, not zero.)
- **Tabular numerals** — `docs/03` §Typography requires them; no `fontVariant` anywhere.

---

## 5. Unresolved placeholders

**The product name — still the single biggest content blocker.**

```
git grep -c '\[App Name\]' -- content     # → 9 files, 45 occurrences total
```
`premium-closet-app.md` 15 · `store/app-store-listing.md` 9 · `README.md` 5 · `store/README.md` 5 · `store/google-play-listing.md` 4 · `store/aso-keyword-plan.md` 3 · `how-to-digitize-your-closet.md` 1 · `landing/landing-page.md` 1 · `store/screenshot-plan.md` 1.

**The three-competing-placeholder-conventions problem is FIXED.** The previous edition called `REPLACE-WITH-CANONICAL-DOMAIN` "the dangerous one":

```
git grep -n "REPLACE-WITH-CANONICAL\|\[DOMAIN\]" -- content
# → 1 hit: content/store/README.md:117 — which is the CHECKLIST INSTRUCTION to grep for them
```

Everything normalized to the single `{{CANONICAL_URL}}` token in `ac46ac0`. `store/README.md:117`'s instruction is now vacuous but harmless; it can stay as a pre-publish assertion.

**Env keys — 11 read in code, and the two provider keys are now real requirements (they were hypothetical before the adapters landed):**

```
git grep -ohE "(requireEnv|envValue)\('[A-Z_]+'" -- packages/functions/src | sort -u
```
`requireEnv`: `JWKS_URL` · `OPENAI_API_KEY` · `PHOTOROOM_API_KEY` · `REVENUECAT_WEBHOOK_SECRET` · `SUPABASE_ANON_KEY` · `SUPABASE_URL`.
`envValue` (tunables, defaulted): `OPENAI_BASE_URL` · `OPENAI_VISION_MODEL` · `PHOTOROOM_BASE_URL` · `PROVIDER_TIMEOUT_MS` · `PROVIDER_MAX_RETRIES`.
Plus the throttle's `PARSE_RATE_LIMIT_MAX` / `PARSE_RATE_LIMIT_WINDOW_SECONDS` (read via the repo's own `readEnv`), and the pool strings from the shims: `DATABASE_URL` (all 11 user-JWT routes) + `SUPABASE_DB_SERVICE_URL` (webhook only). Mobile needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_FUNCTIONS_BASE_URL`.

**`.env.example` exists but is UNTRACKED — a live fragility.** `.env.example` (9,616 bytes) and `packages/mobile/.env.example` are both present in the working tree and neither is in `git ls-files`. `.gitignore` explicitly allows them (`!.env.example`). `DEPLOY-RUNBOOK.md` and the preflight banner both cite `.env.example` as authoritative. **On a fresh clone it does not exist and the runbook points at nothing.** Staging it is an owner decision (open task #21).

**Code TODO/FIXME/HACK/XXX:** `git grep -E 'TODO|FIXME|HACK|XXX' -- packages` → none. The gaps are explicit dead handlers (`onPress={() => {}}`) and `VISUAL UNVERIFIED` comments, not scattered markers. Note the `VISUAL UNVERIFIED` comments are now themselves stale in the 7 screens that have been photographed.

---

## 6. Blocked-on-human

| Blocker | Which escalation trigger |
|---|---|
| **Product name** | Taste/brand. Blocks all content + ASO + both store listings. |
| **Provider API keys** (OpenAI, Photoroom) | Spend authorization + credential issuance. The adapters are built and waiting; this is the only thing between them and a real parse. |
| **Supabase project + deploy** (`DATABASE_URL`, `SUPABASE_DB_SERVICE_URL`, `JWKS_URL`, `REVENUECAT_WEBHOOK_SECRET`, Storage buckets) | Irreversible ops. Also the vantage that would finally exercise Storage RLS and the service_role wiring. |
| **The paywall price + RevenueCat product config** | Pricing is an owner decision; the App Store product must exist before the purchase call can be written. Blocks the 3.1.2 fix. |
| **Visual design pass** (palette contrast, typeface, safe-area) | The *defects* are agent-fixable and should be fixed. "Does it feel premium," the final hex values, and the typeface are owner taste. |
| **On-device privacy classifier + labeled corpus** | Device-ML graded against an independent labeled intimate/not-her corpus. **Hard launch blocker** — the privacy invariant is unenforced without it, and `content/store/`'s "screened on your device" line cannot go live until it clears a recall floor. |
| **Real RevenueCat webhook delivery + populated-migration DOWN round-trips** | The two external oracles on money and data. A mocked success does not count. |
| **SEO publish + App Store submission + legal sign-off** | Semi-irreversible / liability-irreversible. |

**The money *build* is not blocked** — `CLAUDE.md` grants full build/verify/commit autonomy there, and the webhook path is done. What is blocked on money is (a) the *price and product config*, which is an owner decision, and (b) the *real-event verification*, which needs an event the agent cannot manufacture.

---

## 7. Adversarial — what breaks on day 1

The previous edition's #1 ("parse-photo 502s for every user") and #3 ("no rate limit") are **closed**. What remains:

1. **A reviewer rejects the build before any user sees it.** No price on the paywall (Guideline 3.1.2); the `Subscribe` button does nothing; every screen title is under the Dynamic Island; "Membersh/ip" is visibly broken. §3 has the evidence. This is the nearest-term failure and it is fully agent-fixable except for the price itself.
2. **The money write fails closed if `service_role` isn't wired.** `revenuecat-webhook` writes under `makeServiceExecutor` over `SUPABASE_DB_SERVICE_URL`. If that pool connects as anything but a real `service_role`, `applyEvent`/`record` hit RLS and raise **`42501`** — exactly the refusal the tests prove for `app_user`. RevenueCat sends a valid purchase, the webhook 500s, entitlement never flips, **the paying customer stays locked out.** The safety guarantee becomes the day-1 outage if secrets are misconfigured. Still the most dangerous single deploy-time misconfiguration; `_shared/pool.ts`'s dual-executor model is documented in `supabase/functions/README.md` and `DEPLOY-RUNBOOK.md` §"Route → env-var mapping", and preflight A.1b is the check that catches it.
3. **Provider quality is entirely unknown.** The adapters are wired and fail closed, but no real response has ever been parsed. The bench-scan floor (0.75) is scored against a *pinned corpus*, not live GPT-4o. If real-world extraction lands below the floor, the reveal is unimpressive and the conversion thesis fails — and that will only be knowable after keys exist. **Treat parse quality as unmeasured.**
4. **Storage RLS has never met real Supabase Storage.** `0013` is exercised against a fabricated stand-in. Hosted Supabase owns `storage.objects`; the policies must be applied and re-proven there. Until then the cross-user *byte* isolation claim is ASSERTED-NOT-EXERCISED. Note this is *narrower* than it was — the policy text now exists and is tested against its own semantics, which it was not before.
5. **Concurrency guarantees remain unconfirmed under real contention.** Three separate times (W3, W4a, W4b) a build agent's concurrency oracle passed in its slow worktree and **failed on main** under real parallelism (teaser cap blown 12≠3; one-winner race). The `wear_log` response-idempotency fix is correct by READ COMMITTED reasoning but **did not reproduce locally** (`Promise.all` serializes the local pool). Its confirming vantage is prod under load. Treat every concurrency claim as unconfirmed.
6. **First-traffic unknowns:** JWKS reachability/latency (every authed request builds a remote JWKS), pg pool sizing under Edge concurrency, migration apply against a live populated DB. Not code defects — first-contact risks with no oracle run.
7. **EXIF/GPS is a future defect, not a present one.** `git grep -niE 'exif|gps|imagepicker|medialibrary' -- packages` → **0 hits**, and there is no upload path at all, so there is nothing to strip yet. It becomes a real defect the moment an upload path exists: iOS camera-roll files carry `GPSLatitude`/`GPSLongitude`, a wardrobe photo is taken at home, so unstripped EXIF is a **home address** forwarded to OpenAI + Photoroom and retained in `originals` (which `privacy-policy.md:129` documents as retained). Strip by re-encoding on-device before upload; assert no APP1/Exif marker in the uploaded bytes. See §8 step 6b.

---

## 8. Ordered path to launch

**[H]** human-required · **[A]** agent-doable · **[A→H]** agent builds, human gates.

1. **Fix the visual defects found by the screenshot audit.** **[A]** — safe-area insets on `Screen` (or the nav library), `numberOfLines`/shorter label for the Membership tab, and a palette revision that clears AA for `text.tertiary`, `accent.pink` as text, `onAccent`-on-pink, and the three state colors. **Re-verify by re-capturing**, not by reasoning — `docs/07-ui-state.md` has the procedure. This is the cheapest high-value work available and it needs nothing from anyone.
2. **Resolve the product name.** **[H]** — unblocks 45 placeholder sites, both store listings, and ASO.
3. **Decide pricing + create the RevenueCat/App Store product.** **[H]** — then **[A]** wire the real purchase call and put price + duration + renewal terms on the paywall. Without this the build is rejected and cannot charge.
4. **Provision provider API keys.** **[H]** — spend authorization. The adapters are built and waiting.
5. **Stand up a real Supabase project;** wire `DATABASE_URL` (app_user-capable), `SUPABASE_DB_SERVICE_URL` (real `service_role`), `JWKS_URL`, `REVENUECAT_WEBHOOK_SECRET`, provider keys; create the **`originals` + `cutouts`** buckets; apply all **16** migrations; apply and re-prove the `0013` Storage policies against real Storage. **[A→H]** — follow `docs/DEPLOY-RUNBOOK.md` and run the preflight suite with `PREFLIGHT_PROJECT_REF` set so the 14 skipped tests actually execute. **Verify §7.2 (service_role really writes entitlement) and §7.4 (Storage RLS binds to `sub`) here — the two silent-failure traps.**
6. **Build F1: the scan → teaser → reveal flow, and the on-device privacy gate.** **[A→H]** — the gate is the launch blocker (agent builds the model + harness; human curates the labeled corpus and owns the safety go/no-go). This is also where the missing `features/onboarding/` and the photo picker land, and it is the largest remaining piece of product.
   - **6b. STRIP EXIF/GPS ON-DEVICE — a hard requirement for whoever writes the upload path.** **[A]** Not a present defect (§7.7); becomes one the instant upload exists. Re-encode on-device (`expo-image-manipulator` drops EXIF on re-encode) and assert the uploaded byte stream carries no APP1/Exif marker. Note the privacy policy's existing location promise (`privacy-policy.md:93-95`) is about *weather* coordinates, not photo metadata — so there is no live contradiction today, and there would be one immediately.
7. **Grade real parse quality against the bench-scan corpus with live providers.** **[A]** — the first honest measurement of the make-or-break lever. Only possible after step 4.
8. **Fill the remaining feature gaps:** F4 filters + dedupe pick sheet, F6 builder canvas, F7's two missing transitions, F9 surfaced in suggestions + builder, B1 swatch quiz, F3's post-payment full parse UI. **[A]** — all backend-complete, all UI-absent; 5 dead mutation hooks get callers.
9. **Verify the money path against a REAL RevenueCat event** (replay + out-of-order + late) and **round-trip every migration DOWN on populated, prod-shaped data.** **[A→H]** — the two external oracles. A mocked success does not count.
10. **Publish SEO content · legal sign-off · App Store submission with FRESH screenshots.** **[A→H]** — the 17 committed PNGs are diagnostic captures with a simulator overlay artifact and known defects; they are **not** store assets. Shoot `content/store/screenshot-plan.md` after step 1.

**Critical path to a build that would survive review:** 1 → 2 → 3. **Critical path to a usable product:** + 4 → 5 → 6. **Critical path to an *honest* launch:** + 7, 9, and the classifier recall floor in 6 — the external oracles that still have never run.
