# Google Play Console listing — field pack (DRAFT, not submitted)

**Status:** unpublished draft. Submission is a human step. Read `app-store-listing.md` first — the two `[App Name]` and privacy-classifier blockers stated there apply identically here and are not repeated in full.

**This is not a copy of the Apple listing.** Play's mechanics differ in five ways that change the copy, and the differences are the reason this file exists:

| Difference | Consequence for the copy |
|---|---|
| **Play indexes the full description for search.** Apple has a separate hidden keyword field; Play does not — it reads the title, short description, and the whole 4000-character long description. | The Play long description repeats head terms naturally in prose. There is no keyword field below, and the omit-duplicates rule from the Apple pack **does not apply here** — the opposite is true. |
| **Short description (80) is shown in the store listing card and is prime indexed real estate.** Apple's promotional text is not indexed at all. | The Play short description carries the value proposition *and* head terms; Apple's promotional text carries the strongest claim (and is the field that can be pulled fast if the classifier slips). |
| **Play requires a separate "Data safety" form**, which is stricter than Apple's App Privacy in some respects (it asks about encryption in transit, deletion requests, and independent security review) and looser in others. | See `app-privacy-nutrition-label.md`, which covers both and flags where they diverge. |
| **Play requires cancellation to be described as happening in Google Play settings**, and the Play listing is where Android subscription expectations are set. | The subscription paragraph names Google Play, not Apple. |
| **Play's rating is IARC-questionnaire-driven, not a single Apple-style band**, and Play separately requires a target-audience declaration. | See § Content rating below; the answers are the same facts, the form is different. |

---

## 1. App title — limit **30** · this draft **28**

```
[App Name]: Closet & Outfits
```

- Counted: 28 characters. Same string as Apple, and deliberately so — a divergent name across the two stores fragments brand recall and makes support and press links inconsistent.
- The same arithmetic applies: `: Closet & Outfits` is **18** fixed characters, so the real name must be ≤ 12 to keep the descriptor. See `app-store-listing.md` § "Character budget risk" for the fallback ladder — **do not re-derive it here and risk the two stores diverging.**
- Play title guidance additionally forbids promotional text, emoji, all-caps gimmicks, and store-performance claims ("#1", "Best") in the title. This string is clean on all four.

## 2. Short description — limit **80** · this draft **73**

```
Your camera roll becomes your closet. Then it answers what to wear today.
```

- Counted: 73 characters.
- Two sentences on purpose: the first is the mechanism (and carries `camera roll`, `closet`), the second is the job-to-be-done (and carries `what to wear today`, which is a real long-tail query — see `aso-keyword-plan.md`).
- **Alternate, counted:** `Turn photos you already have into your real closet, then wear what you own.` — 75 characters. Leads with the benefit rather than the mechanism; worth A/B testing via Play's store-listing experiments, which Apple has no equivalent of for this field.
- 7 characters of headroom left intentionally. Play truncates on narrow devices and localisations run long.

## 3. Full description — limit **4000** · this draft **3336**

Formatting notes: Play's full description supports a **small HTML subset** (`<b>`, `<i>`, `<u>`, `<br>`, and lists) where Apple's is plain text. This draft is written as plain text with blank-line paragraphs and ALL-CAPS section headers so it renders correctly either way; whoever pastes it may promote the section headers to `<b>` without changing a word or a count. Only the first ~3 lines show before "Read more".

