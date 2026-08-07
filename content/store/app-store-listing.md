# App Store Connect listing — field pack (DRAFT, not submitted)

**Status:** unpublished draft. Submission is a human step (irreversible, outward-facing — `docs/LAUNCH-READINESS.md` §5, §7 step 10).
**Every character count below was counted, not estimated** (see `content/store/README.md` § "How the counts were produced").

> **Two blockers you must read before using any copy on this page:**
>
> 1. **`[App Name]` is a literal token, not a name.** The product has no name (`docs/LAUNCH-READINESS.md` §4). The token is kept everywhere the name goes, deliberately. Because the App Store **name field is 30 characters and the subtitle is 30**, and the token's real length is unknown, **every count on this page that includes `[App Name]` is provisional** — see § "Character budget risk" below. Do not paste any name-bearing field into App Store Connect until the name lands and the counts are re-run.
> 2. **The on-device screening line cannot ship yet.** See § "BLOCKER — the privacy claim". The classifier does not exist in any form.

---

## Character budget risk — read before trimming anything

| Field | Store limit | This draft | Fixed (non-token) part |
|---|---|---|---|
| App name | 30 | **28** with the token | `: Closet & Outfits` = **18 chars** |
| Subtitle | 30 | **28** | no token — count is final |
| Promotional text | 170 | **164** | no token — count is final |
| Description | 4000 | **3187** | contains the token twice |
| Keywords | 100 | **98** | no token — count is final |
| What's New | 4000 | **543** | contains the token once |

**The arithmetic that matters:** the name field is `<real name>` + `: Closet & Outfits`. That suffix is 18 characters, so **the real name must be ≤ 12 characters** to keep the descriptor. The placeholder token `[App Name]` happens to be 10 characters, which is *shorter than most real product names* — so the 28-char count is optimistic, and a longer name will overflow before the descriptor does.

Three fallback name forms, in order of preference, so whoever fills the name in has a decision already made:

| If the real name is… | Use | Fixed part |
|---|---|---|
| ≤ 12 chars | `[App Name]: Closet & Outfits` | 18 |
| 13–22 chars | `[App Name]: Closet` — drops `Outfits` from the name; add `outfits` to the keyword field | 8 |
| > 22 chars | `[App Name]` alone; the subtitle must carry all category signal, and the keyword field must be re-cut because the words it currently avoids are no longer indexed by name | 0 |

**This last row is the trap:** the keyword field below deliberately omits words that appear in the name/subtitle (Apple indexes those already). If the name shrinks to just the name, `closet` and `outfits` stop being indexed by the name field and **must be added back to the keyword field**, which then needs 15 characters freed. Re-derive, don't assume.

---

## 1. App name — limit **30** · this draft **28**

```
[App Name]: Closet & Outfits
```

- Counted: 28 characters including the 10-character token, both spaces, the colon and the ampersand.
- `&` is used rather than "and" to save 2 characters.
- Rationale: the name field is the single heaviest ASO signal, so it carries the two highest-intent category nouns (`Closet`, `Outfits`). See `aso-keyword-plan.md` for why these two and not `Wardrobe`.

## 2. Subtitle — limit **30** · this draft **28**

```
Wardrobe planner from photos
```

- Counted: 28 characters.
- Carries `Wardrobe`, `planner`, and `photos` — three indexed terms the name field does not contain, and the differentiator (`from photos`) in the same breath.
- **Alternates, counted, if the name overflows and the subtitle has to absorb more:**
  - `Your wardrobe, from photos` — 26
  - `Wardrobe from your camera roll` — 30 (exactly at the limit; zero headroom, and localisation will break it)
  - `Closet & outfit planner` — 23 (only use this if the name drops the descriptor)

## 3. Promotional text — limit **170** · this draft **164**

```
Point it at your camera roll and watch your own clothes appear, cut out and organized. Screened on device first — only the clothing photos you approve are uploaded.
```

