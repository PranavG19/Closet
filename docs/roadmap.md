# Roadmap — FUTURE. Not implemented. Do not build from this file.

> **⚠️ IF YOU ARE AN AGENT: NOTHING IN THIS FILE IS IN SCOPE.**
> Every item here is **NOT-YET-IMPLEMENTED** and none of it is a work item. The MVP scope lives in [`01-product-requirements.md`](./01-product-requirements.md) — build only what is there. If a task references this file, it is for **context on why an MVP seam exists**, never as a thing to build. Current *actual* build state is [`LAUNCH-READINESS.md`](./LAUNCH-READINESS.md); note that several MVP features (F1, F3, B1) are not built yet either, so this file is strictly *behind* that queue.

The point of writing the future down: the schema, the provider seams, and the tenancy model in the MVP must not *preclude* any of it. Each entry notes the **MVP seam** that keeps it cheap to add later — that seam is the only thing the MVP owes the future.

**Priority key.** `P1` = the first things to consider once the MVP actually ships and retains. `P2` = clear value, wants a proven base. `P3` = real but far, or dependent on a substrate that doesn't exist. Priority is *relative ordering within this file*, not a schedule.

---

## 0. Before ANY of this: the MVP is not done

Stated up front because a roadmap read in isolation invites building the fun thing. Re-derived at `ab25513`:

- **F1 (scan → teaser → reveal)** — no `features/onboarding/`, no photo picker, **no on-device privacy gate in any form**. The conversion engine does not exist.
- **F2 (paywall)** — renders, but has **no price** and no purchase call. The app cannot take money.
- **F3** (post-payment full parse UI), **B1** (swatch quiz) — no UI.
- **F4/F6/F7/F9** — partial: no filters, no dedupe pick sheet, no builder canvas, 2 of 3 availability transitions unreachable, harmony surfaced nowhere.
- Nothing is deployed; no provider keys exist.

**Everything below is behind all of that.**

---

## 1. Retention & engagement layer (P1) — the owner's explicit ask

The MVP has exactly one retention loop: the daily wear log (F8). That is the right single loop, and it is deliberately thin. This section is the layer the owner asked for — **habit mechanics translated into wardrobe-native form.** Read §4 first if you are wondering where the running/yoga/Strava requests went.

**The design constraint that governs all of it:** `docs/03` §Design principles — *"Advisory, never bossy… never a red error, never a block, never a nag."* A streak mechanic that shames you for missing a day violates the product's voice. Every mechanic below must be *invitational*. This is the reason a naive gamification port would be wrong here even though the underlying intent is right.

### 1.1 Wear streaks (P1)
"You've logged what you wore 6 days running." A gentle counter, not a scoreboard.
- **Why it fits:** F8 is already a one-tap daily action with a timestamp. A streak is a pure read over existing rows — the cheapest possible retention mechanic.
- **MVP seam:** `wear_log(user_id, worn_at)` already exists and is append-only. A streak is a query, not a table. **Nothing needs building in the MVP to enable this.**
- **The trap:** a broken streak must never feel like a punishment. No "you lost your streak" push, no red. Prefer "back at it" over "you missed 3 days." Consider a forgiving definition (e.g. 5 of 7 days) so real life doesn't break it.

### 1.2 Challenges (P1)
Time-boxed, opt-in wardrobe challenges: *"wear 10 pieces you haven't touched in 3 months"*, *"one week, no repeats"*, *"30 wears, 10 items"* (a real capsule-wardrobe practice), *"shop nothing for 30 days."*
- **Why it fits:** every one of these is scored entirely from the wear log + item inventory. They are the natural bridge from *utility* ("what do I wear") to *engagement* ("here's something to try"), and they carry the sustainability angle the content strategy already leans on.
- **MVP seam:** wear log + `wardrobe_items.created_at`. A challenge is a definition + a scoring query; the durable part is a small `challenge_participation` table (additive) recording which challenge a user joined and when.
- **The trap:** challenges that require *buying* anything invert the product's value. Keep them all "use what you own."

### 1.3 Achievements (P2)
Milestones over real behaviour: *first 50 items digitized*, *100 wears logged*, *every item worn at least once*, *dead-stock cleared*, *first outfit built*.
- **Why it fits:** achievements are the read-model over the same rows challenges score, and "every item worn at least once" is a genuinely useful wardrobe goal, not a vanity badge.
- **MVP seam:** derivable entirely from `wear_log` + `wardrobe_items`. Store *awarded* achievements (so the award moment is stable and not recomputed differently later) in an additive table.
- **The trap:** don't award for *app opens* or *streak length alone* — reward wardrobe outcomes, or the mechanic becomes engagement-farming and reads cheap in a premium product.