```
Your closet already lives in your camera roll. [App Name] turns it into a wardrobe you can actually use.

Point it at your camera roll and, in seconds, you see a preview of your real closet — a handful of your own clothes, cut out cleanly and organized. Not stock images, not a demo. Your clothes.

Then it answers the question you ask every morning: what do I wear today?

YOUR PHOTOS ARE SCREENED ON YOUR DEVICE FIRST

Before anything is uploaded, the screening step runs on your phone. It sets aside intimate images, screenshots, and photos that aren't clothing. You then approve the photos that become your closet, and only those approved clothing photos are ever uploaded. The rest never leave your device.

The clothing photos you do approve are processed by our image-processing partners to cut out and label each garment. We say that plainly here because it's the part most apps leave out — the full detail is in our Privacy Policy, and our Data safety section lists every provider.

We never scan, measure, or model your body. This app has no virtual try-on and no body scanning. Color guidance comes from a swatch quiz you fill in yourself — never read from a photo of you.

WHAT THE APP DOES

Wardrobe from your camera roll — your clothes digitized from photos you already took, with no afternoon spent photographing garments one by one.

Browse and filter your closet — every item as a clean cutout, filterable by category, color, or what's currently available.

Weather-aware outfit suggestions — outfit ideas built only from items you've marked clean, biased toward today's local weather.

Manual outfit planner — build looks slot by slot, name them, save them, and pull one up on a rushed morning.

Laundry and availability tracking — clean, in the wash, or unavailable (packed, at the cleaners, lent out). Suggestions skip anything you can't actually wear.

One-tap wear log — tap "I wore this" and it's recorded, and the item can move toward the wash. Over time you can see what you actually reach for.

Color harmony help — rules-based pairing guidance on what goes together and what's a safe neutral. It suggests; it never blocks you.

Self-identified color palette (beta) — a short swatch quiz you answer yourself. Palette-aligned pieces get gently highlighted. Off-palette is still completely fine.

WHO IT'S FOR

Women who own more clothes than they can hold in their head, and would rather spend their attention on getting dressed than on data entry. If you've ever stood in front of a full closet and felt like you had nothing to wear, that's the problem this solves.

SUBSCRIPTION

[App Name] is a paid subscription with no free trial. You see your own digitized closet before you're asked to subscribe, so you're deciding with your own eyes instead of on a promise. The subscription renews automatically until you cancel; you can cancel any time in your Google Play subscription settings. Price, billing period, and the full terms are shown in the app before you buy.

WHAT THIS APP DOESN'T DO

No virtual try-on. No body scanning. No shopping feed. No social feed. No ads, no ad identifiers, no third-party analytics. Every feature above ships today — we don't advertise a roadmap as if it were already here.

And all styling guidance is advisory. Suggestions are ideas, never rules. You decide what you wear.
```

- Counted: **3336 characters** (trailing newline excluded). 664 characters of headroom, held back for the same reasons as the Apple description (price/trial wording, sub-processor wording after counsel review).
- **Where this differs from Apple's description and why:**
  - The head terms (`closet`, `wardrobe`, `outfit`, `camera roll`, `laundry`, `weather`, `planner`) appear in natural prose because **Play indexes this field**. They are not stuffed — every occurrence reads as a sentence — but the repetition is deliberate, not accidental.
  - The `WHO IT'S FOR` section exists only here. Play's audience arrives more often from browse and from Play Search's broader query mix, so stating the user plainly qualifies traffic; Apple's description is read further down the funnel.
  - The feature list uses `Term — explanation` rather than Apple's `•` bullets, because dashes survive Play's rendering and HTML-list conversion cleanly.
  - The subscription paragraph is more explicit about auto-renewal and Google Play cancellation. Play's own subscription policy requires the cancellation route to be discoverable, and Android users expect the Play-settings framing.
  - It points at the **Data safety** section by name — a Play-specific affordance Apple has no equivalent of, and a cheap way to make the sub-processor disclosure verifiable rather than merely asserted.
- **"Unlimited" appears nowhere**, for the same reason as Apple: a per-account cap exists (`docs/legal/README.md` §3, tension T3). The paywall copy must be reconciled to match.

## 4. Release notes (What's new) — limit **500** · this draft **348**

```
First release. Scan your camera roll and see your own clothes as clean cutouts. Get weather-aware outfit ideas from what's actually clean, build and save your own outfits, track what's in the wash, and log what you wore with one tap. Photos are screened on your device before anything is uploaded, and only the clothing photos you approve are sent.
```

- Counted: **348 characters.** Play's limit is **500**, not Apple's 4000 — this is the single most commonly-missed field-length difference between the two stores, and it is why the Apple What's New text cannot be pasted here (it is 543 characters and would be rejected).
- Subject to the same privacy BLOCKER: without the classifier, cut the final sentence and replace with `Only the clothing photos you approve are ever uploaded.`

## 5. Graphics requirements (Play-specific, and none of it can be produced yet)

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit, under 1 MB | **Blocked** — no icon designed; blocked on the name and the visual pass. |
| Feature graphic | **1024 × 500** PNG/JPEG, no alpha. **Required** — Play will not publish without it. | **Blocked.** Needs real art. Note it is displayed with the play button overlaid if a promo video exists, so keep the centre clear. |
| Phone screenshots | 2–8 required, 16:9 or 9:16, each side 320–3840 px | **Blocked** — see `screenshot-plan.md`. No screen has ever been rendered. |
| 7-inch tablet screenshots | Up to 8; required only to be eligible for tablet promotion | Not planned for 1.0. |
| 10-inch tablet screenshots | Up to 8; same | Not planned for 1.0. |
| Promo video | Optional, YouTube URL | Not planned for 1.0. |

