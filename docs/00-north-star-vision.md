# 00 — North-Star Vision

*The destination and the "why." For scope you can build now, see [`01-product-requirements.md`](./01-product-requirements.md). For everything explicitly out of scope, see [`roadmap.md`](./roadmap.md).*

---

## The one-line thesis

**A woman points the app at her camera roll, sees her real closet digitized in ~30 seconds, and pays — because the use case is obvious and the aha is immediate.**

We are the **premium** option in a category with free competitors. We win on the quality of the first 60 seconds and on a wardrobe that stays effortlessly useful every morning.

## Who it's for

Women who care about what they wear and own more than they can hold in their head. The wardrobe has outgrown memory: clothes get forgotten, re-bought, or never worn. She doesn't want a spreadsheet — she wants her closet to *answer questions*: "what do I wear today," "does this go together," "what's clean," "what do I actually own."

## The aha, engineered

The conversion thesis is a **controlled reveal**, not a slow build:

1. **Scan.** She grants photo access (or imports specific photos). An **on-device gate** filters out intimate / non-her photos *before anything leaves the device* — a privacy promise that is also a trust moment.
2. **Process (teaser).** A processing animation runs. We parse **only a handful** of items in real time — enough to render one convincing preview of her digitized closet.
3. **The wardrobe appears.** She sees *her actual clothes*, cut out and organized, almost immediately. This is the aha.
4. **Hard paywall.** No free trial. The value is already visible; the ask is to unlock the full closet + the daily utility.
5. **Full parse after payment.** The rest of the camera roll is parsed during the full onboarding flow — so we never spend cloud-parse dollars on someone who won't pay, and the heavier-quality work happens where it's already committed.

The make-or-break lever is **parse quality**, not paywall mechanics. If the cutouts and attributes are convincing, the aha lands and she pays. Everything in engineering serves that.

## Why we win (the moat)

1. **The first 60 seconds.** Instant, private, high-quality digitization is hard; most free apps make you photograph items one by one. We turn a camera roll into a closet.
2. **The data moat.** The daily **wear log** — what she actually wore, when — is data that (a) makes every suggestion better over time, (b) powers cost-per-wear and analytics later, and (c) **cannot be backfilled** by a competitor. Every day of use deepens the moat.
3. **The retention loop.** "What do I wear today" is a *daily* question. A weather-aware suggestion + a one-tap wear log makes the app a morning habit, not a one-time novelty.
4. **The far edge (see roadmap).** Fusing the utility loop (my closet) with a social/event loop (what we're all wearing to this thing) is a position neither a pure closet app nor a pure event app can hold. Years away, but it's the reason the architecture protects social/event seams from day one.

## The full feature universe

What the product *becomes*. **Bold = MVP.** Everything else is [`roadmap.md`](./roadmap.md) and must not be built by an agent now.

**Ingestion & wardrobe**
- **Camera-roll scan with on-device privacy gate + manual photo import.**
- **AI garment parsing → normalized front-view cutout + attributes (category, color, pattern) per item.**
- **Wardrobe library — browse, filter, the digitized closet.**
- **Dedupe by pick — when two photos look like the same item, show both and let her keep one or keep both (they're genuinely different).**

**Daily utility**
- **Outfit suggestions — weather-aware, heuristic v1, from what's currently available/clean.**
- **Manual outfit builder — compose and save outfits.**
- **Availability tracking — clean / dirty / unavailable, intuitive marking; suggestions respect it.**
- **Daily wear log — one-tap "I wore this," the retention loop and data moat.**
- **Garment-to-garment color harmony — rules-based (ships).**
- Skin-tone / seasonal palette — *self-identified swatch quiz, beta.*

**Deferred (roadmap):** virtual try-on · gap-fill shopping + affiliate · cost-per-wear & analytics · social / closet-circle · borrow / joint closets · resale / declutter · fit ledger / sizing · travel / packing · camera-based skin-tone · inspiration boards & style matching · calendar & repeat-avoidance · stylist marketplace.

**Horizon 2 (roadmap):** social **poll feature** — group up for an event; everyone sets their planned outfit *or* the host polls a few candidates and the group votes.

**Horizon 3 (roadmap):** Partiful-style **event planning** — rich event pages with pictures, RSVP, dress code, post-event photo sharing that feeds back into wardrobes.

## Positioning & monetization

- **Premium subscription** is the primary and, at launch, only revenue line. Hard paywall, no free trial. Free competitors exist; we are the one that's actually pleasant and actually works on day one.
- Future lines (roadmap, do not build): affiliate gap-fill shopping, resale, stylist marketplace.

## Aesthetic north star

For women. **Light theme.** Pink / red / blue accent highlights on a clean, mostly-neutral canvas. Minimal, lots of breathing room, clean typography. The clothes are the content — the UI recedes so the wardrobe shines. Full tokens and components in [`03-design-system.md`](./03-design-system.md).

## Non-negotiable invariants (survive to every horizon)

These come from the privacy promise and the agent-arch safety model. They are not features; they are constraints every feature is built under.

1. **Photos are filtered on-device before upload.** Intimate / non-her images never leave the phone. The cloud only ever sees user-approved photos.
2. **Body geometry (try-on, later) is session-ephemeral.** No server-side body twin, no biometric identification, no bystander face templates.
3. **Skin tone is self-identified, never covertly detected.** Advisory, never prescriptive — she can wear whatever she wants.
4. **Per-user data isolation is default-deny and structural** (Postgres RLS FORCE). Every future sharing feature is an *additive, auditable grant* — never a loosening of the default.
5. **The money/entitlement path is human-reviewed.** Agents build and verify it but never ship it autonomously.
6. **The wear log ships in the MVP** and is never cut — it's the one dataset that can't be backfilled.

*See [`02-engineering-requirements.md`](./02-engineering-requirements.md) for how each invariant is made structurally unrepresentable rather than merely tested.*
