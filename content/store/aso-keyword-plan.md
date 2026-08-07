# ASO keyword plan — target set, field mapping, and what must be validated

**Status:** unpublished draft. **Every volume and difficulty statement in this file is REASONING, not data.**

> ## NO KEYWORD TOOL WAS AVAILABLE. NOTHING HERE IS MEASURED.
>
> This plan was written with **no access to Apple Search Ads, App Store Connect search-term reports, Sensor Tower, AppTweak, Appfigures, data.ai, or Google Play Console's search-terms data.** There are therefore **no search volumes and no difficulty scores in this document** — not approximate ones, not "estimated" ones. Fabricating them would be worse than omitting them: a made-up volume number is indistinguishable from a real one once it is in a document, and it will be planned against.
>
> What this file gives you instead: a **ranked hypothesis set with the reasoning behind each rank**, a **field mapping** (which listing field carries which term and why), and a **validation protocol** in §5 that says exactly what to measure and with what. Treat every ranking below as a prior to be overwritten by the first real data.

---

## 1. The intent model

Three distinct searchers reach a wardrobe app, and they use different words. Conflating them is how listing copy ends up ranking for traffic that does not convert.

| Segment | What she types | What she wants | Does this MVP serve her? |
|---|---|---|---|
| **A — The organiser** | "closet organizer app", "wardrobe app", "digital closet" | An inventory. Wants to *see* what she owns. | **Yes, directly.** This is the core value. |
| **B — The morning decider** | "what to wear app", "outfit planner", "outfit ideas app" | A decision made for her. Doesn't care about inventory as an end. | **Yes** — weather-aware suggestions + saved outfits + laundry-awareness. |
| **C — The intentional dresser** | "capsule wardrobe app", "wear what I own", "shop my closet" | To buy less and use more of what she has. | **Partly.** The wear log gives her a real record; cost-per-wear analytics are **roadmap, not shipped** (`docs/roadmap.md`) and must not be implied. |

**A fourth segment we deliberately do not target: the try-on searcher.** "virtual try on", "see clothes on me", "body shape app", "what suits my body type" are high-volume and completely unserved by this MVP. Try-on and body geometry are roadmap-only; the app never scans, measures, or models the body. **Ranking for those terms would generate installs that refund.** They are excluded from every field, and they are listed in §4 so nobody adds them later thinking it was an oversight.

---

## 2. The target set, ranked by expected value

Ranked on `(relevance to what actually ships) × (plausible intent-to-convert) ÷ (plausible competition)`. **The competition column is reasoning from category structure, not a difficulty score.**

### Tier 1 — head terms (must be indexed; will not rank quickly)

| Term | Segment | Why it matters | Competition reasoning |
|---|---|---|---|
| `closet app` / `closet organizer app` | A | The most literal description of the product | **Hardest.** Established free incumbents with years of ratings volume. A new app does not win these on-page; it wins them with ratings velocity over months. |
| `wardrobe app` | A | Second-most literal; likely the broadest single term | **Hard**, same reason. |
| `outfit planner` | B | Highest-intent head term for the daily loop | **Hard**, and the term the buyer's-guide blog post already targets — see §3 on cannibalisation. |
| `what to wear app` | B | Maps exactly to the product's own one-line pitch | **Hard but the best-fit head term.** If one head term is worth fighting for, it is this one, because the product genuinely answers it and the description can say so without stretching. |

### Tier 2 — mid-tail (where a new listing can realistically place)

| Term | Segment | Why it matters | Competition reasoning |
|---|---|---|---|
| `digital closet app` | A | Same intent as `closet app`, narrower phrasing | Moderate. Fewer exact-match titles. |
| `capsule wardrobe app` | C | A committed, self-selecting audience | Moderate. **Serve honestly** — the wear log is real; analytics are not. |
| `outfit planner with weather` | B | Weather-awareness is a **shipped, differentiating** feature (F5) | Moderate-low, and unusually well matched — most competitors do not do weather at all. **Strong candidate.** |
| `closet inventory app` | A | Utility framing, likely lower volume, higher intent | Moderate-low. |
| `outfit ideas app` | B | Softer intent than "planner" | Moderate. |