**Play requires a minimum of 2 phone screenshots and the 1024×500 feature graphic to publish at all.** That makes the visual gate (`docs/LAUNCH-READINESS.md` §7 step 6) a hard Play blocker, not a polish item.

## 6. Categorisation

| Field | Value | Rationale |
|---|---|---|
| **App category** | **Lifestyle** | Play's taxonomy has no direct Apple "Productivity + Lifestyle" pairing; Play allows one category. Lifestyle is where wardrobe and closet apps are browsed and where the daily-habit framing fits. |
| **Tags** (Play allows up to 5 from a fixed list) | Nearest available to: Fashion & Style · Personal Organizer · Photo Utility | The exact tag vocabulary is fixed by Play and changes; pick the closest live options at submission and re-check, rather than trusting this list. |
| **Store listing contact details** | Email (required), website, phone (optional) | Blocked on the legal entity and support address (`docs/legal/README.md` `TBC-03`, `TBC-05`). |

- **Deliberately not Shopping** (no shopping exists) and **deliberately not Beauty** (implies body/appearance treatment claims the app does not make).

## 7. Content rating (IARC questionnaire)

Play does not accept a self-chosen band — you complete the IARC questionnaire and receive regional ratings (ESRB, PEGI, USK, etc.). The factual answers, which follow from the product as built:

- Violence, sexual content, nudity, profanity, drugs, gambling, horror: **none of these are present.**
- **Does the app share user-generated content with other users?** **No.** There is no social surface; every row is isolated by RLS FORCE default-deny (`docs/legal/privacy-policy.md` §8).
- **Does the app allow users to interact with each other?** **No.**
- **Does the app share the user's location with other users?** **No.** Weather uses coordinates from the device and is never stored server-side or shared.
- **Does the app allow purchases?** **Yes** — a single auto-renewing subscription. Play requires this to be declared and it appears on the listing as "In-app purchases".
- **Does the app collect or share personal data?** **Yes** — see `app-privacy-nutrition-label.md`.

Expected outcome: the lowest band in every region (ESRB Everyone / PEGI 3), **but the target-audience declaration is the real decision and it is unresolved.** Play requires a declared target age group, and a declaration including under-13 triggers Play's Families policy and its designed-for-families requirements. Because this app **uploads photographs of the user**, `docs/legal/README.md` `TBC-27` requires a human decision on the minimum age and whether a sign-up age gate exists. **Declare an adult target audience (18+ or 16+ per counsel) and implement the matching age gate. Do not declare a broad audience that includes children on a photo-ingesting app.**

## 8. URLs

Same single canonical token as everywhere else in `content/` — **`{{CANONICAL_URL}}`**. Do not introduce a second form (`content/README.md`, self-critique item: low/canonical-placeholders).

| Play Console field | Value |
|---|---|
| Privacy policy URL | `{{CANONICAL_URL}}/privacy` — **required for any app collecting personal data.** |
| Website | `{{CANONICAL_URL}}` |
| Support email | Blocked on `TBC-05`. **Required** — Play publishes it on the listing. |

## 9. Play-specific compliance items that will block a release

| Item | Why it blocks |
|---|---|
| **Data safety form** | Mandatory. Must be consistent with the privacy policy and with actual behaviour. See `app-privacy-nutrition-label.md`. |
| **Account deletion — the web URL requirement** | Play requires apps with account creation to offer in-app deletion **and** a **publicly reachable web URL** where deletion can be requested without installing the app. Apple requires only the in-app path. This is a Play-only extra deliverable and it needs the domain to exist. |
| **Photo and video permissions declaration** | Play requires a declaration justifying broad photo/video access, and pushes apps toward the system photo picker instead. **This one has a design consequence:** if the app must use the Android photo picker rather than reading the full media library, the "point it at your camera roll" scan changes shape on Android and the copy above may need to change with it. **Flag for the mobile owner — this is not a copy decision.** |
| **Subscription product configuration** | Base plan, offer, price, and billing period must be configured; blocked on `TBC-40`/`TBC-41`/`TBC-42`. |
| **Target API level** | Play enforces a minimum target API level that moves annually; verify against the Expo/RN build at submission time. |
| **Closed testing requirement for new personal developer accounts** | Play has required new personal-account developers to run a closed test with a minimum number of testers over a minimum period before production access. **If the developer account is personal rather than an organisation, this adds weeks to the timeline.** Check the current rule and the account type early — this is a schedule blocker, not a content one. |
