# Launch content — DRAFTS (publishing is human-gated)

Generated 2026-08-06 by the SEO-content workflow (pillar + 6 cluster posts + landing copy).
**Nothing here is published.** Publishing to the open web is outward-facing and semi-irreversible
(indexed/cached), so a human presses publish — see docs/04 Phase 3.

## Structure (hub-and-spoke)
- **Pillar:** `blog/how-to-organize-your-wardrobe.md`
- **Spokes:** what-to-wear-nothing-to-wear, outfit-ideas-from-your-own-closet, how-to-digitize-your-closet, outfit-planner-app-guide, capsule-wardrobe-app-guide, premium-closet-app
- **Landing copy:** `landing/landing-page.md` (A/B hero variants + value props + privacy + honest pricing + FAQ + CTA)

## Before publishing — self-critique fixes (all APPLIED)

The eight workflow self-critique items below have been applied to the drafts (editorial pass, 2026-08-07). None were high-severity. The drafts are now publish-ready pending the two human follow-ups in the next section.

- ✅ **[medium/keyword-cannibalization]** `premium-closet-app` vs `landing-page` — the two near-duplicate product pages are now differentiated. landing-page is the CONVERSION page (`robots: noindex`, canonical → `/blog/premium-closet-app`, header note stating no organic-ranking ambition); premium-closet-app is the indexable SEO article. Distinct primary keywords (`[App Name]` for landing, `premium closet app` for the article) and the shared privacy block was rewritten so the two are no longer near-identical.
- ✅ **[medium/keyword-cannibalization]** `how-to-organize-your-wardrobe` — pillar Step 2 cut from the full three-methods comparison to a short primer that names the three methods and hands off to `/blog/how-to-digitize-your-closet`. The spokes' head-terms (`digitize my closet`, `capsule wardrobe`, `outfit planner`) were dropped from the pillar's secondaryKeywords so each spoke owns its intent.
- ✅ **[medium/internal-links]** All internal links normalized to the single `/blog/<slug>` convention across all eight artifacts (the pillar's and premium-closet-app's no-prefix links were repointed).
- ✅ **[medium/mis-anchored-link]** `outfit-planner-app-guide` — the "compared them in …" setup-methods link now points to `/blog/how-to-digitize-your-closet` (where the three-way comparison lives), not the pillar.
- ✅ **[low/inclusivity]** `outfit-ideas-from-your-own-closet` — the proportion section reframed from prescriptive/body-standard framing to taste/preference ("shifting where the visual break falls changes the feel — try what you like"). Downstream echoes in the morning-routine list and FAQ softened to match.
- ✅ **[low/overclaim]** `premium-closet-app` + `landing-page` FAQ — "in seconds" now consistently refers to the PREVIEW/reveal (~5-10 item teaser); the full camera-roll build is stated as the post-unlock step. Applied to the H1, metaDescription, body, closing line, and the landing-page FAQ.
- ✅ **[low/canonical-placeholders]** All canonical placeholders standardized on the single `{{CANONICAL_URL}}` token (how-to-digitize and premium-closet-app normalized; no literal placeholder domain string remains in any content file).
- ✅ **[low/overclaim]** `capsule-wardrobe-app-guide` — the app's role held to the MVP wear-log ("a timestamped record of what you actually wore"); cost-per-wear/dead-stock discussed only as concepts the record enables, framed once as roadmap, not shipped screens.

## Placeholders to resolve (remaining human follow-ups)
- `[App Name]` — the product name (still TBD). Kept as a consistent token everywhere; the owner resolves it before publish.
- Live keyword-volume validation is a human/tool follow-up (no live web in the run).

## Verdict
Solid, on-brand drafts overall — warm/confident voice holds, privacy on-device gate is described accurately everywhere (no privacy misstatements), no post promises try-on/shopping/social as shipping, and all metaDescriptions are within the 155-char limit. No high-severity defects. The real risks are structural rather than voice: (1) landing-page and premium-closet-app are near-duplicate product pages competing for the same intent, and the pillar duplicates the how-to-digitize three-methods comparison — both cannibalization risks; (2) internal links use inconsistent /blog vs no-prefix paths and one mis-anchored link, which will break the hub-and-spoke; (3) minor overclaim where 'digitized in seconds' reads as the whole closet rather than the teaser preview; (4) one low inclusivity nudge in the proportion/'lengthen the leg' styling advice to soften toward advisory. Fix the cannibalization pair, normalize link paths/canonicals, and trim the pillar's digitize section, then this set is publish-ready. **(Update 2026-08-07: all eight fixes above are now applied — see the "self-critique fixes (all APPLIED)" section. Remaining before publish: resolve the `[App Name]` token and run live keyword-volume validation.)**

---

## App Store + Play listing pack → `store/`

Added 2026-08-07 (`docs/LAUNCH-READINESS.md` §7 step 10). See **`store/README.md`** for the file
guide, the counted-character table, what is blocked and on whom, and the pre-submission checklist.

- `store/app-store-listing.md` — App Store Connect field pack (every field labelled with its real
  store limit and a counted length), category + age-rating recommendations, URLs.
- `store/google-play-listing.md` — the Play equivalent; Play's real differences (full description is
  indexed, 500-char release notes, 80-char short description, feature graphic, public web deletion URL).
- `store/app-privacy-nutrition-label.md` — App Privacy + Play Data safety answers derived from
  `docs/legal/privacy-policy.md`; names every third party, including the two that receive photos.
- `store/aso-keyword-plan.md` — ranked keyword hypotheses + field mapping. **No volumes or difficulty
  scores** (no keyword tool was available); §5 is the validation protocol; §6 cross-references the
  blog targets above so the two channels don't collide.
- `store/screenshot-plan.md` — the 8-frame shot list with counted captions. **A list, not assets:**
  no screen has ever been rendered (`docs/LAUNCH-READINESS.md` §3).

The store pack follows the same conventions as the drafts above — the single `{{CANONICAL_URL}}`
token and the literal `[App Name]` token — and adds two constraints specific to it: the App Store
name and subtitle fields are **30 characters each**, so the unknown real length of `[App Name]` makes
every name-bearing count provisional; and the "screened on your device" line **cannot go live** until
the on-device classifier exists and clears its recall floor (`docs/LAUNCH-READINESS.md` §3,
`docs/legal/README.md` §3 tension T2). Counted fallback strings claiming only the approval tap are
provided in each file.