### Tier 3 — long tail (highest conversion, lowest volume; where the description earns its keep)

| Term | Segment | Why it matters |
|---|---|---|
| `app that scans your closet` / `closet app that uses your photos` | A | Describes the actual mechanism. Whoever types this **wants exactly this product** — nothing else in the category builds a closet from a camera roll. **The single best intent match in the whole set.** |
| `wardrobe app that tracks laundry` | A/B | Laundry-awareness (F7) is shipped and rare in the category. |
| `outfit app for what's clean` | B | Long, specific, and precisely what F5 + F7 do together. |
| `private closet app` / `closet app privacy` | all | The privacy differentiator. **Cannot be leaned on until the classifier ships** — see §6. |
| `wear log app` / `track what I wear` | C | The wear log (F8) is shipped and is the retention loop. |
| `outfit planner no ads` / `closet app without ads` | all | True: no ads, no ad SDKs. Cheap credibility. |

### Terms that describe features we ship but that nobody searches

`color harmony`, `swatch quiz`, `dedupe`, `garment cutout`. These belong in the **description as proof**, never as ranking targets. Naming them builds credibility with a reader who is already on the page; they win no traffic.

---

## 3. Field mapping — which field carries which term

Apple and Play index differently, so the same term lands in different places. This is the operative table.

| Term | Apple: name | Apple: subtitle | Apple: keywords | Apple: description | Play: title | Play: short desc | Play: full desc |
|---|---|---|---|---|---|---|---|
| closet | ✅ `Closet` | — | ❌ *(already in name)* | ✅ prose | ✅ | ✅ | ✅ repeated |
| outfits / outfit | ✅ `Outfits` | — | ❌ *(already in name)* | ✅ prose | ✅ | — | ✅ repeated |
| wardrobe | — | ✅ | ❌ *(already in subtitle)* | ✅ prose | — | — | ✅ repeated |
| planner | — | ✅ | ❌ *(already in subtitle)* | — | — | — | ✅ |
| photos / camera roll | — | ✅ `photos` | ❌ | ✅ prose | — | ✅ `camera roll` | ✅ repeated |
| organizer / organiser | — | — | ✅ both spellings | — | — | — | ✅ |
| style / styling | — | — | ✅ | ✅ | — | — | ✅ |
| clothes / clothing | — | — | ✅ both | ✅ | — | — | ✅ |
| fashion | — | — | ✅ | — | — | — | — |
| capsule | — | — | ✅ | — | — | — | — |
| laundry | — | — | ✅ | ✅ prose | — | — | ✅ |
| weather | — | — | ✅ | ✅ prose | — | — | ✅ |
| inventory | — | — | ✅ | — | — | — | — |
| daily | — | — | ✅ | ✅ | — | — | ✅ |
| what to wear today | — | — | ❌ *(phrase; Apple recombines single words)* | ✅ prose | — | ✅ | ✅ |
| long-tail phrases (Tier 3) | — | — | ❌ | ✅ prose | — | — | ✅ prose |

**The two rules that generate this table:**

1. **Apple: never duplicate across name/subtitle/keywords.** Apple indexes all three and recombines individual words into phrases; a word in two fields is wasted budget out of only 100 characters. Every ❌ in the Apple keywords column above is a deliberate omission, and each one buys characters for a word that would otherwise not be indexed at all. See `app-store-listing.md` §5.
2. **Play: the opposite.** Play indexes the full description, so head terms are repeated in natural prose there. This is why `google-play-listing.md` has no keyword field and a longer, more term-dense description — it is not padding.

**The dependency nobody should miss:** the Apple ❌ marks are only valid while the name is `[App Name]: Closet & Outfits`. If the real name is long enough to drop the descriptor, `closet` and `outfits` stop being indexed by the name and **must be moved into the keyword field**, which then needs ~15 characters freed. The fallback ladder is in `app-store-listing.md` § "Character budget risk".

---