- Counted: 164 characters.
- Promotional text is editable **without a new binary submission**, so it is the right home for the strongest claim and for anything that might need to change fast. That is also why the privacy sentence lives here as well as in the description: if the classifier's recall floor slips, this line can be pulled in minutes.
- **This line is subject to the BLOCKER below.** The pre-classifier fallback (counted) is:
  - `Point it at your camera roll and watch your own clothes appear, cut out and organized. Only the photos you approve are ever uploaded.` — **133** characters. Claims only the approval tap, which is a real structural guarantee in the shipped code, and claims nothing about screening.

## 4. Description — limit **4000** · this draft **3187**

Formatting notes: the App Store description renders as plain text with line breaks (no markdown, no bold). Section headers are therefore ALL-CAPS lines and list items use `•`. Only the first ~2–3 lines are visible before "more", so the first paragraph does the work.

```
You already own the clothes. What you don't have is a way to see all of them at once — or a quick answer to the question you ask every single morning.

[App Name] starts with the photos you already have. Point it at your camera roll and, in seconds, you see a preview of your real closet: a handful of your own clothes, cut out cleanly, organized. Not stock images. Not a demo. Yours.

PHOTOS ARE SCREENED ON YOUR DEVICE FIRST

Before anything is uploaded, the screening step runs on your phone. It sets aside intimate images, screenshots, and photos that aren't clothing — and then you approve the ones that become your closet. Only the clothing photos you approve are ever uploaded. The rest never leave your device.

Approved photos are processed by our image partners to cut out and label each garment. We say so plainly, because that's the part most apps leave out.

We never scan, measure, or model your body. There is no try-on and no body scanning in this app. And color guidance is something you choose, never something we read from a photo.

WHAT YOU GET

• Your wardrobe, built from photos you already took. No afternoon spent photographing every garment on a hanger.

• Clean cutouts you can actually browse. Scroll your whole closet and filter by category, color, or what's currently available.

• Weather-aware outfit ideas. Suggestions built from what you own and what's currently clean, biased toward today's local weather — so you're not handed linen on a cold, wet morning.

• A manual outfit builder. Compose looks yourself, slot by slot. Name them, save them, pull one up on a rushed morning.

• A laundry view that's kind about it. Every item is clean, in the wash, or unavailable — packed, at the cleaners, lent to a friend. Suggestions only ever draw from what's clean, so you're never offered something you can't actually wear.

• One-tap wear logging. Tap "I wore this" and it's recorded, and the item can move toward the wash. Over time it quietly builds a picture of what you actually reach for.

• Gentle color pairing. Rules-based guidance on what goes together and what's a safe neutral. It suggests. It never blocks you, and it never scolds you.

• A self-identified color palette (beta). A short swatch quiz — you pick the swatches, we never guess from a camera. The result gently highlights palette-aligned pieces. Off-palette is still completely fine. It's your closet.

HONEST ABOUT THE PRICE

[App Name] is a paid subscription, and there's no free trial — on purpose. You see your own digitized closet before you're asked to subscribe, so you're not buying a promise. If the reveal doesn't land for you, you haven't committed anything.

Free closet apps exist. If you're happy photographing every garment by hand and maintaining the catalog yourself, they'll do the job. This is the one built to work on day one.

WHAT THIS APP IS NOT

No virtual try-on. No body scanning. No shopping feed. No social feed. No ads, no ad trackers, no analytics SDKs. Every feature listed above is a feature that ships today — we won't describe a roadmap as if it were here.

Advisory, always. Suggestions are ideas, not rules. You are the one who decides what to wear.
```

