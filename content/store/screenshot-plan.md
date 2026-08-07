# Screenshot plan — a SHOT LIST, not deliverable assets

> ## NO SCREENSHOT CAN BE PRODUCED YET. NOT ONE.
>
> **No screen in this app has ever been rendered — not on a device, not on a simulator, not once.**
>
> `docs/LAUNCH-READINESS.md` §3, verified against the tree: *"The frontend is STRUCTURAL only — never rendered… 'VISUAL OUTPUT UNVERIFIED / HUMAN-GATED: no simulator ran.' Screens compile and are wired to hooks with loading/empty/error states, each carrying a `VISUAL UNVERIFIED` comment, but nobody has seen them render. There is no evidence any screen looks premium — or even correct."*
>
> And the screens could not show anything real even if they rendered: `docs/LAUNCH-READINESS.md` §3 also records that **the parse pipeline returns HTTP 502** because no GPT-4o or Photoroom adapter is wired (`parse-photo.ts` binds `unwiredPorts()`). **The reveal — the single most important screenshot in this list — literally cannot happen yet.** There are no cutouts to photograph.
>
> So this file is a **shot list awaiting real captures**. It specifies order, screen, caption, and the one benefit each frame must prove, so that when the visual pass happens (`docs/LAUNCH-READINESS.md` §7 step 6) the capture session is one focused pass instead of five.
>
> **Nothing in this file may be produced by mockup, illustration, or hand-composited art and submitted as a screenshot.** Both stores require screenshots to represent the actual in-app experience; a designed frame showing a screen that does not exist is a rejection and a misrepresentation. When the captures are real, styling them with device frames and caption bands is fine — inventing the content is not.

---

## The sequence — 8 frames

Screenshot 1 does most of the work (it is the only one most browsers see) and frames 1–3 are what appears in search results. The order below front-loads the differentiator, then the daily loop, then the price honesty.

Captions are counted. Keep them short: they render small, and long captions break in localisation.

### 1 — The reveal *(the whole pitch)*

- **Screen:** the onboarding reveal — her own garments as clean cutouts in the wardrobe-preview grid (`docs/01` F1 step 5).
- **Caption (46 chars):** `Your real closet, from photos you already have`
- **The one benefit it proves:** *your clothes are already in here, and you didn't do any work.* This is the aha (`docs/00`: "she sees her actual clothes, cut out and organized, almost immediately"). If a browsing user sees only one frame, this is the one that has to land.
- **Capture notes:** needs a **real, plausible camera roll** on the capture device — a woman's actual clothing photos, varied categories and colours. A synthetic 6-item test fixture will look like a demo and kill the frame. **This is a content-sourcing problem the owner has to solve, and it involves real photographs of a real person, so it needs consent.**

### 2 — The on-device screening step *(the differentiator)*

- **Screen:** the approve step — candidate clothing photos with the on-device screening state visible, before any upload.
- **Caption (36 chars):** `Nothing uploads until you approve it`
- **The one benefit it proves:** *you are the filter, and the filtering happens before anything leaves your phone.*
- **BLOCKED TWICE OVER, and this is the important note in this file:** the classifier does not exist (`docs/LAUNCH-READINESS.md` §3 — `git grep classifier|intimate|nsfw` returns nothing), and the screen does not exist. **The caption above is written to be true either way** — it claims only the approval tap, which is a structural guarantee in the shipped code, and claims nothing about what the screening caught. If the classifier ships and clears its recall floor, a stronger caption becomes available (`Screened on your device before anything uploads`, 47 chars). **Until then, do not upgrade this caption.** See `docs/legal/README.md` §3 tension T2.
- **Capture notes:** obviously, **do not put a real intimate photo on the capture device to demonstrate filtering.** Show the approve grid of clothing candidates and let the caption carry the claim. This is a shot that could easily be composed carelessly.

### 3 — The wardrobe library