### 1.4 Year in review / seasonal recap (P2)
An annual (and per-season) recap: most-worn piece, the item you bought and never wore, cost-per-wear leaders, colour distribution, how many outfits you built, your longest streak.
- **Why it fits:** this is the single most *shareable* artifact the wear log can produce, and it is the natural acquisition loop for a solo-utility app — a recap card is a screenshot people post. It also makes the moat legible to the user: "this is what a year of logging gave you."
- **MVP seam:** **the wear log shipping in the MVP is the entire prerequisite, and it is impossible to backfill.** A recap in year 2 is only possible because rows were collected in year 1. This is the strongest argument in this file for never cutting F8.
- **Depends on:** §2.3 (analytics read-models) for cost-per-wear.

### 1.5 Gentle re-engagement (P3, needs care)
A nudge when the closet has gone quiet, or when the weather turns and a whole category becomes relevant again ("it's coat season").
- **Why P3 and why careful:** requires push, which the MVP deliberately has **no** port for (`docs/06` §9: "No `NotificationPort` — no MVP feature needs push; its future addition is purely additive"). And notification tone is exactly where "advisory, never bossy" is easiest to violate.
- **MVP seam:** additive `NotificationPort` + Expo push. Nothing in the MVP blocks it; nothing in the MVP anticipates it either.

### 1.6 What this layer must NOT become
Recorded as a decision, not a worry:
- **No leaderboards against other users.** Comparing wardrobes is the anti-thesis of a product whose voice is "a stylish friend."
- **No streak-loss punishment, no shame copy, no red.**
- **No engagement metrics as achievements** (app opens, session length).
- **No body-composition or measurement tracking of any kind.** See §4 — that intent belongs to fitapp, and here it would collide with `CLAUDE.md`'s privacy invariant (body geometry is session-ephemeral, never a server-side twin).

---

## 2. Deferred product features (were in the original vision, cut from MVP)

Ordered roughly by expected value.

### 2.1 Virtual try-on (P3)
Record yourself; an AI model renders a chosen outfit on your body.
- **Why deferred:** the hardest thing in the product. Real-time garment-on-body rendering is research-grade; quality below a high bar reads as a gimmick and *damages* premium positioning. Also the heaviest escalation risk — **body geometry is biometric-adjacent.**
- **MVP seam:** the wardrobe stores a normalized front-view cutout per item — exactly the asset a try-on renderer consumes. No schema change needed to feed it.
- **Privacy rule that MUST survive to here:** body geometry is **session-ephemeral**, never a server-side "body twin," never used to identify, no bystander faces. This is non-negotiable and is stated in `CLAUDE.md`.

### 2.2 Gap-fill shopping + affiliate (P2)
Suggest outfits using 1–2 items you *don't* own, then recommend products that fill the gap.
- **Why deferred:** needs a product catalog + affiliate integration + a "what pairs with my wardrobe" recommender. Monetization path #2; don't split focus pre-launch.
- **MVP seam:** an outfit is already "a set of item slots." A gap is a slot filled by a *catalog* item instead of an *owned* one. `docs/06` §9 deliberately did **not** pre-build an `item_ref_type` discriminator — adding it plus `catalog_item_id` is a cheap additive migration.
- **Tension worth naming:** §1.2 challenges are all "use what you own." Affiliate revenue pushes the other way. Resolve that deliberately rather than letting the recommender drift.

### 2.3 Cost-per-wear & wardrobe analytics (P1 for the data, P2 for the screens)
Per-item cost-per-wear, most/least worn, dead stock (never worn), colour/category breakdowns, capsule scoring, "you re-wore X times, saved a purchase."
- **Why the split:** the analytics *screens* are deferred, but **the data that powers them is captured from day one** by the wear log. This is the single most important seam decision in the product.
- **MVP seam:** every wear is a row. Analytics is a read-model over rows already being collected. **Do not cut the wear log** — cheap to build, impossible to backfill.
- **Needs one additive thing:** cost-per-wear needs a per-item purchase price, which the MVP does not store. An additive nullable `price` column (or the freeform metadata in §2.7) is all it takes; the wear count is already there.

