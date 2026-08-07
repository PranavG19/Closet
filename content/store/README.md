# content/store — App Store + Play listing pack (DRAFTS)

Written 2026-08-07. Covers `docs/LAUNCH-READINESS.md` §7 **step 10** (ASO assets + listing copy).

**Nothing here is submitted, and submission is a human step** — it is irreversible and outward-facing, and it carries a legal representation (`docs/LAUNCH-READINESS.md` §5, §7 step 10). An agent drafts and prepares; the owner approves liability and submits.

These files follow the conventions `content/README.md` already established: the single canonical placeholder token `{{CANONICAL_URL}}`, the literal `[App Name]` token for the unresolved product name, and copy where **every claim traces to a shipping MVP feature** in `docs/01-product-requirements.md`.

## The files

| File | What it is |
|---|---|
| `app-store-listing.md` | The App Store Connect field pack. Name, subtitle, promotional text, description, keywords, What's New, URLs, category, age rating — each labelled with its real store limit and a counted length. Plus the character-budget arithmetic for when the name lands. |
| `google-play-listing.md` | The Play Console equivalent. **Not a copy of the Apple pack** — Play indexes the full description (Apple does not), has a 500-character release-notes limit (Apple's is 4000), needs an 80-character short description and a 1024×500 feature graphic, and requires a public web account-deletion URL. §Top of file tabulates every difference and why it changes the copy. |
| `app-privacy-nutrition-label.md` | Draft answers for Apple's App Privacy label **and** Play's Data safety form, derived from `docs/legal/privacy-policy.md` (itself derived from the applied schema). Names every third party including the two that receive photographs. Opens with the re-derivation requirement. |
| `aso-keyword-plan.md` | The ranked keyword hypothesis set with intent segmentation and field mapping. **Contains no volumes and no difficulty scores** — no keyword tool was available, and inventing numbers would be worse than omitting them. §5 is the validation protocol. §4 is the refusal list. §6 cross-references the blog's keyword targets. |
| `screenshot-plan.md` | The 8-frame shot list: order, screen, counted caption, and the one benefit each frame proves, plus required device sizes for both stores. **A list, not assets** — no screen has ever been rendered. |

## How the counts were produced

Every character count in these files was **counted programmatically on the exact string as written in the file**, not estimated and not eyeballed. Each fenced code block containing a store field was extracted from the written markdown and measured after stripping the trailing newline (which store fields do not include).

**Re-verify after any edit.** A one-word change to the subtitle can push 28 → 31 and silently break a 30-character field. Extract the fenced blocks and measure them again; do not trust the numbers in the prose after editing the copy.

Counts as written today:

| Field | Limit | Counted |
|---|---|---|
| Apple app name | 30 | 28 |
| Apple subtitle | 30 | 28 |
| Apple promotional text | 170 | 164 |
| Apple description | 4000 | 3187 |
| Apple keywords | 100 | 98 |
| Apple What's New | 4000 | 543 |
| Play title | 30 | 28 |
| Play short description | 80 | 73 |
| Play full description | 4000 | 3336 |
| Play release notes | **500** | 348 |

---

## BLOCKED — what cannot ship, and on whom

Ordered by how much else each one unblocks.

### 1. The product name — `[App Name]` · **owner**

The product has no name (`docs/LAUNCH-READINESS.md` §4: the single biggest content blocker). The literal token `[App Name]` is kept everywhere the name goes, deliberately and consistently with `content/`.

**This is not only a find-and-replace.** The App Store name field is **30 characters** and the subtitle is **30**. The token is 10 characters; a real name will almost certainly be longer, and `: Closet & Outfits` is 18 fixed characters — so **the real name must be ≤ 12 characters to keep the descriptor.** `app-store-listing.md` § "Character budget risk" has the fallback ladder, and it has a knock-on: if the descriptor is dropped, `closet` and `outfits` stop being indexed by the name field and must be added back into the 100-character keyword field, which then needs ~15 characters freed.

**Feed this back into the naming decision.** A name containing a category word gets that word indexed with the heaviest weight available. It is far cheaper to pick an ASO-friendly name than to compensate for a hard one for years (`aso-keyword-plan.md` §5).

### 2. Real screenshots · **owner + mobile**

**No screen has ever been rendered** — not on a device, not on a simulator (`docs/LAUNCH-READINESS.md` §3). And the parse pipeline returns 502 (`unwiredPorts`), so the reveal frame has no cutouts to show even if a screen rendered.

Both stores require screenshots to publish (Apple: 2–10 for the required iPhone class; Play: minimum 2 phone screenshots **plus** a mandatory 1024×500 feature graphic). Blocked behind: real parse adapters → a real deploy → the visual design pass → owner sign-off on "does it feel premium" → **and a real camera roll sourced with a real person's consent**, which is the longest-lead item and is not a technical task.

### 3. The on-device privacy classifier · **owner**

**The classifier does not exist in any form.** `git grep classifier|intimate|privacy.gate|nsfw` across `packages/` returns nothing (`docs/LAUNCH-READINESS.md` §3). `docs/legal/README.md` §3 tension **T2** is explicit: the claim *"must not ship at all until the classifier exists."*

The copy in this directory is written **for the shipped product** — the version that has the classifier. Every file marks the screening sentences as blocked and provides a counted fallback that claims **only the approval tap**, which *is* a structural guarantee in the shipped code (no upload path exists without an approval).

**The distinction to hold onto:**

| Claim | Shippable today? |
|---|---|
| "Only the clothing photos you approve are ever uploaded" | **Yes** — approval-tap guarantee, structural. |
| "Photos are screened on your device first" / "sets aside intimate images" | **NO** — describes a safeguard that does not exist. |
| "We never scan, measure, or model your body" | **Yes** — verified absent from the tree. |
| "Colour guidance is self-identified, never read from a photo" | **Yes** — `palette_profile` stores only a self-identified hue set. |

**Do not soften the screening adjectives as a workaround.** Hedged screening is still a screening claim. Use the fallback strings.

### 4. Legal review + a hosted policy URL · **counsel + owner**

`docs/legal/README.md` lists **46 unresolved `[TO BE CONFIRMED]` markers** across three unreviewed drafts. The ones that block this listing pack specifically:

| Marker | Blocks |
|---|---|
| `TBC-40` / `TBC-41` / `TBC-42` | Price, billing period, trial. Blocks the subscription IAP configuration and any price-bearing copy or screenshot. |
| `TBC-43` | **Restore Purchases control — absent from the paywall screen. A hard Apple submission blocker.** |
| `TBC-24` | In-app data export + account deletion paths (Apple requires in-app deletion; **Play additionally requires a public web deletion URL**). |
| `TBC-27` | Minimum age, age gate, store rating. **A 4+ rating with no age gate on an app that uploads photos of the user is not defensible.** Blocks both the Apple rating and the Play target-audience declaration. |
| `TBC-11` | Confirm no analytics/crash/attribution SDK was added; align the privacy label + ATT answer + policy. |
| `TBC-21` / `TBC-22` / `TBC-23` | Processor DPAs, **whether OpenAI/Photoroom train on submitted images and how long they retain them**, transfer mechanisms. `TBC-22` is the highest-sensitivity item in the whole legal set because these are photographs of the user — and if zero-retention terms are not available, **the marketing privacy voice has to change.** |
| `TBC-03` / `TBC-05` | Legal entity and support email. Both stores publish these. |

Plus the structural one: **there is no domain.** Both stores require a reachable privacy-policy URL, and `{{CANONICAL_URL}}` resolves to nothing (`docs/legal/README.md` §2.1).

### 5. Reconcile the paywall screen · **mobile + owner**

`packages/mobile/features/monetization/PaywallScreen.tsx` currently says **"Unlimited garment parsing"** while a hard per-account cap exists (`teaser-cap.ts`, 10 preview photos) and a rate limit is planned. It also shows no price, no period, no auto-renewal statement, no platform-cancellation statement, no terms/privacy links, no Restore control — and its Subscribe button is `onPress={() => {}}` (`docs/legal/README.md` §3, tensions **T3** and **T5**).

**Neither store description in this directory uses the word "unlimited".** The paywall must be reconciled to match the listings, **not the reverse** — "unlimited" over a capped product is an App Review accuracy problem and a consumer-law representation.

---

## Pre-submission checklist

Nothing here is a formality; each line is a real blocker found in the tree.

**Product must exist**
- [ ] Parse adapters wired; `parse-photo` no longer returns 502 (`docs/LAUNCH-READINESS.md` §7 step 3)
- [ ] Deployed to a real Supabase project with real secrets; Storage-RLS policies authored **and tested** (step 4)
- [ ] Every screen rendered and design-passed; owner signed off on premium feel (step 6)
- [ ] On-device privacy classifier built and clearing its recall floor against an independently-labelled corpus (step 7) — **or** the fallback copy adopted throughout
- [ ] Money path verified against a **real** RevenueCat webhook event, not a mocked success (step 8)
- [ ] Per-user rate limit / provider-spend throttle shipped (step 5) — cost-abuse exposure is live on day 1 without it

**Content**
- [ ] Product name chosen; `[App Name]` replaced everywhere in `content/` **and** `docs/legal/`
- [ ] **All character counts re-measured after the name substitution.** Name ≤ 30, subtitle ≤ 30, promo ≤ 170, keywords ≤ 100, Play title ≤ 30, Play short ≤ 80, Play release notes ≤ **500**
- [ ] Keyword field re-cut if the name form changed (the omit-duplicates logic depends on which words the name carries)
- [ ] Domain registered; `{{CANONICAL_URL}}` substituted **everywhere**, including `content/blog/` where three competing placeholder forms exist (`docs/LAUNCH-READINESS.md` §4) — **grep for `REPLACE`, `[DOMAIN]`, and `{{` across all of `content/` and confirm zero hits**
- [ ] `/support`, `/privacy`, `/terms` all resolve to real pages
- [ ] No `[App Name]` token visible in any screenshot pixel

**Store forms**
- [ ] Screenshots captured for every required device size; Play feature graphic (1024×500) and 512×512 icon produced
- [ ] App Privacy label **re-derived against the frozen dependency list**, not copied from this draft
- [ ] Play Data safety form completed (note the extra questions: encryption in transit, deletion request path, independent security review — answer that last one honestly: **no**)
- [ ] ATT answer confirmed against the shipped binary; **no ATT prompt added if nothing tracks**
- [ ] Age rating + target-audience declaration match the age-gate decision (`TBC-27`)
- [ ] Subscription product configured with real price/period; paywall renders the **localised store price**, never a hardcoded figure
- [ ] Review notes written, with a demo account **and** a capture device whose camera roll contains clothing photos — otherwise the reviewer sees no reveal and the app looks broken
- [ ] Restore Purchases control present and working (`TBC-43`)
- [ ] In-app account deletion and data export reachable (`TBC-24`); Play's public web deletion URL live

**Truth check — do this last, with fresh eyes**
- [ ] Read both descriptions against `docs/01` line by line. Every claim traces to a shipping feature
- [ ] No try-on, body-scanning, or body-geometry implication anywhere
- [ ] Nothing implies the camera reads skin tone; the palette is shown as **swatches** and labelled **beta**
- [ ] Nothing prescriptive: no "flatter your figure", no body-shape advice, no "you shouldn't wear"
- [ ] The word "unlimited" appears in neither listing **nor the paywall**
- [ ] The sub-processor fact (approved photos go to OpenAI and Photoroom) is stated consistently in the listings, the policy, and the landing page
- [ ] The App Privacy label matches actual shipped behaviour — **a mismatch is both a common rejection and an FTC exposure**
