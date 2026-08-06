# Roadmap — the future map

> **⚠️ DO NOT IMPLEMENT IF YOU ARE AN AGENT.**
> Nothing in this file is in scope. It exists so that MVP decisions are made *knowing where the product is going* — so we don't paint ourselves into a corner. The MVP scope lives in [`01-product-requirements.md`](./01-product-requirements.md); build only what is there. If a task references this file, it is for **context on why an MVP seam exists**, never as a work item. When in doubt: this is the "someday," not the "now."

The point of writing the far future down: the schema, the provider seams, and the tenancy model in the MVP should not *preclude* any of this. Each entry below notes the **MVP seam** that keeps it cheap to add later — that seam is the only thing the MVP owes the future.

---

## Horizon 1 — deferred features (natural next steps after MVP)

These were in the original vision and are deliberately cut from the MVP to keep it day-sized and shippable. Ordered roughly by expected value.

### 1. Virtual try-on
Record yourself; a live AI model renders a chosen outfit on your body.
- **Why deferred:** the hardest thing in the whole product. Real-time garment-on-body rendering is a research-grade problem; quality below a high bar reads as a gimmick and hurts the premium positioning. Also the heaviest escalation risk — **body geometry is biometric-adjacent** (see privacy invariants).
- **MVP seam:** the wardrobe stores a normalized front-view cutout per item — exactly the asset a try-on renderer consumes. No schema change needed to *feed* try-on later.
- **Privacy rule that MUST survive to here:** body geometry is session-ephemeral, never a server-side "body twin," never used to identify. No bystander faces.

### 2. Gap-fill shopping + affiliate monetization
Suggest outfits that use 1–2 items you *don't* own, then recommend products to buy that fill the gap (affiliate links).
- **Why deferred:** needs a product catalog + affiliate integration + a "what pairs with my wardrobe" recommender. Monetization path #2 after subscription; don't split focus pre-launch.
- **MVP seam:** the outfit model already represents "an outfit is a set of item slots." A gap is just a slot filled by a *catalog* item instead of an *owned* item. Keep the outfit-item join table polymorphic-ready (an item reference that could point at owned OR catalog) without building the catalog now.
- **Escalation:** affiliate = money-adjacent but not entitlement; still, revenue attribution is a human-gated design.

### 3. Cost-per-wear & wardrobe analytics
Per-item cost-per-wear, most/least worn, "dead stock" (never worn), color/category breakdowns, capsule-wardrobe scoring, sustainability angle ("you've re-worn X times, saved a purchase").
- **Why deferred as a *surface*:** the analytics *screens* are deferred, but the **data that powers them is captured from day one** by the MVP wear log. This is the single most important "seam" decision in the whole product.
- **MVP seam:** the daily wear log (an MVP feature) is the data moat. Every wear is a row. Analytics later is a read-model over rows we're already collecting. **Do not** cut the wear log to save time — it's cheap to build and impossible to backfill.

### 4. Social / closet-circle (light)
Follow friends, see their closets/outfits, react. The gateway to the poll feature (Horizon 2).
- **Why deferred:** social is a different product surface with its own tenancy, moderation, and abuse considerations. Solo utility must be proven first.
- **MVP seam:** RLS is FORCE and per-user from day one. Sharing later = a new grant path (an explicit share row), never loosening the default-deny. Design the wardrobe/outfit tables so a future `visibility` or share-grant table is additive.

### 5. Borrow / joint closets
Shared or borrowable closets (roommates, partners, sisters). "Can I borrow your black blazer this weekend."
- **MVP seam:** same as social — additive share-grant, never a change to the default per-user isolation.

### 6. Resale / decluttering
Flag low-cost-per-wear or never-worn items for resale; one-tap list to a marketplace (or export). Sustainability + declutter loop.
- **MVP seam:** item state already has availability states; a `for_resale` state and a `listed` timestamp are additive columns.

### 7. Fit ledger / sizing memory
Remember sizes per brand, fit notes ("runs small"), body-measurement-aware sizing so gap-fill recommends the right size.
- **MVP seam:** items can carry freeform brand/size metadata now (cheap), even if nothing reads it yet — or leave it out; it's a clean additive table later.

### 8. Travel / packing
Pick a destination + dates → weather-aware capsule packing list drawn from the wardrobe; outfits pre-planned per day.
- **MVP seam:** the outfit suggester is already weather-aware (MVP v1 heuristic). Packing is "run the suggester over a date range for a different location" + a packing checklist view.

