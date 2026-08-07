# App Privacy "nutrition label" + Play Data safety — draft answers

**Status:** unpublished draft. **These answers are derived from the system as designed and documented (`docs/legal/privacy-policy.md`, itself derived from the applied schema and the function source) — NOT from a shipped binary, because there is no shipped binary.**

> ## READ THIS FIRST — the re-derivation requirement
>
> **A mismatch between this label and what the app actually does is (a) one of the most common App Review rejections and (b) an FTC Section 5 deceptive-practices exposure in the US, plus a GDPR Art. 13/14 transparency failure in the EU/UK.** The label is a representation to users, not a form to be filled in from intent.
>
> Two structural reasons this draft *will* be wrong by submission day if nobody re-derives it:
>
> 1. **The app is not finished.** Verified in the tree today: the mobile package's dependencies (`packages/mobile/package.json`) contain **no RevenueCat SDK** and **no analytics/crash/attribution SDK of any kind**; `PaywallScreen.tsx:4` states the RevenueCat purchase call is deliberately not wired; and no Apple/Google sign-in call exists in `packages/mobile/src/api/supabase.ts`. **Every one of those has to be added before launch**, and each addition can change a label answer — an SDK you add for one purpose often collects an identifier you did not intend to declare. RevenueCat in particular will collect a purchase/user identifier and, depending on configuration, a device identifier.
> 2. **Apple's label covers third-party SDK collection, not just your own.** You must declare what an embedded SDK collects even if your own code never reads it. That means the answers below cannot be finalised until the final dependency list is frozen.
>
> **Required at submission time, by a human, in this order:**
> 1. Freeze the dependency list. Enumerate every SDK in the shipped binary (`packages/mobile/package.json` plus transitive native modules) and read each one's published privacy manifest / data-collection disclosure.
> 2. For each SDK, diff its declared collection against this file. Apple additionally requires **privacy manifests (`PrivacyInfo.xcprivacy`) from SDKs on its "commonly used third-party SDK" list** and will reject builds where a listed SDK ships without one — check whether any dependency is on that list.
> 3. Re-read `docs/legal/privacy-policy.md` §3 against the *shipped* code and reconcile any drift in both directions.
> 4. Confirm `docs/legal/README.md` **`TBC-11`** (no analytics/crash/attribution SDK was added) is still true. **If any was added, this file is wrong and so is the privacy policy.**
> 5. Only then complete the App Store Connect and Play Console forms.

---

## Part 1 — Apple App Store "App Privacy"

Apple's form asks, for each data type: is it **collected**? Is it **linked to the user's identity**? Is it used for **tracking**? And for what **purposes**?

### 1.1 The tracking answer, stated first because it is the one that matters most

**Is any data used for tracking? NO.**

Apple's definition of tracking is linking data from this app with data from other companies' apps, websites, or offline properties for advertising or advertising measurement, or sharing data with a data broker. None of that happens:

- No advertising SDKs, no ad identifiers (IDFA), no attribution/MMP SDK, no third-party analytics (`docs/legal/privacy-policy.md` §3.1, subject to `TBC-11`).
- No data broker relationships.
- No cross-app or cross-site identity graph.

**Consequence:** **no App Tracking Transparency prompt is required.** Do not add one — an unnecessary ATT prompt on an app that does not track is itself a review finding, and it trains users to distrust the permission.

**Re-verify before submission:** if a crash reporter or analytics SDK is added late "just for launch visibility", this answer may flip, an ATT prompt may become mandatory, and the privacy policy's "we do not use analytics products" sentence becomes false. This is the single most likely way this label breaks.

### 1.2 Data types — collected / linked / purpose

"Linked to you" means associated with the user's identity. Everything in this app is stored under the account identifier from the verified sign-in token and isolated by RLS — so where data is collected, **it is linked.** There is no anonymous or aggregated collection path.