- **Screen:** `WardrobeScreen` — the full grid of cutouts with a filter visibly applied (category or colour).
- **Caption (38 chars):** `Your whole wardrobe, in one clean grid`
- **The one benefit it proves:** *you can finally see everything you own at once.* This is the answer to the "remembering problem" the pillar blog post opens on.
- **Capture notes:** needs enough items to look like a real wardrobe — 30+ garments, not 8. A sparse grid reads as an unfinished app.

### 4 — Today's suggestion

- **Screen:** `SuggestionsScreen` — a suggested outfit with the weather signal visible.
- **Caption (48 chars):** `An outfit for today's weather, from what's clean`
- **The one benefit it proves:** *the morning decision is already made, and it accounts for reality.* Two shipped features in one frame (F5 weather-aware + F7 availability), and weather-awareness is rare in the category (see `aso-keyword-plan.md` Tier 2).
- **Capture notes:** capture in **cold or wet weather**, or with a weather fixture that shows layers. A sundress on a sunny day proves nothing — the frame needs to show the app *reacting* to conditions.

### 5 — The outfit builder

- **Screen:** `OutfitsScreen` / the manual builder mid-compose, slots filling.
- **Caption (41 chars):** `Build a look yourself. Save it. Reuse it.`
- **The one benefit it proves:** *you are not stuck with the algorithm's taste.* Directly answers the objection that an AI suggestion app will override her judgement — and it is the frame that makes "advisory, never prescriptive" (`docs/01`) visible rather than merely stated.

### 6 — Laundry / availability

- **Screen:** `LaundryScreen` — items across clean / in the wash / unavailable.
- **Caption (31 chars):** `Laundry, without the guilt trip`
- **The one benefit it proves:** *the app matches your actual life, and doesn't treat laundry as a failure.* Nobody searches for this, but it is disproportionately convincing to a woman who has abandoned a closet app that kept suggesting a dress in the wash.
- **Voice guard:** the language stays neutral. Laundry is normal life, not an error state (`content/blog/premium-closet-app.md`). No red badges, no warning icons, no scolding empty state.

### 7 — The wear log

- **Screen:** the one-tap "I wore this" interaction, ideally mid-tap or with the confirmation visible.
- **Caption (20 chars):** `One tap: I wore this`
- **The one benefit it proves:** *keeping it accurate costs you one second.* The retention loop (F8), and the honest version of the promise — it does not claim analytics, because analytics screens are roadmap-only.
- **Do NOT caption this** with cost-per-wear, "see your most-worn items", or any stats framing. The record ships; the dashboard does not (`docs/roadmap.md`).

### 8 — Colour help + the palette (beta)

- **Screen:** colour-pairing guidance in the builder, or the palette quiz result with `beta` visible.
- **Caption (37 chars):** `Colors that go together — never rules`
- **The one benefit it proves:** *there is help with colour, and it is advisory.* The caption carries both halves deliberately; the second half is the product's own non-negotiable (`docs/01`: advisory, never prescriptive).
- **Two hard voice guards on this frame:**
  - The `beta` label must be **visible in the captured pixels** if the palette is shown. It is labelled beta in-product (`docs/01` B1) and the store frame must not quietly upgrade it.
  - **Nothing may imply the camera read her skin tone.** The quiz is swatches she picks. If the frame shows the quiz, it must show *swatches*, never a photo of a face or arm.

### Frames considered and cut

- **A paywall/pricing frame** (`See your closet before you pay`, 30 chars). Cut for 1.0: the price, period, and trial fields are unresolved (`docs/legal/subscription-terms.md` `TBC-40`/`TBC-41`/`TBC-42`), and a screenshot showing a price is a representation that must match the localised store price in every storefront — expensive to maintain and easy to get wrong. The "no free trial, you see it first" argument is carried in prose in both descriptions instead. **Revisit once pricing is locked**; the honesty of the pricing story is a genuine differentiator and it may be worth a 9th frame.
- **An empty/first-run state.** Never a store screenshot.
- **A "before/after" of a messy closet.** Off-voice, and edges toward shaming the user for her closet.