### 9. Skin-tone / seasonal color (camera-based) — graduate the beta
MVP ships self-identified swatch quiz (beta). The deferred upgrade is optional camera-assisted undertone analysis, still **advisory, never prescriptive**, and still user-confirmed.
- **Why deferred:** camera-based skin-tone detection is both a quality risk and an ethical/representational minefield; self-identification sidesteps both. Only graduate if it measurably beats the quiz *and* we can do it respectfully.
- **MVP seam:** the palette is stored as a result (a set of flattering hues), decoupled from *how* it was derived. Swapping the derivation later changes nothing downstream.

### 10. Inspiration boards / style matching
Save inspiration (Pinterest-style), match a look to items you own, "recreate this outfit from your closet."
- **MVP seam:** garment attribute extraction already produces a normalized vocabulary (category, color, pattern). Matching an inspiration image = parse it into the same vocabulary + nearest-neighbor over owned items.

### 11. Calendar integration & outfit logging to avoid repeats
"Don't repeat what you wore to the last three times you saw these people." Log worn outfits against a calendar.
- **MVP seam:** the wear log already timestamps wears. Calendar is a join to device calendar events + a "last worn with/for" query.

### 12. Stylist marketplace
Human stylists offer paid sessions / curated pulls from your real wardrobe.
- **Why far:** two-sided marketplace, payments to third parties, trust & safety. Long-horizon monetization #3.

---

## Horizon 2 — the social poll feature (explicitly requested)

**The pitch:** you have an event coming up and you can't decide what to wear. Start a group, invite people, and either:

1. **Outfit plans mode** — everyone in the group sets what *they* plan to wear to the event (so nobody clashes / everyone's coordinated / you can see the vibe), OR
2. **Poll mode** — you post a few candidate outfits (pulled from your wardrobe, using the existing outfit builder) and the group **votes** on what you should wear.

**Shape:**
- A **group** is scoped to an **event** (name, date, optional dress code / vibe).
- Members are invited (link or in-app).
- Each member can **submit their own planned outfit** (drawn from their wardrobe or a photo) — that's the "coordination" use case.
- The event owner can **open a poll**: N candidate outfits, members vote, results are visible (live or on close).
- Votes are one-per-member (or ranked — design decision for later).

**Why it's Horizon 2, not Horizon 1:** it depends on (a) the social/closet-circle substrate (Horizon 1 #4) for identity + connections, and (b) real multi-user tenancy with invited cross-user read access — a genuine step up in the trust model. It's also the **viral loop**: an invite to vote on someone's outfit is an organic acquisition channel. Worth building deliberately, once solo retention is proven.

**MVP seams that keep it cheap:**
- Outfits are first-class, shareable objects (an outfit = a set of item slots + a render). A poll candidate is just an outfit reference.
- Wardrobe items each have a normalized front-view cutout, so a "planned outfit" renders cleanly for others without exposing the owner's full closet.
- RLS default-deny per user means cross-user visibility is an **explicit, auditable grant** (group membership → scoped read of shared outfits only), never a loosened default. **This is the invariant that must not be traded away in the MVP for convenience.**

**New escalation surface when this is built:** cross-tenant data sharing, content moderation, invite abuse, and notification volume. All human-gated design decisions at that time.

---

## Horizon 3 — far forward: event planning (Partiful-style)

The event object from the poll feature grows into a full **event-planning surface**, in the spirit of Partiful:

- Rich event pages: cover **pictures**, theme, location, time, RSVP.
- Guests RSVP, see the dress code / vibe, and plan outfits *in context of the event*.
- Photo sharing after the event (what everyone actually wore) — which feeds back into wardrobes ("add what you wore that night to your closet") and the wear log.
- The wardrobe app becomes the reason you open an event invite: *"what am I going to wear to this?"* is answered inside the same app that's hosting the event.

**Why this is the north star's edge:** it fuses the two loops — the utility loop (my closet, my outfits) and the social loop (our event, what we're all wearing) — into a single product where the event *is* the occasion to use the closet, and the closet *is* the reason the event app is sticky. That's a defensible position no pure-utility closet app or pure-social event app holds alone.

**This is a destination, not a plan.** Everything here is years of product away and will be re-specced from scratch when the time comes. Recorded here only so today's schema and tenancy choices don't foreclose it.

---

## The one rule this file enforces on the MVP

Every MVP decision should be checkable against: **"does this make any Horizon feature *impossible* or *expensive-to-retrofit*, when an additive change would have kept it cheap?"** The three seams that matter most:

1. **The wear log ships in the MVP** (data moat — impossible to backfill).
2. **RLS is FORCE + default-deny per user from commit one** (social/poll/event all become additive grants, never a loosening).
3. **Outfits and item-cutouts are first-class, self-contained objects** (try-on, polls, and event-sharing all consume them unchanged).

Beyond protecting those three seams, **do not build for the future.** Simplicity first.
