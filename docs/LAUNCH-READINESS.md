# LAUNCH-READINESS — pre-launch audit

*Adversarial, re-derived-from-the-tree audit. Not a status report — a stop-check against a false "we're ready." Every claim here was verified against the actual files on disk (2026-08-07), not taken from RUN-LOG. Where RUN-LOG and disk agree, that is noted; where a claim is asserted-but-unexercised, that is called out.*

---

## 1. Executive verdict

**This is NOT launch-ready, and it is not close in the ways that matter for a shipping product — even though the autonomous surface is genuinely done and genuinely good.** What exists is a fully-built, integration-verified **backend** (12 migrations, RLS FORCE on all 7 tenant tables, 8 repos, 9 Edge handlers, the money loop closed) plus a **structural frontend scaffold** and **draft SEO content**. What does NOT exist is a *deployed, usable product*: the parse pipeline — the entire "aha" the conversion thesis rests on — returns HTTP 502 because no real GPT-4o/Photoroom adapters are wired; nothing is deployed to any Supabase project (no `.env`, no real secrets, no provider keys); no screen has ever been rendered on a real device or simulator (visual output is explicitly unverified); the on-device privacy-gate classifier — this app's *defining* constraint — does not exist in any form; and every piece of marketing content still contains the literal placeholder `[App Name]` because **the product does not have a name.** The honest gap: the team has built the *reversible, agent-gradeable 80%* to a high bar, and has done essentially none of the *irreversible, taste-laden, human-gated 20%* that is the actual difference between "an agent built a backend" and "a customer can buy and use this." That 20% is, by the project's own design (docs/04), exactly the launch-blocking work.

---

## 2. What is BUILT + VERIFIED

Confirmed present on disk, not just claimed:

**Backend (packages/db, packages/functions):**
- **12 migrations** — `packages/db/migrations/0001_substrate.sql` … `0012_resolve_teaser_job_fn.sql`. Count verified (`ls | wc -l` = 12). RLS FORCE + default-deny asserted across the RLS integration suite.
- **8 repos** — `packages/db/src/repos/{wardrobe,outfits,outfit-items,wear-log,palette,parse-jobs,subscriptions,webhook-events}.repo.ts`. The DB-access seam; nothing else touches `supabase.from()`.
- **9 Edge handlers** (RUN-LOG says "6 endpoints" counting product features; the deployed route count is higher). Source in `packages/functions/src/`: `wardrobe/{list,availability,dedupe}`, `outfits/{create,list}`, `wear-log/log-wear`, `palette/{upsert-palette,read-entitlement}`, `parse/parse-photo`, `billing/revenuecat-webhook`. Auth infra: `auth/{withAuth,serveAuthed,executor,respond,env,logger}.ts` (asymmetric JWKS via `jose`, per-request `SET LOCAL ROLE app_user`).
- **Money loop closed** — `revenuecat-webhook.ts` is the sole writer of `subscriptions.entitlement_active` (service_role executor, constant-time secret auth, replay-dedup, monotonic guard). `parse-photo` `kind=full` reads that entitlement (402 otherwise). Structural guarantee proven in tests: an `app_user` token calling the write path is refused `42501` — a client cannot mint its own entitlement.

**Test gauntlet — actual files on disk (docs/05 tiers):** **35 `*.test.ts` files total.**
- **Tier-1 property / metamorphic / pure-logic (shared, unit): 10 files** — `parse`, `parse-metamorphic`, `suggestion`, `palette`, `harmony`, `dedupe` (+ `schemas/schemas`, `ports/{AIVisionPort,WeatherPort,CutoutPort}`).
- **Tier-3 backend E2E + Tier-2 RLS/security (db integration): 14 files** — includes `substrate.rls`, `wardrobe.rls`, `outfits-wearlog.rls`, `subscriptions.rls`, `cross-tenant.security`, and per-repo integration tests.
- **Tier-2/3/4 handler-level (functions integration): 10 files** — `security`, `chaos`, `auth`, `revenuecat-webhook`, `parse-photo`, `parse-metamorphic`, `wardrobe`, `outfits`, `palette`, `log-wear`.
- **Mobile: 1 file** — `src/api/client.test.ts` (route/URL contract only; no rendering).
- **Tier-1 bench-scan** parse-quality corpus + adversary/replay gate exists under `scripts/bench-scan` (wired keyless-replay into `verify:full`).
- **Tier-0 (mutation battery)** is described in docs/05 as a nightly/smoke gate; RUN-LOG cites hand-derived mutant re-derivations (entitlement flip, secret-auth flip) rather than a standing `pnpm mutation` run — treat mutation coverage as *partially exercised by hand*, not a continuous gate on disk.