## 4. Terms deliberately excluded — the refusal list

Each of these is plausibly high-volume. Each is excluded because the MVP does not do it. **Do not add them.**

| Excluded term | Why |
|---|---|
| `virtual try on`, `try on clothes`, `see clothes on me` | **Try-on does not exist.** Roadmap-only (`docs/roadmap.md`, `docs/01` "Out of scope"). Installs from these terms refund and leave one-star reviews. |
| `body shape`, `body type`, `what suits my body`, `measurements` | **The app never scans, measures, or models the body.** No such code, no such column. Also body-shame-adjacent framing this product refuses on its own terms. |
| `skin tone analysis`, `color analysis camera`, `find my season with a photo` | **Skin tone is self-identified via a swatch quiz, never camera-detected** (`docs/01` B1, invariant 3). Camera-based skin tone is explicitly out of scope. `color analysis` without the camera framing is arguably fair for the swatch quiz, but it sits close enough to the camera-detection expectation that it is excluded until the palette is out of beta. |
| `outfit ideas for my body type`, `flattering outfits`, `slimming` | Prescriptive and body-shaming. Off-voice, and the product rule is **advisory, never prescriptive** (`docs/01`). |
| `shopping`, `where to buy`, `affiliate`, `gap fill` | No shopping surface exists. Roadmap-only. |
| `share outfits`, `outfit poll`, `style community` | No social surface exists. Roadmap Horizon 2. |
| `cost per wear`, `wardrobe analytics`, `closet stats` | The wear log ships; **analytics screens do not** (`docs/roadmap.md`). The record exists; the dashboard does not. |
| `free closet app`, `free wardrobe app` | The app has a **hard paywall and no free trial**. Ranking for "free" is a refund and one-star-review generator, and Apple treats "free" in metadata for a paid app as misleading. |
| `packing list`, `travel wardrobe`, `calendar outfits` | Travel/packing and calendar are roadmap-only. |
| Competitor app names | Rejection risk, IP risk. |

---

## 5. The validation protocol — what to measure, with what, in what order

Nothing above is data. This is how it becomes data. **Steps 1–2 gate the listing; steps 3–5 run after launch.**

**Step 1 — Get real volume and difficulty (before submission).** Pull popularity and difficulty for every Tier 1–3 term from at least **two** independent sources — the disagreement between them is itself information. Options: Apple's own **Search Ads keyword planner** (free with an Apple Search Ads account, and it reports Apple's real search-popularity signal rather than a vendor model), plus one of AppTweak / Sensor Tower / Appfigures / data.ai. For Play, add **Google Keyword Planner** and Play Console's own search-terms report once live. **Expected outcome that would change the plan:** if `outfit planner with weather` has effectively zero volume, it drops from the keyword field and stays only in the description as a differentiator.

**Step 2 — Check the actual SERP for each Tier 1–2 term, by hand, on a real device in the target storefront.** Read the top 10 results. Note: how many have the exact term in their *title* (the strongest difficulty proxy available without a tool), their rating counts, and whether any is a genuine camera-roll-scanning app. **Expected outcome that would change the plan:** if a well-rated incumbent already leads with "scan your closet from photos", the whole differentiation thesis needs re-examining, not just the keywords.

**Step 3 — Run Apple Search Ads on a small budget as a measurement instrument, not just acquisition.** ASA's search-term report is the only source that reveals **what real users actually typed** to reach the app, including terms nobody would have guessed. This is the single highest-value validation step and it cannot be substituted by any tool. Feed discovered terms back into the keyword field.

**Step 4 — Iterate the fields on a schedule, one variable at a time.** Apple's keyword field and subtitle change only with a new binary version; promotional text changes any time. Play allows **store-listing experiments** (A/B on title, short description, icon, screenshots) with real traffic — Apple has no equivalent for those fields, so **use Play as the cheap experiment lab and port winners to Apple.** Change one field per release or the attribution is worthless.

