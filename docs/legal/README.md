**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**

# docs/legal — launch legal documents (DRAFTS)

Three documents, all **drafts pending review by qualified counsel**. None has been reviewed, none is
published, and **publishing/hosting them is a human step** — see §4.

| File | Purpose |
|---|---|
| `privacy-policy.md` | The App-Store-required privacy policy. Data inventory, on-device gate, legal bases, sub-processors, transfers, retention, data-subject rights, security, children, changes |
| `terms-of-service.md` | Acceptable use, the advisory nature of all styling guidance, user content ownership + the narrow operating licence, warranty/liability placeholders, termination + effect of deletion, governing law |
| `subscription-terms.md` | Apple/Google auto-renewable-subscription disclosures: what the subscription unlocks, auto-renewal, platform cancellation, restore, refunds, and the paywall disclosure text |

Every document is grounded in the system as actually built: `docs/06-backend-design.md`,
`packages/db/migrations/0001`–`0012`, `packages/mobile/src/api/supabase.ts`,
`packages/functions/src/`, and `content/landing/landing-page.md`. Facts that do not exist in the tree
were **not invented** — they are `[TO BE CONFIRMED: TBC-nn — …]` markers.

---

## 1. Every `[TO BE CONFIRMED]` placeholder — the single checklist

46 markers. Each appears in the drafts with the same `TBC-nn` id, so `grep -n "TBC-14" docs/legal/`
finds every occurrence. **Bold = blocks App Store submission** (see §2).

### Identity, jurisdiction, contact

| # | What is needed | Where |
|---|---|---|
| **TBC-01** | **Effective date for all three documents (do not publish with a placeholder date)** | all three |
| **TBC-02** | **Last-updated date for all three documents** | all three |
| **TBC-03** | **Controller / contracting legal entity: name, company number, registered address** | all three |
| TBC-04 | Confirm the controller/processor characterisation; whether a GDPR Art. 27 EU/UK representative is required | privacy §1 |
| **TBC-05** | **Privacy + support contact email address** | all three |
| TBC-06 | Whether a DPO is required and, if so, DPO name and contact | privacy §1, §12 |
| TBC-07 | Jurisdiction of establishment and lead supervisory authority | privacy §1, §6, §7 |

### Data classification and legal bases

| # | What is needed | Where |
|---|---|---|
| TBC-08 | Whether garment photos of the user are GDPR Art. 9 special category data, and which Art. 9 condition applies | privacy §3.1, §4 |
| **TBC-19** | **Contract vs consent for photo processing — the central counsel decision. If consent is chosen, the app needs consent-capture and consent-withdrawal mechanics that do not exist yet** | privacy §4, §7 |
| TBC-20 | Location of the legitimate-interests assessment for security/abuse processing | privacy §4 |
| TBC-28 | Confirm the GDPR Art. 22 (automated decision-making) position | privacy §10 |

### Retention (all currently unset policy decisions)

| # | What is needed | Where |
|---|---|---|
| TBC-09 | Hosting-provider platform-log contents and retention period | privacy §3.1, §3.3 |
| TBC-13 | How long deleted data persists in encrypted backups; confirm the window with the hosting provider | privacy §3.3, §7; terms §14 |
| **TBC-14** | **Retention period for original approved photos. Currently they are RETAINED after processing (`docs/06` §9 "Deliberately NOT built → Original-photo deletion after parse"). This is a real privacy consequence in tension with data minimisation — a decision, not a note** | privacy §3.3, §3.4 |
| TBC-15 | Whether completed `parse_jobs` rows are pruned earlier than account deletion | privacy §3.3 |
| TBC-16 | Retention period for `wear_log` history | privacy §3.3 |
| TBC-17 | Retention of the subscription record after cancellation/deletion, incl. tax/accounting duties | privacy §3.3 |
| TBC-18 | Retention for the `webhook_events` dedup ledger | privacy §3.3 |

### Sub-processors and transfers