---

## Required device sizes

### Apple — App Store Connect

Apple accepts one set per display class and scales down within a class, so **the practical minimum is two sets** (plus iPad only if the app is submitted as iPad-compatible).

| Display class | Required resolution (portrait) | Count |
|---|---|---|
| **6.9" iPhone** (the current required class) | 1290 × 2796 | **2–10. Required.** |
| **6.5" iPhone** | 1242 × 2688 | Required if not covered by scaling from 6.9" — verify against the current App Store Connect spec at submission. |
| **13" iPad** | 2064 × 2752 | **Only if the app is submitted as iPad-compatible.** |

- **Decide early whether 1.0 ships iPad support.** If the Expo build declares iPad compatibility, iPad screenshots become mandatory and the layout must actually work on iPad — verified against nothing today, since nothing has rendered. **Recommendation: ship iPhone-only for 1.0** and avoid an entire untested surface.
- Apple's exact required display classes change with each hardware generation. **Verify against the live App Store Connect specification at submission — do not trust this table's numbers on submission day.**
- Portrait only. The app is a portrait phone experience; there is no landscape design.

### Google Play — Play Console

| Asset | Spec | Count |
|---|---|---|
| **Phone screenshots** | 16:9 or 9:16 aspect; each side between 320 px and 3840 px; PNG or JPEG | **Minimum 2, maximum 8. Required to publish.** |
| **7-inch tablet** | Same format rules | Only needed for tablet promotion eligibility. Not planned for 1.0. |
| **10-inch tablet** | Same format rules | Not planned for 1.0. |
| **Feature graphic** | **1024 × 500**, PNG or JPEG, **no alpha channel** | **Required to publish. This is not a screenshot** — it is original artwork, and it is a separate blocked deliverable. Keep the centre clear: a play button is overlaid on it when a promo video exists. |
| **App icon** | 512 × 512 PNG, 32-bit | **Required.** Blocked on the name and the visual pass. |

**Note the maximum differs:** Apple allows up to 10 phone screenshots, Play only 8. This plan has 8, so it fits both without re-cutting — that is why it is 8 and not 10.

---

## Capture protocol, for whoever runs the session

Sequenced so that a single session produces everything, rather than discovering a blocker halfway.

1. **The app must actually work first.** Real parse adapters wired (`docs/LAUNCH-READINESS.md` §7 step 3) and a real deployed backend (step 4). Until parse returns cutouts instead of 502, frames 1 and 3 are impossible and 4–8 have nothing to display.
2. **Source a real camera roll, with consent.** Frames 1 and 3 need a genuine wardrobe's worth of clothing photos of a real person. **This is the longest-lead item in this file and it is not a technical task.** It needs a person's informed agreement that her photos will appear in a public app store listing.
3. **Do the visual design pass before capturing.** Capturing an unstyled build wastes the session. The screens have never been seen; expect the first render to need real design work against `docs/03` tokens, not touch-ups.
4. **Use the sim skills, never raw `simctl`.** Per `CLAUDE.md`: ask before booting, iOS first, Android parity second, never both at once.
5. **Capture at native resolution, portrait, no debug overlays.** No dev menu, no yellow warning boxes, no placeholder strings, and **no `[App Name]` token visible in any captured pixel.** That last one is easy to miss and is an instant rejection.
6. **Status bar:** full signal, full battery, a neutral time. Both stores accept a real status bar; an inconsistent one across frames looks careless in a set that is meant to read as premium.
7. **Get the owner's sign-off on "does it feel premium."** That judgement is not agent-gradeable and is an explicit human gate (`docs/LAUNCH-READINESS.md` §5).
8. **Re-read every caption against the shipped build before uploading.** Each caption above asserts a behaviour. If a feature shifted during the visual pass, the caption is now a false claim in a store listing.