| Apple data type | Collected? | Linked to identity? | Used for tracking? | Purpose | Basis in the tree |
|---|---|---|---|---|---|
| **Contact Info → Email Address** | **Yes** | **Yes** | No | App Functionality (account creation and sign-in) | Supabase Auth stores the provider email, which for Sign in with Apple may be a private-relay address (`privacy-policy.md` §3.1) |
| **Contact Info → Name, Phone, Physical Address, Other** | **No** | — | — | — | Never requested (`privacy-policy.md` §3.1: "We do not ask for your name, address, phone number…") |
| **Identifiers → User ID** | **Yes** | **Yes** | No | App Functionality | The provider account id / JWT `sub`; also the RevenueCat app-user id linking the account to subscription state |
| **Identifiers → Device ID** | **Re-derive** | — | No | — | **Not collected by our own code.** But an SDK added later (RevenueCat, or any crash reporter) may collect one. **Answer this against the frozen dependency list, not from intent.** |
| **User Content → Photos or Videos** | **Yes** | **Yes** | No | App Functionality | The approved photo files are uploaded to the private `originals` bucket under a per-account folder; derived cutouts go to `cutouts` (`privacy-policy.md` §3.3) |
| **User Content → Other User Content** | **Yes** | **Yes** | No | App Functionality | Outfit names (free text the user types), garment attributes, availability states, the wear log, and the self-identified palette hue set (`privacy-policy.md` §3.3) |
| **User Content → Customer Support, Emails/Text Messages, Audio, Gameplay** | **No** | — | — | — | No in-app messaging, no audio, no support inbox in the binary |
| **Purchases → Purchase History** | **Yes** | **Yes** | No | App Functionality | Entitlement-active flag, expiry, last event timestamp, provider app-user id (`subscriptions` table). **We never see or store card details** — Apple is the seller of record |
| **Financial Info → Payment Info, Credit Info** | **No** | — | — | — | Handled entirely by Apple; never transits our systems (`privacy-policy.md` §3.1) |
| **Location → Coarse Location** | **Re-derive — likely Yes** | **Probably No** | No | App Functionality (weather for outfit suggestions) | **The weather lookup is designed but NOT IMPLEMENTED** (`privacy-policy.md` `TBC-10`). As designed, the device sends coordinates **directly to the weather provider**; coordinates are not sent to us and no location is stored server-side. **But Apple's label covers collection by the app and by embedded SDKs, so "we never receive it" is not automatically "not collected".** Resolve `TBC-10` (provider, precise vs coarse, whether it logs IPs) and answer against the shipped implementation. |
| **Location → Precise Location** | **Re-derive** | — | No | — | Only if the implementation requests precise. **Prefer coarse** — weather does not need precise, and precise location on a women's app is an unnecessary risk surface. |
| **Health & Fitness** (incl. body/fitness data) | **No** | — | — | — | **Structurally absent.** No body scanning, no measurement, no body model, no try-on. Verified: no such code and no such column (`docs/legal/README.md` §3 closing note) |
| **Sensitive Info** (racial/ethnic, sexual orientation, biometric, etc.) | **No** — but see the note below | — | — | — | Skin tone is **self-identified via a swatch quiz**, never camera-detected; `palette_profile` stores only a resulting hue set. No facial recognition, no face templates, no biometric identifiers (`privacy-policy.md` §3.2) |
| **Contacts** | **No** | — | — | — | Contacts are never read; there is no social or invite feature |
| **Browsing History, Search History** | **No** | — | — | — | No in-app browser; no search-term logging |
| **Usage Data → Product Interaction, Advertising Data, Other Usage Data** | **No** | — | — | — | No analytics SDK (`TBC-11`). **Note the wear log is *not* usage analytics** — it is user content the user creates deliberately, declared above |
| **Diagnostics → Crash Data, Performance Data, Other Diagnostic Data** | **No — re-derive** | — | — | — | No crash reporter today. Server-side structured logs are keyed to a per-request correlation id and are designed to exclude raw error text and request bodies. **If a crash SDK is added, this flips and so does §1.1** |

### 1.3 The two answers most likely to be got wrong

**(a) "Sensitive Info" and the photographs.** The label answer is "No" on Apple's *enumerated* sensitive categories (Apple's list means racial/ethnic data, sexual orientation, pregnancy, disability, religious belief, political opinion, genetic, biometric). But `docs/legal/privacy-policy.md` §3.1 flags **`TBC-08`**: counsel must determine whether garment photos of the user constitute GDPR Art. 9 **special category data** — for example because they may reveal ethnicity or religious dress. **These are two different legal questions with two different answers, and it is a mistake to let the "No" on Apple's form be read as settling the GDPR one.** If counsel concludes Art. 9 applies, the privacy policy and the legal basis change even though this label answer may not.

**(b) Photos are declared under "User Content", not skipped because they are "just processed".** They are uploaded, stored under the account, and **retained after processing** (`privacy-policy.md` §3.4 / `TBC-14`). Retention is not what the label asks about — but it is what a user reading the label will assume, so the policy must state the retention decision plainly. `TBC-14` is unresolved: originals are currently kept indefinitely.

---

## Part 2 — Third parties, disclosed

Every external party that receives data. **Two of them receive the user's photographs**, which is the single most consequential fact in this document.

| Third party | What it receives | Why | Photos? |
|---|---|---|---|
| **Supabase** | All stored data: database rows, both photo buckets, authentication records, and the server functions' runtime | Hosting — database, private storage, auth, Edge functions | **Yes** — stores them |
| **OpenAI** (GPT-4o vision) | The approved photo, sent from our server function only | Extracts garment attributes: category, colour, pattern | **Yes** — processes them |
| **Photoroom** | The approved photo, sent from our server function only | Removes the background to produce the clean garment cutout | **Yes** — processes them |
| **RevenueCat** | Subscription events and an app-user identifier. No photos, no wardrobe data | Manages subscription state; tells our server when entitlement starts or ends | No |
| **Apple** (and **Google** on Play) | The user's payment details, which we never see | Seller of record for the in-app purchase | No |
| **Weather provider** | Coordinates, sent **directly from the device**, not via us | Local weather for outfit suggestions | No — **and unresolved** (`TBC-10`); the lookup is not implemented yet |