- Counted: **3187 characters** (trailing newline excluded). 813 characters of headroom, which is deliberate — the "no trial" wording and the price wording will both change once `TBC-40`/`TBC-41`/`TBC-42` in `docs/legal/subscription-terms.md` are resolved, and the sub-processor sentence may need to expand after counsel review (`TBC-22`).
- **The word "unlimited" appears nowhere.** `docs/legal/README.md` §3 tension T3 records that the paywall screen currently says "Unlimited garment parsing" while a hard per-account cap exists (`teaser-cap.ts`, 10 preview photos) and a rate limit is planned. "Unlimited" in a store description over a capped product is both an App Review accuracy problem and a consumer-law representation. **The paywall screen must be reconciled to match this description, not the reverse.**
- The sub-processor sentence ("processed by our image partners") is here on purpose. `docs/legal/README.md` §3 tension **T1** is that the landing page never discloses that approved photos travel to OpenAI and Photoroom. A store description that implies otherwise while the linked privacy policy names two external processors is exactly the label-versus-behaviour mismatch that gets rejected. **Counsel should confirm whether the providers must be named here by name** (`TBC-21`, `TBC-22`).
- "in seconds" refers to the **preview**, not the full closet — matching the fix already applied in `content/README.md` (self-critique item: low/overclaim). The full wardrobe is built after payment (`docs/01` F3) and the description does not claim otherwise.

## 5. Keywords field — limit **100** · this draft **98**

```
organizer,organiser,style,styling,clothes,clothing,fashion,capsule,laundry,weather,inventory,daily
```

- Counted: **98 characters** including commas, zero spaces.

**The rule this field obeys, stated explicitly because it is counter-intuitive:**

1. **No spaces after commas.** A space costs a character and buys nothing — Apple splits on the comma. `wardrobe, outfit` wastes one character versus `wardrobe,outfit`.
2. **Never repeat a word that already appears in the app name or subtitle.** Apple indexes the name and subtitle fields *in addition to* the keyword field, and a term appearing in both does **not** rank higher — the duplicate is simply wasted budget out of only 100 characters. This draft's name carries `Closet` and `Outfits`; the subtitle carries `Wardrobe`, `planner`, `photos`. **None of those five words appear above.** That omission is the single highest-leverage thing in this field, and it is also the thing most likely to be "helpfully" undone by someone who doesn't know the rule.
3. **No plurals of words already present.** Apple matches word stems, so `clothes`/`clothing` is arguably already redundant; both are kept because the stemming behaviour for irregular forms is not something to assume — flag for live validation (`aso-keyword-plan.md`).
4. **No competitor names, no trademarks.** Bidding on a rival app's name in the keyword field is a rejection risk and an IP risk.
5. **No category words Apple already infers.** The primary category is submitted separately and is indexed; "app", "free", "best" are wasted characters.
6. **Both `organizer` and `organiser` are present.** Apple's keyword matching is not reliably spelling-variant-tolerant across the en-US and en-GB storefronts, and 10 characters is a cheap hedge for a head term. **This is a hypothesis, not a fact — validate it (see `aso-keyword-plan.md`) and reclaim the 10 characters if the variant is matched automatically.**
7. **Localise per storefront, don't translate.** Each localisation gets its own 100-character field; a literal translation of this list will underperform a natively-researched one.

**2 characters of headroom remain.** Do not fill them with a fragment.

## 6. What's New (version 1.0) — limit **4000** · this draft **543**

```
Version 1.0 — the first release of [App Name].

Scan your camera roll and watch your own clothes appear as clean cutouts. Get weather-aware outfit ideas built from what's actually clean. Build and save your own outfits. Track what's in the wash. Log what you wore with one tap.

Photos are screened on your device before anything is uploaded, and only the clothing photos you approve are ever sent. We never scan or measure your body.

Thank you for being here first. If something feels off, tell us — this is version one, and we're listening.
```

- Counted: **543 characters.**
- For a 1.0 there is no changelog, so this is a compressed restatement plus an explicit invitation to report problems. That invitation is not decoration — it is the cheapest external oracle available at launch, given that no screen has ever been rendered (`docs/LAUNCH-READINESS.md` §3).
- Subject to the same privacy BLOCKER; the fallback drops the sentence beginning "Photos are screened".