| # | What is needed | Where |
|---|---|---|
| TBC-10 | Weather provider: confirm precise vs coarse location, exact provider, whether it logs IPs. **Note the weather lookup is designed but not implemented — confirm before the policy describes it as live** | privacy §3.1, §5 |
| **TBC-11** | **Confirm no analytics/crash-reporting/attribution SDK is added before submission, and align with the App Store Privacy "Nutrition Label" + App Tracking Transparency answers** | privacy §3.1 |
| TBC-12 | Confirm the US "sell/share" characterisation; whether a CPRA Notice at Collection / "Do Not Sell or Share" link is required | privacy §3.2 |
| **TBC-21** | **Signed DPA / GDPR Art. 28 processor terms in place, per provider: Supabase, OpenAI, Photoroom, RevenueCat, Apple, Google, weather** | privacy §5 |
| **TBC-22** | **OpenAI and Photoroom: contractual position on (a) training on submitted images, (b) provider-side retention, (c) whether zero-retention / no-training terms are available and enabled. Highest-sensitivity item in the set — these are photographs of the user. `terms-of-service.md` §5 promises we do not train on user content and must not overpromise what the provider contracts deliver** | privacy §5; terms §5 |
| **TBC-23** | **Per-provider international-transfer mechanism (SCCs / UK IDTA / adequacy / DPF), whether a TIA is done, and the region the hosting project is provisioned in (that is where the photos physically sit)** | privacy §6 |

### Rights, process, security

| # | What is needed | Where |
|---|---|---|
| **TBC-24** | **Exact in-app path for data export and account deletion, plus the export file format. The endpoints are being implemented in this same effort; the UI is not built** | privacy §7; terms §14 |
| TBC-25 | Operational DSAR process: identity verification, who owns the statutory deadline | privacy §7 |
| TBC-26 | Breach-notification process and the GDPR Art. 33 72-hour reporting owner | privacy §8 |
| **TBC-27** | **Minimum age, whether an age gate is implemented at sign-up, and the store age rating. High exposure: the app ingests photographs of the user. COPPA / UK AADC / GDPR Art. 8 all bear on this** | privacy §9; terms §2 |
| TBC-29 | Notice mechanism + notice period for material changes; whether a version archive is published; whether a paying subscriber may cancel penalty-free on an adverse change | privacy §11; terms §16 |

### Terms of Service — counsel drafting required

| # | What is needed | Where |
|---|---|---|
| TBC-30 | Enforcement process for acceptable-use breach: notice, appeal, any EU DSA obligations | terms §6 |
| TBC-31 | Whether any availability commitment / advance notice for adverse feature removal is offered | terms §8; subs §10 |
| **TBC-32** | **Warranty disclaimer — counsel to draft. Must be adjusted for non-excludable consumer rights (UK CRA 2015, EU Dir. 2019/770, AU, several US states). A blanket "AS IS" against consumers is unenforceable or unlawful in some target markets** | terms §11 |
| **TBC-33** | **Limitation of liability — counsel to set the cap and carve-outs. Cannot limit death/personal injury by negligence, fraud, non-excludable consumer guarantees, or GDPR Art. 82 liability** | terms §12 |
| TBC-34 | Whether a user indemnity is appropriate in a consumer app, and its scope | terms §13 |
| TBC-35 | Notice period + pro-rata refund position if the Service is discontinued mid-subscription | terms §14; subs §10 |
| **TBC-36** | **Governing law and jurisdiction (follows from TBC-03/TBC-07). Mandatory home-jurisdiction consumer rules apply in the EU/UK regardless of the clause** | terms §15 |
| TBC-37 | Dispute resolution: arbitration / class-action waiver (generally unenforceable vs EU/UK consumers), informal-resolution step | terms §15 |

### Subscription — commercial facts and store compliance

| # | What is needed | Where |
|---|---|---|
| TBC-38 | The preview-batch cap to state publicly. Server-side cap today is **10 photos per account** (`packages/functions/src/parse/teaser-cap.ts:5`) — an implementation value, not yet a published commitment | subs §1 |
| **TBC-39** | **The fair-use / cap wording on the paywall. The current paywall screen says "Unlimited garment parsing" while per-account caps and rate limits exist or are planned — see §3, tension T3** | subs §1 |
| **TBC-40** | **Price per period, per storefront. The paywall must render the localised store price, never a hardcoded figure** | subs §2, §7 |
| **TBC-41** | **Billing period(s) offered (monthly / annual)** | subs §2, §7 |
| **TBC-42** | **Free trial: confirm the recorded product decision (hard paywall, NO free trial) still holds. If any introductory offer is added, its length, end-of-trial behaviour and post-trial price must be disclosed adjacent to the purchase** | subs §2, §7 |
| **TBC-43** | **Restore Purchases control. Apple requires a restore mechanism; `packages/mobile/features/monetization/PaywallScreen.tsx` has no Restore control and its Subscribe button is a no-op — must be built and working before submission** | subs §5, §7 |
| TBC-44 | EU/UK 14-day withdrawal / cooling-off position for digital content and how it interacts with Apple's and Google's refund flows | subs §6 |
| TBC-45 | Align price-change language with current Apple/Google consent rules at submission time | subs §8 |
| TBC-46 | Whether Family Sharing / Google family library is enabled for the subscription product | subs §9 |