**The honesty problem this table exists to prevent.** `docs/legal/README.md` §3 tension **T1** records that `content/landing/landing-page.md` never mentions that approved photos travel to third parties — a reader could reasonably conclude they are processed only by us. The claim is not false, but it is materially incomplete on exactly the point a privacy-motivated buyer cares about. **Both store descriptions in this directory therefore state the sub-processor fact explicitly**, so that the listing, the label, and the policy agree. If the landing page is later reconciled (that is a `content/landing/` edit, and not this file's to make), it should match this wording.

**Unresolved and blocking, per `docs/legal/README.md`:**
- **`TBC-21`** — signed DPA / GDPR Art. 28 processor terms per provider. Status unknown for all six.
- **`TBC-22`** — for OpenAI and Photoroom specifically: whether submitted images are used to train models, the provider's own retention period, and whether zero-retention / no-training terms are available and **enabled**. `docs/legal/README.md` calls this the highest-sensitivity sub-processor question in the set, *because these are photographs of the user*, and warns that `terms-of-service.md` §5 promises we do not train on user content — **a promise that must not overpromise what the provider contracts actually deliver.** If zero-retention terms are not enabled, the marketing privacy voice and the contractual reality diverge, and the marketing must change.
- **`TBC-23`** — per-provider international-transfer mechanism, and the region the hosting project is provisioned in (which determines **where the photographs physically sit**).

---

## Part 3 — Google Play "Data safety" — where it differs

Play asks a different set of questions from Apple, and three of them have no Apple equivalent. Same underlying facts; do not paste Apple's answers.

| Play question | Answer | Note |
|---|---|---|
| Does your app collect or share any required user data types? | **Yes — collect.** | |
| Is data **shared** with third parties? | **Yes.** | Play's "shared" means transferred to a third party. Photos go to OpenAI and Photoroom for processing; subscription data goes to RevenueCat. Play does distinguish "processing on your behalf" from sharing in some cases — **read the current definition at submission and answer against it, not against intuition.** |
| Data types: Photos, Personal info (email, user IDs), Purchase history, App activity, Location (approximate) | As per Part 1 | Play's taxonomy is coarser than Apple's; Photos and Purchase history map directly. |
| Is all collected data **encrypted in transit**? | **Yes** | All traffic is HTTPS to Supabase and to providers. **Verify against the shipped binary** — no Apple equivalent question. |
| Do you provide a way for users to **request data deletion**? | **Yes — but not yet built end to end.** | The deletion endpoint is being implemented; the in-app UI path is `TBC-24` and unbuilt. **Play additionally requires a publicly reachable web deletion URL that does not require installing the app** — a Play-only deliverable, and it needs a domain to exist. |
| Is data collection **optional** for any type? | **Partly.** | The self-identified colour palette is fully optional and skippable. Photo scanning can be replaced by hand-picking specific photos. Email and user ID are required for the account. |
| Has the app undergone an **independent security review**? | **No.** | Answer honestly. There has been no third-party review. Answering "yes" without one is a false representation and Play may ask for the report. No Apple equivalent question. |
| Is the app in the **Families** programme? | **No** | See the target-audience decision in `google-play-listing.md` §7 (`TBC-27`). |

---

## Part 4 — What blocks completing these forms

| Blocker | Owner |
|---|---|
| **The dependency list is not frozen.** No RevenueCat SDK, no auth provider call, no crash reporter in the mobile package yet — all must land, and each can change an answer | Mobile |
| **`TBC-11`** — confirm no analytics/crash/attribution SDK was added, and align the label, the ATT answer, and the policy | Owner + mobile |
| **`TBC-10`** — the weather provider is not implemented; the Location answers cannot be finalised (and precise-vs-coarse is a real choice, not a formality) | Mobile + owner |
| **`TBC-08`** — whether garment photos are GDPR Art. 9 special category data | Counsel |
| **`TBC-14`** — the retention decision for original photos (currently: kept indefinitely) | Counsel + owner |
| **`TBC-21` / `TBC-22` / `TBC-23`** — DPAs, image-training and provider-retention terms, transfer mechanisms | Counsel |
| **`TBC-24`** — in-app export and delete paths, plus Play's public web deletion URL | Mobile + owner |
| **A hosted privacy policy at a real URL** — both stores require it; no domain exists (`docs/legal/README.md` §2.1) | Owner |
| **The privacy classifier does not exist**, so the "screened on your device" framing in the listings is not yet shippable (`docs/LAUNCH-READINESS.md` §3). It does not change a label *answer* — the label describes collection, not filtering — but it does change whether the listing copy alongside it is true | Owner |