## 7. URLs

All URLs use the **single canonical placeholder token `{{CANONICAL_URL}}`**, matching the convention `content/README.md` standardised on (self-critique item: low/canonical-placeholders). **Do not introduce a second token form here** — `content/README.md` and `docs/LAUNCH-READINESS.md` §4 both flag that three competing placeholder conventions already exist in `content/blog/`, and that a publish step substituting only one form ships a raw placeholder live.

| App Store Connect field | Value | Required? |
|---|---|---|
| Support URL | `{{CANONICAL_URL}}/support` | **Required.** Must resolve to a real page with a real contact route before submission. |
| Marketing URL | `{{CANONICAL_URL}}` | Optional. Points at the landing page (`content/landing/landing-page.md`). |
| Privacy Policy URL | `{{CANONICAL_URL}}/privacy` | **Required.** `docs/legal/privacy-policy.md`, reviewed and hosted — see `docs/legal/README.md` §2.1. |
| EULA / Terms of Use | `{{CANONICAL_URL}}/terms` | Strongly advised given photo processing by third parties — `docs/legal/README.md` §2.7. |

**No domain exists yet.** There is nowhere to host the privacy policy, which is a hard submission blocker in its own right (`docs/legal/README.md` §2.1), independent of the policy's own 46 unresolved `TBC` markers.

## 8. Category recommendation

| | Category | Rationale (one line each) |
|---|---|---|
| **Primary** | **Lifestyle** | The daily "what do I wear" habit and the wardrobe-management job-to-be-done sit in Lifestyle, where closet/outfit apps are conventionally browsed and where a paid utility is not competing against free photo-editing toys. |
| **Secondary** | **Productivity** | The app is functionally an inventory-plus-planner with a daily decision loop; Productivity captures the "reduce the morning decision" intent that Lifestyle browsing does not. |

- **Deliberately not Photo & Video**, even though the app ingests photos: the photo handling is a means, not the value, and that category's ranking cohort is editors and cameras.
- **Deliberately not Shopping.** There is no shopping, no affiliate, no gap-fill (`docs/roadmap.md`, deferred). Choosing Shopping would set an expectation the product does not meet — a review-notes risk and a refund-driver.
- **Deliberately not Health & Fitness.** Nothing here touches the body. Choosing it would imply body measurement, which this app explicitly does not do.
- Validate against the actual live top-charts cohort at submission time; category competitiveness shifts, and this recommendation is reasoning from the product, not from live rank data.

## 9. Age rating

**Recommended: 4+ on the Apple rating scale**, with a **minimum-age gate decision still outstanding** — these are two different things and both are needed.

The content questionnaire answers that follow from the product as built:

| Questionnaire topic | Answer | Why |
|---|---|---|
| Cartoon/fantasy/realistic violence | None | — |
| Profanity, crude humour | None | — |
| Sexual content or nudity | **None** | The app displays garment cutouts and the user's own approved photos. It never displays other users' photos — there is no social surface, no feed, no sharing (`docs/00`, social is roadmap-only). |
| Horror/fear, gambling, contests | None | — |
| Alcohol, tobacco, drug use or references | None | — |
| Medical/treatment information | **None** | Styling guidance only, explicitly advisory (`docs/01` cross-cutting rules). No health, body, or weight claims of any kind. |
| Unrestricted web access | **No** | No in-app browser. |
| User-generated content shared with others | **No** | Outfit names and photos are private to the account, enforced by RLS FORCE default-deny (`docs/legal/privacy-policy.md` §8). Nothing a user creates is visible to any other user. |