**verify:full numbers (from RUN-LOG, latest wave):** **92 unit + 150 integration (24 files)** + bench-scan replay clears the 0.75 floor; check-rls 8/8 FORCE; check-definer-search-path clean. **Caveat that must not be lost:** these are the coding agents' own suites. Per docs/05's own thesis, an AI-written test over AI-written code is a *mirror oracle*. The strongest independence claims here (money mutant, secret mutant, concurrency races) were re-derived by the orchestrator from `main` — real, but still same-model. The genuinely external oracles (real webhook event, real device screenshot, real Storage RLS, populated-migration round-trip against prod-shaped data) are **the ones that have NOT run.**

**Deploy shims (supabase/functions/):** 10 route dirs + `_shared/pool.ts` + `import_map.json` + `config.toml`. Each shim wires a concrete pg pool to a built handler. This is *deploy-ready code*, not a *deployment*.

**Frontend scaffold (packages/mobile/):** `useTokens()` token system, typed API client (parse-don't-cast), react-query hooks, token-only UI primitives, nav shell, and skeleton screens (`WardrobeScreen`, `SuggestionsScreen`, `PaywallScreen`, `OutfitsScreen`, `LaundryScreen`). Structurally complete, zero literal colors — **but visually unverified (see §3).**

---

## 3. What is NOT built / stubbed

- **The parse pipeline does not work.** `packages/functions/src/parse/parse-photo.ts:155` binds `unwiredPorts()` in production; `parsePhoto` (line 159) is that binding. The handler returns **`errorResponse(502, 'parse_provider_failed', …)`** (line 136) because there is no GPT-4o vision adapter and no Photoroom cutout adapter. Confirmed also at `supabase/functions/parse-photo/index.ts` and `supabase/functions/README.md`: "the handler returns 502 until those adapters ship." **This is the product's core loop** (camera roll → cutouts → wardrobe → reveal → paywall). Right now it is inert. Adapters need real API keys, per-call timeouts, and backoff — a separate unbuilt task.
- **The frontend is STRUCTURAL only — never rendered.** RUN-LOG (2026-08-07 frontend wave) states plainly: "**VISUAL OUTPUT UNVERIFIED / HUMAN-GATED**: no simulator ran." Screens compile and are wired to hooks with loading/empty/error states, each carrying a `VISUAL UNVERIFIED` comment, but nobody has seen them render. Per docs/04 Phase 2 and the agent-arch escalation trigger, unobservable visual output cannot be claimed working. There is no evidence any screen looks premium — or even correct.
- **The on-device privacy-gate classifier does not exist.** `git grep` for `classifier|intimate|privacy.gate|nsfw` across `packages/` returns **nothing**. This is the app's *defining* constraint (CLAUDE.md: "the on-device gate filters intimate / non-her photos BEFORE any upload… ABLATE-tier privacy"). It is correctly out of backend MVP scope (docs/05 marks classifier recall as a frontend/device-ML oracle) — but it is a hard launch blocker, because without it the privacy promise is unenforced. The backend proves only the *never-uploads seam* (a handler-level assertion, see §6), never the classifier's recall.
- **No marketing/creator research, no ad plan.** docs/04 Phase 4 (mine UGC creators, cluster formats, rank targets) has produced nothing on disk. Only SEO drafts exist, unpublished.
- **No mutation battery as a standing gate.** docs/05 Tier-0 calls for `pnpm mutation` on critical paths; disk shows hand-derived mutant checks in RUN-LOG, not a continuous gate.

---

## 4. Every unresolved placeholder / TODO

**Product name — the biggest single blocker for content (§ everything):**
- `[App Name]` appears **16 times in `content/blog/premium-closet-app.md`**, once in `content/blog/how-to-digitize-your-closet.md:92`, and is flagged in `content/README.md:32`. The product **has no name.** Every marketing artifact, and by extension the App Store listing, is blocked on this one decision.

**Canonical-URL placeholders in SEO content (would ship a literal placeholder if publish substitutes only one token form):**
- `{{CANONICAL_URL}}` — `content/blog/{capsule-wardrobe-app-guide,how-to-organize-your-wardrobe,outfit-ideas-from-your-own-closet,outfit-planner-app-guide,what-to-wear-nothing-to-wear}.md`, `content/landing/landing-page.md`.
- `https://REPLACE-WITH-CANONICAL-DOMAIN/blog/how-to-digitize-your-closet` — `content/blog/how-to-digitize-your-closet.md:11` (a *different, hardcoded* placeholder form — the dangerous one).
- `https://[DOMAIN]/premium-closet-app` — `content/blog/premium-closet-app.md:12`.
- Three distinct placeholder conventions across eight files. `content/README.md:33` flags this exact risk: a publish step substituting one token form ships a raw `REPLACE`/`[DOMAIN]` string live. **Must normalize to one token before publish.**
- Plus 8 self-critiqued SEO content defects (2 medium keyword-cannibalization, mis-anchored links, overclaims, one inclusivity nudge) enumerated in `content/README.md:12-29` — publish-blocking-ish, not launch-mechanics.

**Env keys that need real secrets before deploy (verified in code):**
- `JWKS_URL` — `packages/functions/src/auth/withAuth.ts:51` (`requireEnv('JWKS_URL')`), asymmetric JWT verification endpoint.
- `REVENUECAT_WEBHOOK_SECRET` — `packages/functions/src/billing/revenuecat-webhook.ts:144` (`requireEnv(...)`), the money-path shared secret.
- `DATABASE_URL` — `supabase/functions/_shared/pool.ts` via `makePool('DATABASE_URL')`, the app_user-capable pg connection string for all 8 user-JWT routes.
- `SUPABASE_DB_SERVICE_URL` — service_role connection string for `revenuecat-webhook` only (the sole sanctioned RLS-bypass seam). **If this is not wired to a real service_role role, the money write raises `42501` — see §6.**
- **Provider keys (not yet referenced in code because adapters don't exist):** GPT-4o / OpenAI vision key, Photoroom (CutoutPort) key. These land with the adapter task.
- No `.env.*` file exists in the tree (correct — secrets are gitignored and sourced, per CLAUDE.md). So *every* value above is currently unset; nothing can run outside tests.

**Code TODO/FIXME/HACK/XXX:** `git grep -E 'TODO|FIXME|HACK|XXX'` over `packages/` returns **none.** The stubs are explicit `unwiredPorts`/502 bindings and `VISUAL UNVERIFIED` comments, not scattered TODOs — cleaner than typical, but the gaps are real.

---

## 5. Blocked-on-human (with WHY each needs a human)

| Blocker | Why a human (which escalation trigger) |
|---|---|
| **Product name** (`[App Name]`) | Taste/brand decision. Not agent-gradeable; blocks all content + App Store. |
| **Real provider API keys** (OpenAI GPT-4o, Photoroom) | Spending money / credential issuance. Agent cannot procure keys or authorize spend. Adapters are agent-buildable *once keys exist*. |
| **Supabase project + deploy** (`DATABASE_URL`, `SUPABASE_DB_SERVICE_URL`, `JWKS_URL`, secrets) | Irreversible-op escalation (docs/04 Phase 1 gate / CLAUDE.md Rule 5). Standing up prod infra + running migrations against a live DB is not autonomous. |
| **Visual design pass + real-device/sim screenshot verification** | Unobservable-output escalation (docs/04 Phase 2). "Does it feel premium?" is not capturable by a pixel diff; and no screen has been *seen* at all yet. Owner owns taste + must authorize sim boot (CLAUDE.md Simulators). |
| **On-device privacy classifier + labeled corpus** | Device-ML oracle graded by an independent labeled intimate/not-her corpus (docs/05 out-of-scope §). The make-or-break safety metric; the app's defining privacy invariant is unenforced without it. Needs a real device + a human-curated corpus. |
| **SEO publish decision** | Semi-irreversible (indexed/cached), outward-facing (docs/04 Phase 3, `content/README.md:1-6`). Human presses publish; also must resolve the placeholder/cannibalization fixes first. |
| **Real-RevenueCat webhook chaos + populated-migration round-trips** | Human-gated per docs/05 Tier-4. The money path must be verified against a **real captured RC event** (a self-mocked success is a mirror oracle and does not count); destructive/narrowing migrations must round-trip DOWN on prod-shaped populated data. |
| **App Store submission** | Irreversible outward-facing (docs/04 Phase 5 / "what else is automatable"). Legal (privacy policy / ToS) approval is liability-irreversible. |

Note: **the money/entitlement build itself is NOT blocked** — CLAUDE.md grants full build/verify/commit/merge autonomy on that path, and it is built + verified. What remains human-gated on money is only the *real-event chaos verification*, which needs a real RevenueCat event the agent can't manufacture.

---

## 6. Adversarial — what breaks on day 1

Assume real users, real traffic, real money, an ops engineer on call:

1. **Parse-photo 502s for every user, immediately.** The core loop is `unwiredPorts` → 502 (`parse-photo.ts:136`). A user signs in, grants photo access, taps scan → the reveal never renders. **There is no product** until the GPT-4o/Photoroom adapters ship. This is not an edge case; it is the day-1 default.
2. **The money write fails closed if service_role isn't wired.** `revenuecat-webhook` applies entitlement under `makeServiceExecutor` over `SUPABASE_DB_SERVICE_URL`. If the deploy connects that pool as *anything but* a real service_role identity, `applyEvent`/`record` hit RLS and raise **`42501`** — the exact structural refusal the tests prove for `app_user`. Result: RevenueCat sends a valid purchase event, the webhook 500s, entitlement never flips, the paying customer stays locked out of `kind=full`. The safety guarantee (clients can't mint entitlement) *becomes* the day-1 failure mode if secrets are misconfigured. **This is the single most dangerous deploy-time misconfiguration.**
3. **No rate limit beyond the hard per-user teaser cap.** docs/06 §8 (`06-backend-design.md:164`) explicitly calls for an **edge per-user token-bucket** as defense against one account hammering the paid vision providers — and RUN-LOG flags it as an unbuilt follow-up. The teaser cap (`TEASER_JOB_CAP=10`, `teaser-cap.ts:5`) caps *teaser* jobs per user, but there is no throttle on `kind=full` request rate or overall provider spend. A single abusive authenticated account (or a leaked token) can run up the OpenAI/Photoroom bill. **Cost-abuse exposure is real on day 1.**
4. **The wear-log concurrency fix is correct-by-semantics but unproven under real concurrency.** RUN-LOG (gauntlet wave) is honest about this: the response-idempotency 500 race **did not reproduce locally** (Promise.all serializes the local pool). The fix (fresh-query re-read on the ON-CONFLICT-no-row path, respecting the append-only `SELECT+INSERT`-only grant) is correct by READ COMMITTED reasoning, but its *confirming vantage is CI/prod under real contention* — which has never run. Same pattern bit W4a (teaser cap blown 12≠3 on main) and W4b (one-winner race) — concurrency bugs here have a track record of passing in the slow worktree and failing under real parallelism. **Treat every concurrency guarantee as unconfirmed until prod load hits it.**
5. **Storage RLS for photo buckets is asserted-only, never exercised.** The Tier-2 "never-uploads seam" test (`security.integration.test.ts:415`) asserts the *handler* rejects a parse request lacking `source_photo_hash` (400, no job row, provider not called) — a handler-level check. docs/05 Tier-2 explicitly requires a **real Supabase Storage-RLS test** proving the path-prefix policy binds to the requester's `sub` for the uploads + cutouts buckets. That test does not exist (no Storage exists — nothing is deployed). So the claim "an unapproved photo has no representable upload path" is proven at the *application* layer but **not at the storage layer against a real bucket.** On a real Supabase project, Storage RLS policies must be authored and tested before the privacy invariant holds end-to-end.
6. **First-traffic unknowns that only prod reveals:** JWKS endpoint reachability/latency (every authed request calls `createRemoteJWKSet(JWKS_URL)`), pg pool sizing under Edge concurrency, migration apply against a live populated DB (never round-tripped on prod-shaped data — docs/05 Tier-4 human gate). None are code defects; all are deploy-time first-contact risks with no external oracle run yet.

---

## 7. Ordered path to launch

Minimal human+agent sequence. **[H]** = human-required (escalation trigger), **[A]** = agent-doable, **[A→H]** = agent builds, human gates.

1. **Resolve the product name.** **[H]** — unblocks all content + ASO + App Store. One decision; everything downstream waits on it.
2. **Provision provider API keys** (OpenAI GPT-4o, Photoroom). **[H]** — spend authorization + credential issuance.
3. **Build the real AIVisionPort + CutoutPort adapters** (envValue secrets, per-call timeout, bounded concurrency, backoff) and re-bind `parse-photo` off `unwiredPorts`. **[A]** — then grade against the existing bench-scan corpus floor (0.75) + metamorphic relations. This turns 502 into a working reveal.
4. **Stand up a real Supabase project; wire `DATABASE_URL` (app_user role), `SUPABASE_DB_SERVICE_URL` (real service_role), `JWKS_URL`, `REVENUECAT_WEBHOOK_SECRET`; run the 12 migrations against it; author + test Storage-RLS policies for the uploads/cutouts buckets.** **[A→H]** — agent prepares configs/migrations + the Storage-RLS test; human owns the irreversible deploy + secret handling. **Verify item §6.2 (service_role really writes entitlement) and §6.5 (Storage RLS binds to `sub`) here — these are the two silent-failure traps.**
5. **Build the edge per-user rate-limit / provider-spend throttle** (docs/06 §8). **[A]** — closes the day-1 cost-abuse hole before real traffic.
6. **Visual design pass + real-device/simulator screenshot verification** of every screen (iOS first, Android parity), against docs/03 tokens. **[A→H]** — agent drives the sim + captures screenshots; human authorizes the boot and owns the "does it feel premium" gate. Only after this can any screen be claimed working.
7. **Build the on-device privacy-gate classifier + curate the labeled intimate/not-her corpus; prove recall against it on-device.** **[A→H]** — agent builds the model + harness; human curates the corpus and owns the safety go/no-go. **Launch blocker — the privacy invariant is unenforced until this passes its recall floor.**
8. **Verify the money path against a REAL RevenueCat webhook event** (replay + out-of-order + late) and **round-trip the migrations DOWN on populated, prod-shaped data.** **[A→H]** — human-gated per docs/05 Tier-4; a mocked success does not count.
9. **Publish the SEO content.** **[A→H]** — the 8 self-critiqued defects (cannibalization/links/overclaims) + canonical-token normalization are now APPLIED (drafts are publish-ready); remaining before publish: resolve `[App Name]` (step 1) + live keyword-volume validation, then human presses publish (semi-irreversible/indexed).
10. **Legal (privacy policy / ToS) + App Store submission + ASO assets from real sim captures.** **[A→H]** — agent drafts + prepares; human approves liability + submits (irreversible).

**Critical path to a usable product** is steps 1→4 (name, keys, adapters, deploy). **Critical path to an *honest* launch** additionally requires steps 6, 7, 8 (visual proof, privacy classifier, real-money proof) — the three external oracles that have never run. Steps 5, 9, 10 are launch hygiene that can parallelize.