Also unresolved across the whole repository, and blocking these documents cosmetically as well as
commercially: **the product has no name.** Every occurrence is the literal token `[App Name]`
(consistent with `content/`). Resolving it is a human branding decision
(`docs/LAUNCH-READINESS.md` §5).

---

## 2. What is a hard App Store submission blocker

**Blocking because the store literally will not accept the submission without it:**

1. **A publicly reachable privacy-policy URL.** App Store Connect requires a Privacy Policy URL field
   for every app; Google Play requires one for any app collecting personal data. `privacy-policy.md`
   must be reviewed, finalised, and **hosted at a stable public URL**. There is no domain in the tree
   ([TO BE CONFIRMED] canonical-URL placeholders are still unresolved in `content/`), so there is
   currently nowhere to host it.
2. **Auto-renewable subscription disclosures in the binary, adjacent to the purchase control**
   (App Review Guideline 3.1.2): subscription name, length, price per period, auto-renewal statement,
   and links to the terms and privacy policy. See `subscription-terms.md` §7. This requires
   **TBC-40, TBC-41, TBC-42** to be real values and the paywall screen to render them.
3. **A functioning Restore Purchases mechanism** (TBC-43). Not present in the current paywall screen.
4. **A working in-app account-deletion path** — Apple has required apps that support account creation
   to also support in-app account deletion since 2022. The endpoint is being implemented in this
   effort; the UI path (TBC-24) is not built.
5. **App Store Privacy "Nutrition Label" answers + App Tracking Transparency** consistent with this
   policy (TBC-11). An inconsistency between the label and the policy is a review rejection risk and
   a misrepresentation risk.
6. **An age rating and, if a minimum age is set, an age gate** (TBC-27).
7. **A terms-of-service / EULA link.** Apple applies its standard EULA if none is supplied; supplying
   `terms-of-service.md` is strongly advisable given photo processing and third-party image providers,
   and it must also be hosted at a public URL.
8. **The product name** — the listing cannot be created against the token `[App Name]`.

**Not store-blocking but liability-blocking** (do not launch without them, even though review will
pass): TBC-19 (legal basis), TBC-21/TBC-22/TBC-23 (processor DPAs, image-training terms, transfer
mechanisms), TBC-14 (photo retention), TBC-32/TBC-33/TBC-36 (warranty, liability, governing law).

---

## 3. Where the marketing copy and the true system behaviour are in TENSION

Found by reading `content/landing/landing-page.md` against `docs/06-backend-design.md`,
`packages/db/migrations/*.sql`, and the mobile/functions source. **These are findings for a human,
not things this draft fixed** — the drafts describe the system truthfully and therefore do not repeat
the marketing framing where it overreaches.

**T1 — The landing page never mentions that approved photos go to third parties. (Highest value.)**
`landing-page.md:69` says *"You can't leak what never leaves the device. That's the whole design, not
a promise buried in a policy,"* and `:63` says *"before a single upload… simply never travel."* Both
are true of the *screened-out* photos. But the photos that **do** pass the gate are uploaded and then
sent onward to **OpenAI (GPT-4o)** and **Photoroom** — two external companies — for processing
(`docs/06` §5, §2 table). A reader of the landing page could reasonably conclude that approved photos
are processed only by us. The privacy policy has to disclose those sub-processors, so the two
documents will read as if they describe different products unless the landing page adds one honest
line. This is the single most consequential inconsistency in the set: the marketing claim is not
false, but it is materially incomplete on exactly the point a privacy-motivated buyer cares about.
**Suggested resolution:** add to the landing page's privacy section a line such as "the clothing
photos you approve are processed by our image-processing partners to cut out and label your garments"
with a link to the policy. That is a `content/` edit and out of scope for this task.

