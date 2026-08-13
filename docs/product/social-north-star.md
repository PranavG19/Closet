# Social North Star — the private social wardrobe

*Vision synthesis. This is theory, not a build plan. It builds ON `roadmap.md` (§1.6, §2.4, §2.11, §3, Horizon 3) and is governed by the privacy invariants in `CLAUDE.md` and `docs/00` §"Non-negotiable invariants." Nothing here is in MVP scope; F1/F2/F3/B1 and the rest of the MVP come first.*

---

## 1. North Star

**closet-app becomes the only wardrobe app that is social without ever sharing a photo of you** — where the unit of connection is not a post but an *Ask* ("I can't decide — which of these should I wear?") that your few real people answer in ten seconds, and that resolves into a memory on a shared calendar. The market splits cleanly today: closet utilities (Whering, Acloset, Indyx, Cladwell, Pureple) are solo spreadsheets with cutouts, and social apps (Instagram, Pinterest) are performance to strangers where getting dressed becomes a bid for likes. We own the unclaimed middle — *getting ready together with the people whose eye you actually want* — and we can hold it because the thing we share is a **composed outfit of cutouts on a neutral canvas**, an object that structurally cannot carry a face, a body, a bedroom, or a bystander. Privacy stops being the tax on social features and becomes the reason ours feel safe when everyone else's feel like surveillance: you literally cannot overshare, because the substrate never held the oversharable thing.

## 2. The core social loop — "borrow your friends' eyes for 30 seconds"

The atomic unit is one **Ask**, not a group, a feed, or a recurring thing. The whole product's social value can be delivered by this single loop; everything else in §3–§4 is an elaboration of it. As a user journey:

1. **Compose.** She opens the outfit builder (F6) and picks 2–4 candidate looks. The most common real dilemma — and the sharpest shortcut — is candidates that vary by *one accessory*: "same dress, which necklace?" That makes candidates feel distinct without building four whole outfits, and it makes the Ask itself trivial to create.
2. **Frame.** One line of context, optional forecast: "outdoor, 8pm, cold." Voters judge with the same information she has, not blind. (Weather is a lookup, never tracking — see §4.)
3. **Send.** To a small, hand-picked set of mutual friends — never a broadcast, never a public post. Invite-by-link is the acquisition loop: a friend asked "which should I wear?" is the warmest, least spammy install prompt a wardrobe app can send.
4. **Vote.** One tap to **pick the one you'd wear**. Not a 1–5 score, not a like — a *pick*. Optional one-line "why" ("the blue one, it's more *you*"). ~10 seconds for the voter. A pick is a gift; it never grades a person, only chooses an outfit for an occasion.
5. **Resolve + payoff.** She decides (the tally is private to her — the vote informs, it doesn't rule). Later she drops **one** afterward photo through the same on-device gate — "wore B, was perfect." Voters get a gentle "she wore the one you picked — here's the night." **That last beat is the retention engine**: it closes the *voter's* loop too, so people open the app to be useful to friends and to see how the night they helped with went — not to be seen.

Why this and not a feed: Instagram broadcasts and moves on; it never closes the decision. Closing the loop — uncertainty → help → wear → proof — is the emotional core no competitor offers, and it degrades gracefully to a single friend or even a **self-Ask** ("sleep on it, decide in the morning") when the friend graph is empty. The app stays fully valuable solo; social is pure upside layered on the utility spine.

## 3. The unified calendar — the spine

There is a diary already sitting in the schema that no one has been shown. Every `wear_log` row (`user_id, item_id, outfit_id, worn_at`, append-only by construction — INSERT+SELECT policies only, no UPDATE/DELETE) is a dated entry in a style journal the app currently renders only as a data moat. The unified calendar is the read-model that turns that fact stream into a **living style diary**, and the same spine forward-projects into planning, events, and Asks. It is the one surface that fuses solo utility with the social layer — social is an *annotation on the utility spine*, never a separate app or a second tab.

The governing conceptual seam, which respects the append-only model exactly: **the past is immutable fact; the future is mutable intention.**

- **Past days** render what she actually wore — a pure read over `wear_log`, never mutated. A day with an event shows the event *and* the outfit she wore to it. This is the North Star made literal: "the dress I wore to Maya's wedding," not a stat. It reframes the one-tap wear log from a chore into something she *wants* to scroll back through, and it's the strongest possible argument for why F8 can never be cut — the calendar is impossible to backfill.
- **Future days** render *planned* outfits and upcoming Asks/events. This needs exactly one new additive primitive: a mutable `day_plan` (an outfit reference against a date), because you change your mind. When a planned day arrives and she confirms she wore it, the plan collapses into an appended `wear_log` row. Plans are intentions; wears are facts.

**Planning must never become a chore.** An empty future is a valid, unshamed state. A calendar that demands you fill tomorrow is a to-do list and violates "advisory, never bossy" (§1.6). Planning is *invitational and event-triggered*: the reason to plan ahead is a real occasion, and the social pull ("poll my friends on the wedding look") is what makes planning desirable rather than obligatory. Trips are just planning across a date range in a different location.

## 4. Accessories + weather — extending the outfit model

**Accessories are additive garnish, not new required slots.** The schema already has one `accessory` category and an `attributes` jsonb column. Do **not** explode the enum into jewelry/hat/bag — that would force a warmth decision per new category in the F5 heuristic and complicate a deliberately simple model. Put the accessory *subtype* in `attributes` (no migration). An outfit stays valid with zero accessories; in the builder, after core slots are set, an optional "finish it" tray suggests one or two harmony-matched pieces; in the daily suggestion they appear as a soft secondary line ("add: gold hoops, a tan belt"), never blocking. Accessories earn their place three ways: they make the calendar richer, they make the vote meaningful ("gold hoops or none?" is the perfect A/B), and they are the *highest-signal, gentlest carrier of color advice* — D-003's research says simultaneous contrast is strongest at the face, so face-adjacent accessories (jewelry, scarf, sunglasses) let the palette nudge be precise without restyling a whole outfit.

**Weather is already modeled honestly — wire it, don't expand it.** `WeatherPort` is keyless, takes lat/lon only, carries no credential, returns `{tempC, condition}`, and is not yet wired into mobile (F5 must finish first). Keep it coarse: rounded coordinates, one call per session, **no location row ever stored** (the privacy policy promises device→provider-only, never a trail). Today: condition biases the suggestion (rain → favor outerwear + an umbrella nudge; cold → raise the warmth threshold F5 already sums). For a future event, the forecast is a *lookup against the event's typed city and date* — a query, never GPS tracking. Theme + weather + accessories compound into a question no competitor can pose from structured data: "cocktail theme, 4°C and rain in Chicago Saturday — which of these three, and do I need the wrap?"

## 5. The privacy architecture

Everything above rides on cutouts and explicit grants, so it respects the ABLATE-tier invariant by construction rather than by policy. Concretely:

- **The shareable atom is a composed outfit of cutouts, never a photograph of a person.** An Ask, a poll candidate, a planned look, a shared event outfit — all render for others as cutouts on a neutral canvas. They were never photos of a body, so they cannot leak one. This is the whole superpower; it is not negotiable for convenience.
- **Sharing is an additive, auditable grant — never a loosened default-deny.** RLS stays FORCE + per-user (invariant #4). A share is a new row (`outfit_share`) that joins group/Ask membership to *specific shared outfit IDs only*. The policy can never widen to the owner's wardrobe or closet. There is no code path that grants closet-wide read.
- **Invite-only, small, reciprocal audiences. No public feed, no followers, no discovery of strangers, no profile to scroll.** The only social surfaces are Asks addressed to you, your own Asks, and shared event calendars. Intimacy is the design; a comparison surface is the failure mode.
- **Two photo pipelines, kept architecturally distinct — this is the sharpest risk.** The wardrobe pipeline (camera-roll scan → on-device gate → cutout) and the *afterward-photo* pipeline (the owner's "add pictures afterwards") must never be the same code path. An afterward photo routes through **its own on-device gate**, is per-photo opt-in, event/group-scoped, and **never auto-parses into anyone's wardrobe.** The wear-log link to an event is the wearer tagging *her own already-logged outfit* — not extracting garments from a group shot. Bystander faces are a hard block. Strong recommendation: the *default* event recap is Look Cards (photo-free, on-brand, and simpler); real camera photos are the most-constrained surface in the app and should be deferred well past launch, if built at all.
- **Ephemeral by default; deletion is trivial.** An Ask/vote can auto-expire after the occasion; the grant row is dropped and voters lose access. What she keeps is the outcome on her own private calendar. Because a share is only a grant, full deletion is dropping a row — the cutouts were always hers and never moved.
- **Skin tone stays self-identified (B1 swatch quiz), never camera-detected.** Nothing in the social layer touches this.
- **No server-side body twin, ever.** Try-on stays roadmap-only and session-ephemeral; no social feature introduces a body geometry seam.

## 6. Differentiation

- **Versus closet utilities (Whering, Acloset, Indyx, Cladwell, Pureple):** they are solo. They *cannot* add bounded, safe outfit-sharing because they upload whole photos and whole closets — sharing there means exposing. We share a derived, user-authored artifact by explicit grant. The social loop and the shared calendar are things they structurally cannot copy without rebuilding on a cutout + on-device-gate foundation they never laid.
- **Versus social apps (Instagram, Pinterest):** they broadcast to strangers and never close the decision loop; getting dressed becomes performance and comparison. We are invite-only, pick-not-score, private-tally, and we *resolve* — the emotional opposite of an applause meter. There is no follower count to chase.
- **The defensible one-liner:** *a trusted friend group helping you get dressed, structurally incapable of becoming a surveillance feed.* Privacy-by-structure is the enabler, not the obstacle — and it is the moat, because it took the whole MVP architecture (on-device gate, cutout-only cloud, RLS default-deny, first-class outfits) to earn the right to say it.

## 7. Phased proposal

*Effort tags are relative (S/M/L). Privacy impact is stated for each. Sequencing principle: deepen the solo relationship first; social is the on-ramp, not the foundation. Everything is behind the MVP shipping and retaining.*

### Simplest first — the smallest slice that delivers the magic

1. **Read-only style diary (agenda view).** [S] A vertical scroll of past days, each rendering the outfit worn that day from `wear_log`. Today's F5 suggestion is the cursor at the writing head; logging a wear writes the day. **Zero schema change, zero new privacy surface** — a pure read over rows already collected. Start agenda, not a cutout-dense month grid (the render harness can't composite cutouts, per session findings; a grid is heavy). This alone makes the moat legible: "this is what a year of logging gave me."
2. **The self-Ask + solo A/B/C/D compose.** [S] Reuse F6 to save 2–4 candidates and frame one line of context, resolved by *herself* ("sleep on it"). No multi-user, no grants — this proves the compose/decide UX and the accessory-variant shortcut before any sharing exists. **No privacy surface.**
3. **Wire weather into F5 + the diary.** [S] Coarse, session-only, no stored location. **Privacy impact: none if the no-stored-location rule holds** (rounded coords, one call/session).

### Deeper

4. **Accessories as jsonb subtype + "finish it" tray + color nudge.** [M] No migration; enriches builder, diary, and future votes. **No new privacy surface** (accessories are just more cutouts).
5. **The multi-user Ask (share to friends, one-tap vote, resolve payoff).** [M] Introduces the first cross-tenant read: the `outfit_share` additive grant + invite-by-link + private tally + the "she wore your pick" payoff. **Privacy impact: real and significant** — first cross-tenant sharing, invite abuse, notification volume; the RLS grant must be per-candidate-outfit only. Human-gated design at build time. Notifications are batched and quiet (the MVP has no NotificationPort; adding one is where "advisory" is easiest to break).
6. **Future-day planning (`day_plan`) + event days on the calendar.** [M] The mutable-intention half of the spine; a plan collapses into a wear_log row on confirmation. **Low privacy impact** (own-tenant plans).

### Later

7. **Events with themes + coordinated "plans mode."** [L] A shared date + name + optional theme/dress code + invited set that aggregates everyone's Asks and plans for one occasion. Theme reframes the vote from "does this suit me" to "which is most *garden-party*" — safer, more playful, real coordination value. **Privacy impact: moderate** — group tenancy, scoped to the invited set.
8. **Shared event memory page (Look Cards first).** [L] The Partiful-style payoff — everyone's looks collected for the occasion, photo-free by default. **Privacy impact: moderate**, bounded to the invited set.
9. **Afterward camera photos (only if ever).** [L] The one real-photo case, through a *distinct* on-device event gate, per-photo opt-in, group-scoped, bystander-face hard-block, never parsed into a wardrobe. **Privacy impact: highest in the entire app** — treat as the most-constrained surface, not a mini-Instagram. Likely defer indefinitely; the Look-Card recap may make it unnecessary.

## 8. Anti-patterns to refuse

- **A public feed, follower counts, public like-counts, or stranger discovery.** Converts a private relationship into performance — the exact thing the soul rejects. Structurally excluded by invite-only groups + cutout-only sharing.
- **Voting as a score or a popularity contest.** Pick, never rate; private tally, never public; closable/expiring, never a running scoreboard. Care, not applause. No candidate is shamed as "losing."
- **Notification nagging.** Asks are quiet invitations, batched, never alarms. "Advisory, never bossy" applies doubly to the viral loop.
- **Body/face photos in the wardrobe surface, or an afterward-photo backdoor into the wardrobe.** The two photo pipelines never merge.
- **Location history.** The moment a location row persists, we've adopted the posture this app rejects. Ephemeral, coarse, typed-for-future only.
- **Smuggling the deferred stats back in.** The owner cut wear-count statistics and "haven't-worn-this-in-a-while" nudges. The diary describes what you *wore*; it never scolds about what you *didn't*.
- **Leaderboards / gamified shame** (already banned §1.6) — extended to the social layer.

## 9. Open questions for the owner

1. **Vote visibility — tally private to the asker, or visible to voters?** Recommendation: private to the asker, to keep it "help me decide" not "watch the results roll in." Owner call; it shapes the whole emotional frame.
2. **Afterward camera photos — build the distinct event-photo gate, or ship Look-Card recaps only?** This is the single biggest privacy decision and **would need a new ADR** (a second on-device gate + a real-photo pipeline is a new privacy surface). Strong recommendation: Look-Cards-only for a long time; defer real photos.
3. **Cross-tenant sharing model — confirm the `outfit_share` additive-grant design** (per-outfit, per-invite, expiring) before any social code. This is a genuine step-up in the trust model (§2.4/§3) and **warrants an ADR** for the RLS grant shape and invite-abuse posture.
4. **The one new schema primitive — approve `day_plan`** (mutable planned-outfit-against-a-date) as the only new table the calendar spine needs. Everything else reads existing rows.
5. **Accessory model — confirm jsonb subtype over an enum expansion.** Low-stakes but sets a precedent for how the outfit model grows.
6. **Notifications — when the Ask loop lands, approve an additive `NotificationPort` + the batched/quiet tone contract.** Where "advisory, never bossy" is easiest to violate.
7. **Sequencing — is the read-only diary an acceptable first social-adjacent slice to ship before any multi-user work?** It delivers depth with zero privacy surface and is the natural on-ramp; confirm it's not pulling focus from finishing the MVP.