**The unresolved part, which is a real blocker, not a formality:** the app **ingests photographs of the user**. `docs/legal/README.md` `TBC-27` flags this as high-exposure and requires a human decision on (a) the minimum age, (b) whether a sign-up age gate is implemented, and (c) the resulting store rating — weighing COPPA (US, under 13), the UK Age Appropriate Design Code, and GDPR Art. 8 digital-consent ages (13–16, varying by member state). **A 4+ rating with no age gate on an app that uploads photos of the user is not a defensible combination.** If counsel sets a minimum age of 13+ or 16+, the rating changes and an age gate must be built. Do not submit the rating before that decision.

## 10. Other App Store Connect fields that are not copy but will block you

| Field | Status |
|---|---|
| App Privacy (data-collection answers) | Drafted — `app-privacy-nutrition-label.md`. **Must be re-derived against shipped code at submission.** |
| App Tracking Transparency | No tracking, so no ATT prompt is required — but this must be re-confirmed against the shipped binary (`docs/legal/README.md` `TBC-11`). |
| Screenshots (required, per device size) | **Cannot be produced.** No screen has ever been rendered — `screenshot-plan.md`. |
| App Preview video | Not planned for 1.0. The reveal moment would make a strong one; it needs real captures first. |
| Subscription display name + description (per IAP product) | Blocked on `TBC-40`/`TBC-41`/`TBC-42` (price, period, trial) in `docs/legal/subscription-terms.md`. |
| Review notes (demo account, how to reach the paywall) | **Must be written.** Reviewers will need a working account and a camera roll with clothing photos on the review device, or the reveal will not fire and the app will look broken. Draft this once the app actually runs. |
| Copyright, contact info, trade rep | Blocked on the legal entity (`docs/legal/README.md` `TBC-03`). |

---

## BLOCKER — the privacy claim cannot go live yet

**Every sentence in this file that describes on-device screening is copy for the shipped product and must NOT be submitted until the classifier exists and passes its recall floor.**

The facts, from the tree:

- `docs/LAUNCH-READINESS.md` §3: *"The on-device privacy-gate classifier does not exist. `git grep` for `classifier|intimate|privacy.gate|nsfw` across `packages/` returns nothing."*
- `docs/legal/README.md` §3 tension **T2**: the claim is defensible on the *approval-tap* reading and indefensible on the *"the filter never errs"* reading, and *"must not ship the claim at all until the classifier exists."*

What that means concretely for this listing:

| Claim | Ships now? |
|---|---|
| "Only the clothing photos you approve are ever uploaded" | **Yes.** This is the approval-tap guarantee, which is structural in the shipped code (no upload path exists without an approval). |
| "Photos are screened on your device first / it sets aside intimate images, screenshots, and photos that aren't clothing" | **NO — blocked.** There is no classifier. Shipping this describes a safeguard that does not exist. |
| "We never scan, measure, or model your body" | **Yes.** Verified absent: no such code, no such column, try-on is roadmap-only (`docs/legal/README.md` §3 closing note). |
| "Color guidance is something you choose, never something we read from a photo" | **Yes.** `palette_profile` stores only a self-identified hue set from the swatch quiz; there is no camera-derived tone anywhere. |

**Two ways forward, and the choice is the owner's:**

1. **Preferred:** ship the classifier, grade it against an independently-labelled intimate/not-her corpus, clear the recall floor (`docs/LAUNCH-READINESS.md` §7 step 7), then submit this copy as written.
2. **If launching before the classifier:** use the counted fallback strings above, which claim only the approval tap. The description's "PHOTOS ARE SCREENED ON YOUR DEVICE FIRST" section must be replaced wholesale with an approval-only version, and the header retitled (e.g. "NOTHING IS UPLOADED UNTIL YOU APPROVE IT"). **Do not simply soften the adjectives** — "screening" is the claim, and hedged screening is still a screening claim.

An App Store description is a legal representation. A safeguard described in the listing but absent from the binary is a misrepresentation regardless of intent, and — per `docs/legal/README.md` §2.5 — a listing/behaviour mismatch is also a review-rejection risk.