### 2.4 Social / closet-circle, light (P2)
Follow friends, see their closets/outfits, react. The gateway to §3.
- **Why deferred:** social is a different product surface with its own tenancy, moderation, and abuse profile. Solo utility must be proven first.
- **MVP seam:** RLS is FORCE + per-user from day one. Sharing later is a **new explicit grant path** (a share row), never a loosened default-deny.

### 2.5 Borrow / joint closets (P3)
Shared or borrowable closets — roommates, partners, sisters. "Can I borrow your black blazer this weekend."
- **MVP seam:** same as social — additive share-grant, never a change to per-user isolation.

### 2.6 Resale / decluttering (P2)
Flag low-cost-per-wear or never-worn items for resale; one-tap list to a marketplace or export.
- **MVP seam:** `wardrobe_items.availability` already has states; `for_resale` + a `listed_at` timestamp are additive.
- **Pairs naturally with** the dead-stock output of §2.3 and the declutter challenges in §1.2.

### 2.7 Fit ledger / sizing memory (P3)
Sizes per brand, fit notes ("runs small"), sizing-aware gap-fill recommendations.
- **MVP seam:** `wardrobe_items.attributes` is `jsonb`, so brand/size/fit notes can land there with **no migration at all**. A dedicated table is a clean later move if anything needs to query it.

### 2.8 Travel / packing (P2)
Destination + dates → weather-aware capsule packing list from the wardrobe, outfits pre-planned per day.
- **MVP seam:** the suggester is designed weather-aware (`WeatherPort` exists in `shared`). Packing is "run the suggester over a date range for a different location" + a checklist view. **Note the MVP has not actually wired weather into the mobile app yet** (`git grep -i weather -- packages/mobile` → 0 hits), so this depends on F5 being finished first.

### 2.9 Camera-based skin-tone / seasonal colour — graduate the beta (P3)
MVP ships the self-identified swatch quiz (B1). The deferred upgrade is optional camera-assisted undertone analysis, still **advisory, never prescriptive**, still user-confirmed.
- **Why deferred:** camera skin-tone detection is both a quality risk and an ethical/representational minefield; self-identification sidesteps both. `CLAUDE.md` states the rule: *"Skin tone is self-identified (swatch quiz), never camera-detected."* **Graduating this requires an explicit owner decision to relax a stated invariant** — do not treat it as a normal feature.
- **MVP seam:** the palette is stored as a *result* (a set of hues), decoupled from derivation. Swapping how it's derived changes nothing downstream.

### 2.10 Inspiration boards / style matching (P2)
Save inspiration (Pinterest-style), match a look to items you own, "recreate this outfit from your closet."
- **MVP seam:** attribute extraction already produces a normalized vocabulary (category/colour/pattern). Matching an inspiration image = parse it into the same vocabulary + nearest-neighbour over owned items.

### 2.11 Calendar integration & repeat-avoidance (P3)
"Don't repeat what you wore the last three times you saw these people." Log worn outfits against a calendar.
- **MVP seam:** the wear log already timestamps wears and groups outfit-wears by `outfit_id`. Calendar is a join to device calendar events + a "last worn with/for" query.

### 2.12 Stylist marketplace (P3)
Human stylists offer paid sessions / curated pulls from your real wardrobe.
- **Why far:** two-sided marketplace, payments to third parties, trust & safety. Long-horizon monetization #3.

---

## 3. The social poll feature (P3 — explicitly requested, needs the §2.4 substrate)

**The pitch:** you have an event coming up and can't decide what to wear. Start a group, invite people, and either:

1. **Outfit plans mode** — everyone sets what *they* plan to wear (nobody clashes, everyone's coordinated, you can see the vibe), or
2. **Poll mode** — you post a few candidate outfits from your wardrobe and the group **votes.**

**Shape:** a **group** scoped to an **event** (name, date, optional dress code / vibe) · members invited by link or in-app · each member may submit their own planned outfit · the owner may open a poll of N candidates · one vote per member (or ranked — a later decision).

**Why it is behind §2.4:** it depends on (a) the social/closet-circle substrate for identity + connections, and (b) real multi-user tenancy with invited cross-user read access — a genuine step up in the trust model. It is also the **viral loop**: an invite to vote on someone's outfit is organic acquisition. Worth building deliberately, once solo retention is proven.

**MVP seams that keep it cheap:** outfits are first-class shareable objects (a poll candidate is an outfit reference) · every item has a normalized cutout, so a planned outfit renders for others **without exposing the owner's full closet** · RLS default-deny means cross-user visibility is an explicit, auditable grant (group membership → scoped read of shared outfits only), never a loosened default. **That last one is the invariant not to trade away for convenience.**

**New escalation surface when built:** cross-tenant data sharing, content moderation, invite abuse, notification volume. All human-gated design decisions at that time.

---

## 4. Requested but belongs to fitapp — NOT this project

**The owner asked for running tracking, Strava integration, yoga tracking, and mobility tracking.** Recorded here so the request is not lost — and recorded *as out of scope* so it is not mis-built here.

**These belong to the sibling project [fitapp](../../fitapp), not to a wardrobe app.**

| Request | Where it belongs | Why not here |
|---|---|---|
| **Running tracking** | fitapp | Needs GPS traces, pace/distance/elevation, workout sessions. Nothing in this schema is shaped for time-series activity, and a wardrobe app has no reason to hold location history — which would directly conflict with the privacy posture (`privacy-policy.md` currently promises location is used only for weather, device→provider, never stored by us). |
| **Strava integration** | fitapp | A third-party *fitness* activity provider. Adding it here would mean a new OAuth surface, a new sub-processor in the privacy policy, and a data category (workout + location history) the app has no product use for. |
| **Yoga tracking** | fitapp | Session/practice logging against a training plan. The overlap with wardrobe is zero. |
| **Mobility tracking** | fitapp | Range-of-motion / flexibility measurement over time. This is **body measurement**, which collides head-on with `CLAUDE.md`'s privacy invariant: *"body geometry is session-ephemeral — no server-side body twin, no biometric identity."* Building persistent body metrics here would violate a stated non-negotiable. |

**Why the split is worth being firm about.** Both apps are the same owner's, both are Expo/pnpm/Supabase, and both live under `~/Documents/temp1/` — so the temptation to fold one into the other is real and has already caused a concrete accident: a UI screenshot audit for closet-app **photographed fitapp's running app** because both use Metro port 8081 (see `07-ui-state.md` §5.2). Merging the domains would multiply that class of confusion. A wardrobe app that also tracks your runs is two products in one binary, with two privacy postures, one of which (persistent body/location data) is the exact thing this app's ABLATE-tier promise rules out.

### What DID translate — the intent, not the domain

The requests were not discarded; the *mechanics* behind them were translated. Fitness apps retain users through habit loops, and that pattern is domain-independent even when the data is not. Everything in **§1** was derived from these requests:

| Fitness mechanic requested | Wardrobe-native equivalent (see §1) |
|---|---|
| Workout streaks | **§1.1 Wear streaks** — F8's daily one-tap log is already the same shape as a daily workout log. |
| Training challenges / programs | **§1.2 Challenges** — "one week no repeats", "30 wears 10 items", "shop nothing 30 days". Time-boxed, opt-in, scored from real behaviour. |
| Personal records / badges | **§1.3 Achievements** — over wardrobe outcomes (every item worn once, dead stock cleared), never over app opens. |
| Strava's annual recap / activity feed | **§1.4 Year in review** — the recap card is the shareable artifact and the organic acquisition loop. The *social feed* half of Strava maps to §2.4 + §3, not here. |
| Habit reminders | **§1.5 Gentle re-engagement** — deliberately P3 and deliberately constrained by "advisory, never bossy". |

So: **the retention intent belongs here; the fitness domain belongs in fitapp.** If the owner wants running/yoga/mobility built, that work is a fitapp task and should be requested against that repo.

---

## 5. The one rule this file enforces on the MVP

Every MVP decision should be checkable against: **"does this make any future feature *impossible* or *expensive-to-retrofit*, when an additive change would have kept it cheap?"** The seams that matter most:

1. **The wear log ships in the MVP** (data moat — impossible to backfill; and it is the prerequisite for §1.1–§1.4 and §2.3 all at once).
2. **RLS is FORCE + default-deny per user from commit one** (social / poll / event / borrow all become additive *grants*, never a loosening).
3. **Outfits and item-cutouts are first-class, self-contained objects** (try-on, polls, event-sharing, and recap cards all consume them unchanged).
4. **`wardrobe_items.attributes` is `jsonb`** (fit notes, brand, size, price all land with no migration).

Beyond protecting those, **do not build for the future.** Simplicity first.