**T2 — "Nothing you didn't hand-pick ever leaves your phone" is stronger than the built system.**
`landing-page.md:61` (and the trust footer at `:119`) states this as an absolute. The structural
guarantee that actually exists is *"no upload without an explicit approval tap"*; what a photo is
*offered as a candidate* rests on an on-device classifier that `docs/06` §8.3 explicitly calls a
graded detection control with **no server backstop by design**, and that
`docs/LAUNCH-READINESS.md` §3 confirms **does not exist yet in any form** (`git grep` for
`classifier|intimate|nsfw` returns nothing). The headline claim is defensible on the approval-tap
reading and indefensible on the "the filter never errs" reading. The privacy policy draft therefore
describes the gate as *intended to reduce, not eliminate* the risk, and names the approval tap as the
control. **A human should confirm the marketing wording is acceptable alongside the policy wording,
and must not ship the claim at all until the classifier exists.**

**T3 — The paywall says "Unlimited garment parsing"; caps exist.**
`packages/mobile/features/monetization/PaywallScreen.tsx:16` lists *"Unlimited garment parsing"* as a
value point. A hard per-account preview cap exists (`teaser-cap.ts:5`, 10 photos), and
`docs/06` §8 / `docs/LAUNCH-READINESS.md` §6.3 call for a per-user rate limit on paid processing as a
cost-abuse defence. "Unlimited" on a paid paywall is both an App Review accuracy issue and a
consumer-law representation. `subscription-terms.md` §1 deliberately does **not** use the word
(TBC-38, TBC-39). **A human must reconcile the paywall copy.**

**T4 — "Digitized in seconds" describes the preview, not the closet.**
`landing-page.md:22` / metaDescription. The scan produces a small preview batch in seconds
(`docs/01` F1 step 4: ~5–10 items); the full wardrobe is built **after payment**
(`docs/01` F3). `content/README.md:30` already logs this as a self-identified overclaim and says it
was fixed in the blog set; the landing headline still reads this way, and the FAQ at `:92` is
accurate. `subscription-terms.md` §1 states the preview-vs-full split explicitly. **Low severity, but
it is the claim that sits closest to the purchase decision.**

**T5 — The paywall says "Cancel anytime" / "Billed through the App Store" and nothing else.**
`PaywallScreen.tsx:60` and `:78`. That is nowhere near the Guideline 3.1.2 required set (no price, no
period, no auto-renewal statement, no cancellation-is-in-platform-settings statement, no terms or
privacy links, no restore control, and the Subscribe button is `onPress={() => {}}`). This is a
submission blocker, not merely a tension — see §2.2 and §2.3.

**T6 — "Only the clothing photos you approve are ever uploaded" vs originals being retained.**
The landing page (`:98`, `:119`) is accurate about *what* is uploaded, and says nothing about *how
long* it is kept. `docs/06` §9 records that original photos are **deliberately not deleted after
processing**. Nothing is contradicted, but a reader of "you can't leak what never leaves the device"
may not expect an indefinitely-retained cloud copy of every approved photo of her. This is why TBC-14
is flagged as a decision with privacy consequences rather than a blank to fill in.

**No contradictions found on:** body scanning (the app genuinely never scans, measures or models the
body — no such code, no such column, try-on is roadmap-only and designed session-ephemeral), and
skin tone (`palette_profile` stores only a self-identified hue set; there is no camera-derived tone
anywhere). The landing page's two strongest privacy differentiators are true.

---

## 4. Publishing is a human step

These files are markdown drafts inside the repository. To make them do their job, a human must:

1. Have counsel review all three and resolve the 46 markers in §1.
2. Resolve the product name and the canonical domain.
3. **Host the reviewed privacy policy and terms at stable public URLs** and enter the privacy-policy
   URL in App Store Connect / Google Play Console.
4. Build the paywall disclosure block, the Restore Purchases control, and the in-app export +
   delete paths (§2.2–2.4).
5. Reconcile the marketing tensions in §3 — particularly **T1** (sub-processor disclosure on the
   landing page) and **T3/T5** (paywall accuracy).

No agent should publish, host, or submit any of this. Nothing in this directory has been reviewed by
a lawyer.

---

**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**