**Step 5 — Watch conversion rate, not just rank.** A term that ranks and does not install is worse than no ranking: it teaches the store's model the wrong thing about the app. Judge every term on install-and-retain, and specifically on **refund rate**, which is the fastest signal that a term promised something the app does not do.

**Two guardrails on the whole protocol:**
- **The `[App Name]` token blocks step 1 partially.** Brand-term volume is unmeasurable until the name exists, and name choice itself has ASO consequences: a name containing a category word ("Closet", "Wardrobe") gets that word indexed with the heaviest weight, which would change the keyword field materially. **If the name is not yet chosen, feed this back into the naming decision** — it is cheaper to pick an ASO-friendly name than to compensate for a hard one for years.
- **Localisation is not translation.** Each storefront gets its own 100-character Apple keyword field and its own Play listing. A translated keyword list underperforms a natively-researched one. Do not spend on localisation until en-US is validated.

---

## 6. Cross-reference with the SEO content — do not cannibalise

The blog set in `content/blog/` already owns specific web-search intents. **App-store ASO and web SEO are separate indexes and cannot cannibalise each other directly** — Apple/Play search and Google web search are different systems. But there are two real ways they collide, and `content/README.md` records that cannibalisation was already the top self-critique finding within the blog set, so the risk is live.

Existing web targets, from the blog frontmatter (read, not assumed):

| Page | `targetKeyword` |
|---|---|
| `how-to-organize-your-wardrobe` (pillar) | how to organize your wardrobe |
| `how-to-digitize-your-closet` | digitize my closet |
| `outfit-planner-app-guide` | outfit planner app |
| `capsule-wardrobe-app-guide` | capsule wardrobe app |
| `what-to-wear-nothing-to-wear` | what to wear when you have nothing to wear |
| `outfit-ideas-from-your-own-closet` | outfit ideas from my own closet |
| `premium-closet-app` | premium closet app |
| `landing/landing-page` | `[App Name]` — **`robots: noindex`**, canonical → `/blog/premium-closet-app` |

**Collision 1 — two of the blog head terms are also app-store head terms.** `outfit planner app` (the buyer's-guide post) and `capsule wardrobe app` (the capsule post) are also in Tier 1/2 above. This is **fine and actually desirable**: on a Google web SERP for "outfit planner app", the ideal outcome is the blog article ranking *and* the App Store product page appearing — two shots at the same searcher. The store listing does not compete with the blog for the web ranking, because the store page is a different domain and a different result type.

**Collision 2 — the real risk: divergent claims across surfaces.** Google indexes App Store and Play product pages as web pages. So a searcher for "premium closet app" may see the blog post, the landing page, *and* the store listing. If those three describe the product differently, the inconsistency is visible in a single SERP. Two live divergences to fix:

- **The sub-processor disclosure.** Both store descriptions in this directory state that approved photos are processed by image-processing partners. `content/landing/landing-page.md` does **not** (`docs/legal/README.md` §3, tension **T1**). The store listings are the more honest surface; the landing page should be reconciled to match — **that is a `content/landing/` edit and not this file's to make.** Reported as a finding.
- **"Digitized in seconds."** `content/README.md` records that this was fixed across the blog set to consistently mean the *preview*, not the whole closet, but the landing-page headline still reads as the whole closet (`docs/legal/README.md` §3, tension **T4**). Both store descriptions here say "a preview of your real closet… in seconds" and locate the full build after payment. Same fix needed on the landing page.

**Collision 3 — the privacy angle is the strongest differentiator in both channels and is currently unusable in both.** `private closet app`, `closet app privacy`, and the whole "screened on your device" framing are the least-contested, highest-differentiation terms available — the category simply does not compete here. **They cannot be leaned on until the on-device classifier exists and clears its recall floor** (`docs/LAUNCH-READINESS.md` §3, §7 step 7; `docs/legal/README.md` §3 tension **T2**: *"must not ship the claim at all until the classifier exists"*). Until then: keep the approval-tap claim, which is structurally true in the shipped code, and do not target the screening terms. **When the classifier lands, this becomes the highest-leverage ASO change available** — revisit §2 Tier 3 and the subtitle at that point.
