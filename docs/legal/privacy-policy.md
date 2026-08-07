**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**

# [App Name] — Privacy Policy

**Status:** unpublished draft. **Effective date:** [TO BE CONFIRMED: TBC-01 — effective date; do not publish with a placeholder date]
**Last updated:** [TO BE CONFIRMED: TBC-02 — last-updated date]

> This draft describes the system as actually built and designed (see `docs/06-backend-design.md`,
> `packages/db/migrations/`). Nothing below is asserted as a settled legal conclusion. Every
> `[TO BE CONFIRMED: …]` marker is a fact or a judgement a human must supply. The consolidated
> checklist of every marker across all three documents is in `docs/legal/README.md`.

---

## 1. Who we are

[App Name] is operated by [TO BE CONFIRMED: TBC-03 — controller legal entity name, company number, and registered address]
("we", "us"). For users in the UK/EEA, that entity is intended to be the **data controller** for the
processing described here — [TO BE CONFIRMED: TBC-04 — confirm controller/processor characterisation
with counsel, including whether an EU/UK representative under GDPR Art. 27 is required].

- **Privacy contact:** [TO BE CONFIRMED: TBC-05 — privacy contact email address]
- **Data Protection Officer:** [TO BE CONFIRMED: TBC-06 — whether a DPO is required and, if so, DPO name and contact]
- **Supervisory authority / lead regulator:** [TO BE CONFIRMED: TBC-07 — jurisdiction of establishment and lead supervisory authority]

## 2. Scope and the one thing to understand first

[App Name] turns photos you already have into a digital wardrobe, then answers "what do I wear
today" from what is actually clean.

The single most important design fact:

> **Photos are screened on your device before anything is uploaded, and only photos you approve
> are ever sent to us.**

Concretely, when you scan your camera roll:

1. The screening step runs **entirely on your phone**. It is intended to set aside intimate images,
   screenshots, photos with no person in them, and — on a best-effort basis — photos that are not of
   you. Nothing is uploaded during this step.
2. You then **approve** the photos that become your closet. An approval tap is the only thing that
   makes a photo eligible for upload.
3. Only approved photos leave the device.

We describe this as a structural design choice rather than a promise of perfection. The on-device
screening step is an automated classifier: it is intended to reduce, not to eliminate, the chance
that a photo you would not want uploaded is offered to you as a candidate. **The approval step is
yours, and it is the control that decides what we receive.** You can also skip the camera-roll scan
entirely and hand-pick individual photos to import.

We do **not** run a server-side filter on your photos, because a server-side filter would already
have received the photo.

## 3. What we collect, why, and for how long

### 3.1 Data you give us or that is created by using the app

**Account and identity.** You sign in with Apple or Google. Our authentication provider (Supabase
Auth) receives and stores an account identifier from that provider, an email address (which, for
Sign in with Apple, may be an Apple private-relay address if you chose to hide your email), and
sign-in timestamps. We do not ask for your name, address, phone number, date of birth, body
measurements, or any government identifier.

**Photos you approve.** The original approved photo files are uploaded to private cloud storage
under a folder keyed to your account. These are typically photos of **you wearing your clothes**, so
they are photos of an identifiable person and we treat them as **sensitive** in handling terms.
Whether they constitute "special category data" under GDPR Art. 9 is
[TO BE CONFIRMED: TBC-08 — counsel to determine whether garment photos of the user are special
category data (e.g. because they may reveal ethnicity or religious dress) and whether an Art. 9
condition is therefore required].

**Garment data derived from those photos.** Category, colour, pattern, further attributes, a
background-removed cutout image, and a perceptual hash used to spot near-duplicates on your device.

**Your wardrobe activity.** Outfits you build and name, which garments are in them, whether an item
is clean / in the wash / unavailable, and a **wear log**: a timestamped record of what you wore and
when.

**Your self-identified colour palette (optional, beta).** A short swatch quiz. **We store only the
resulting set of hues.** Skin tone and colour are **never detected from a photo** — you tell us, or
you skip the quiz entirely and everything still works.

**Subscription status.** Whether your subscription entitlement is active, when it expires, and an
identifier linking your account to our subscription-management provider. We never see or store your
card details — payment is handled by Apple or Google.

**Technical and diagnostic data.** Server-side we write structured operational logs keyed to a
per-request correlation identifier. Our logging is designed to exclude raw error text and request
bodies specifically so that personal data does not end up in logs. Our hosting provider also
produces platform-level logs (including IP addresses) as part of running the service —
[TO BE CONFIRMED: TBC-09 — hosting provider platform-log contents and retention period].

**Approximate location (weather only).** Outfit suggestions are weather-aware. Where this feature is
enabled, your device requests local weather directly from a weather provider using coordinates; the
coordinates are not sent to us and no location is stored on our servers.
[TO BE CONFIRMED: TBC-10 — confirm before publication: the weather lookup is designed but not yet
implemented in the app; confirm whether precise or coarse location is used, the exact provider, and
whether that provider logs IP addresses]

**We do not** use third-party advertising SDKs, ad identifiers, cross-app tracking, or analytics
products; none are present in the app.
[TO BE CONFIRMED: TBC-11 — confirm no analytics/crash-reporting/attribution SDK is added before
submission, and align this section with the App Store Privacy "Nutrition Label" and App Tracking
Transparency answers]

### 3.2 What we do **not** do

- We do **not** scan, measure, or model your body. Virtual try-on is **not** part of this app.
  If it is ever built, it is designed so that body geometry is session-ephemeral: no body model
  stored on our servers, no biometric identification, no face templates.
- We do **not** derive skin tone, ethnicity, age, or any other characteristic from your photos.
  Colour guidance is only ever what you selected yourself.
- We do **not** use facial recognition and do not build face templates.
- We do **not** sell your personal data, and we do not "share" it for cross-context behavioural
  advertising as those terms are used in US state privacy laws.
  [TO BE CONFIRMED: TBC-12 — counsel to confirm the "sell/share" characterisation and whether a
  "Do Not Sell or Share My Personal Information" link, a Notice at Collection, or a CPRA-style
  disclosure is required]

### 3.3 Data inventory (record of what is stored where)

This table is the inventory of stored personal data, derived from the applied database schema and
storage buckets. Retention values marked TBC are **policy decisions that have not been made**;
counsel and the operator must set them before publication.

| Store | Fields | Purpose | Retention |
|---|---|---|---|
| Authentication account (Supabase Auth) | provider account id, email (or Apple private-relay address), sign-in timestamps | Sign you in; bind all your data to you so nobody else can read it | Until you delete your account. [TO BE CONFIRMED: TBC-13 — backup/backend retention window after deletion] |
| `originals` storage bucket (private) | The approved photo files you uploaded, stored under `{your account id}/…` | Source for garment extraction; allows re-processing if we improve quality | **Currently retained after processing — not deleted.** [TO BE CONFIRMED: TBC-14 — retention period for original photos; see §3.4] |
| `cutouts` storage bucket (private) | Background-removed garment images under `{your account id}/…` | The garment images your wardrobe displays | Until you delete the item or your account. [TO BE CONFIRMED: TBC-14] |
| `wardrobe_items` | category, colour, pattern, further attributes (e.g. secondary colours, material, formality), availability state, cutout path, link to the parse job, perceptual hash, timestamps | Your digitised closet; filtering; suggestions; on-device duplicate detection | Until you delete the item or your account |
| `parse_jobs` | a hash of the source photo, the storage path of the source photo, job kind (preview / full), status, claim timestamp, a fixed error code (no free text), timestamps | Makes processing resumable and prevents the same photo being processed twice | Until you delete your account. [TO BE CONFIRMED: TBC-15 — whether completed job rows are pruned earlier] |
| `outfits` | outfit name (free text you type), timestamps | Saved outfits | Until you delete the outfit or your account |
| `outfit_items` | which garment sits in which outfit, slot, position | Outfit composition | With the outfit |
| `wear_log` | garment id, optional outfit id, `worn_at` timestamp, a client-generated de-duplication id | The "I wore this" record; keeps suggestions and the laundry view honest | Until you delete your account. This store is **append-only** by design — see §6. [TO BE CONFIRMED: TBC-16 — retention period for wear history] |
| `palette_profile` | the resulting set of flattering hues from the swatch quiz | Gently highlights palette-aligned items. Advisory only | Until you delete your account or clear the palette |
| `subscriptions` | provider app-user id, whether the entitlement is active, last event timestamp, expiry timestamp | Unlocks paid features; nothing else | [TO BE CONFIRMED: TBC-17 — retention after cancellation/deletion; note tax/accounting retention duties may apply] |
| `webhook_events` | subscription-event id, received timestamp | System record that stops a duplicate subscription event being applied twice | [TO BE CONFIRMED: TBC-18 — retention for the event-dedup ledger] |
| Operational logs | request correlation id, event name, fixed status fields (designed to exclude raw error text and request bodies) | Diagnose faults, prevent abuse | [TO BE CONFIRMED: TBC-09] |

### 3.4 A retention decision we are flagging openly

Original approved photos are **currently retained after processing**, in your own private storage
folder. The engineering reason is that deletion is irreversible and forecloses re-processing your
closet at higher quality later. The privacy consequence is that a set of photographs of you is held
for longer than the minimum needed to produce your wardrobe, which is in tension with data
minimisation and storage limitation (GDPR Art. 5(1)(c) and 5(1)(e)).

[TO BE CONFIRMED: TBC-14 — retention period for original photos. Counsel and the operator must
choose one of: (a) delete originals a fixed period after successful processing; (b) retain with a
stated period and a user-facing "delete my original photos" control; (c) retain for the life of the
account with an explicit disclosure and justification. This document must state the decision, not
this note.]

## 4. Our legal bases (UK/EEA and comparable regimes)

[TO BE CONFIRMED: TBC-19 — the legal-basis mapping below is a starting proposal for counsel, not a
settled position. In particular, the choice between **contract** (Art. 6(1)(b)) and **consent**
(Art. 6(1)(a)) for photo processing is a live decision with real consequences: consent must be
freely given and withdrawable, which is awkward when photo processing *is* the paid service; contract
is cleaner operationally but is contestable where the data is sensitive and where a special-category
condition under Art. 9 may separately be required. Counsel must decide, and if consent is chosen the
app needs a consent-capture and consent-withdrawal mechanism that does not exist yet.]

| Processing | Proposed basis |
|---|---|
| Creating and running your account; storing your wardrobe, outfits, availability and wear log; delivering suggestions | **Contract** — Art. 6(1)(b): this is the service you signed up for |
| Uploading and processing the photos you approve (including sending them to our processing providers) | **Contract** and/or **Consent** — see TBC-19. Note the app's own design already requires an explicit per-photo approval tap, which counsel may treat as the consent artefact |
| Any special-category element of your photos | [TO BE CONFIRMED: TBC-08] — likely explicit consent under Art. 9(2)(a) if Art. 9 applies |
| The optional self-identified colour palette | **Consent** — you volunteer it, you can skip it, and you can clear it |
| Subscription and entitlement management | **Contract**, plus **legal obligation** for tax/accounting records where applicable |
| Security, abuse and cost-abuse prevention, fault diagnosis | **Legitimate interests** — Art. 6(1)(f), balancing recorded at [TO BE CONFIRMED: TBC-20 — location of the legitimate-interests assessment] |

If consent is the basis for any processing, you can withdraw it at any time (see §7); withdrawal does
not affect processing already carried out.

## 5. Who else processes your data (sub-processors)

We use a small number of providers. **Two of them receive your photos.** We name every one:

| Provider | What it does | What it receives |
|---|---|---|
| **Supabase** | Hosting: the database, private photo storage, authentication, and our server functions | All stored data described in §3.3, including your photo files |
| **OpenAI** (GPT-4o) | Extracts garment attributes — category, colour, pattern — from an approved photo | The approved photo, sent from our server function only |
| **Photoroom** | Removes the background to produce the clean garment cutout | The approved photo, sent from our server function only |
| **RevenueCat** | Manages subscription state and tells our server when your entitlement starts or ends | Subscription events and an app-user identifier. No photos, no wardrobe data |
| **Apple** / **Google** | Process your payment as the seller of record for in-app purchases | Your payment details, which we never see. Apple and Google handle that data under their own privacy policies |
| **Weather provider** | Supplies local weather for suggestions | Coordinates, sent directly from your device, not via us. [TO BE CONFIRMED: TBC-10] |

To be explicit about the boundary: **the on-device screening step means the cloud only ever receives
photos you approved — but an approved photo does travel to OpenAI and Photoroom for processing.** It
is not processed only by us.

[TO BE CONFIRMED: TBC-21 — for each provider above: is a signed Data Processing Agreement / GDPR
Art. 28 processor terms in place? Record status per provider before publication.]

[TO BE CONFIRMED: TBC-22 — for OpenAI and Photoroom specifically: confirm the contractual position
on (a) whether submitted images are used to train models, (b) the provider's own retention period for
submitted images, and (c) whether zero-retention / no-training terms are available and enabled. This
is the highest-sensitivity sub-processor question in this document, because it concerns photographs
of the user.]

We may also disclose data where we are legally required to, or to establish or defend legal claims.

## 6. International transfers

We are established in [TO BE CONFIRMED: TBC-07]. Our providers listed in §5 may process data outside
your country, including in the United States.

[TO BE CONFIRMED: TBC-23 — per-provider transfer mechanism: Standard Contractual Clauses / UK
International Data Transfer Addendum / adequacy decision / EU-US Data Privacy Framework
certification, plus whether a Transfer Impact Assessment has been completed. Also confirm the region
in which the hosting project is provisioned, since that determines where the photo storage physically
sits.]

You may request a copy of the relevant transfer safeguards from the contact in §1.

## 7. Your rights, and exactly how to use them

Depending on where you live, you have some or all of the following rights. We honour them for all
users regardless of location as a matter of policy.

| Right | What it means | How to use it |
|---|---|---|
| **Access / export** | Get a copy of the data we hold about you, in a portable machine-readable format | In-app data export. [TO BE CONFIRMED: TBC-24 — exact in-app path and the export file format, since the screen is not built yet]. Or email the contact in §1 |
| **Erasure** | Delete your account and the data associated with it, including your photos, garments, outfits and wear log | In-app account deletion. [TO BE CONFIRMED: TBC-24 — exact in-app path]. Or email the contact in §1. Note: deleting the app does **not** delete your account |
| **Rectification** | Correct data that is wrong. Garment attributes are produced automatically and can be wrong | Edit the item in the app; for anything you cannot edit, email the contact in §1 |
| **Portability** | Receive your data in a structured, commonly used, machine-readable format, or have it sent onward where technically feasible | Same as export, above |
| **Restriction / objection** | Ask us to pause processing, or object to processing based on legitimate interests | Email the contact in §1 |
| **Withdraw consent** | Where we rely on consent, withdraw it. For the colour palette, clear or skip it; for photos, stop approving photos and delete the ones already uploaded | In-app, or email the contact in §1. See TBC-19 |
| **Complain** | Complain to your data protection authority | Your local authority; ours is at [TO BE CONFIRMED: TBC-07] |

We aim to respond within one month, and will tell you if we need longer.
[TO BE CONFIRMED: TBC-25 — the operational response process, identity-verification step, and who is
accountable for meeting statutory deadlines.]

**What account deletion does.** Deleting your account removes your stored wardrobe, outfits,
availability states, wear log, palette, uploaded original photos and cutouts, and your subscription
record on our side.
[TO BE CONFIRMED: TBC-13 — how long deleted data persists in encrypted backups before it ages out,
and confirmation from the hosting provider of that window.]
**Deleting your account does not cancel your subscription** — subscriptions are billed by Apple or
Google and must be cancelled in your platform account settings. See `subscription-terms.md`.

## 8. How we protect your data

- **Per-user isolation enforced by the database itself.** Every table holding your data has
  row-level security in force, default-deny, keyed to the account identity in your verified sign-in
  token. There is no query path that returns another user's row, because the database refuses it —
  not because application code remembers to filter.
- **Private photo storage.** Both photo buckets are private and are not publicly readable. Access is
  bound to a folder named after your own account identifier.
- **Verified sign-in tokens.** Requests are authenticated by cryptographically verifying your
  sign-in token against the provider's public keys. Your identity is taken from the verified token,
  never from anything a client claims in a request.
- **Least privilege on the server.** Our user-facing server functions run as a restricted database
  role subject to the same row-level security as everyone else. The only component that can write
  your subscription status is the subscription webhook — the app itself has no write path to it, so
  a client cannot grant itself a paid entitlement.
- **Your wear history is append-only** at the database level: it cannot be silently rewritten.
- **Your sign-in token is stored in your device's secure keystore**, not in plain application
  storage.
- **Logging is designed to exclude personal data** — no raw error text, no request bodies.

No system is perfectly secure, and we do not claim otherwise.
[TO BE CONFIRMED: TBC-26 — breach-notification process and 72-hour GDPR Art. 33 reporting owner.]

## 9. Children

[App Name] is not directed to children.
[TO BE CONFIRMED: TBC-27 — the minimum age for using [App Name], whether an age gate is implemented
at sign-up, and the App Store / Google Play age rating. This needs a real decision rather than
boilerplate: the app ingests photographs of the user, so the exposure if a minor uses it is high.
Counsel should consider COPPA (US, under 13), the UK Age Appropriate Design Code, and GDPR Art. 8
digital-consent ages, which vary by member state between 13 and 16.]

If you believe a child has provided us with personal data, contact us at the address in §1 and we
will delete it.

## 10. Automated processing

Garment attributes are produced automatically by an AI model, and outfit suggestions are produced by
deterministic rules. These are **advisory** — they suggest, they never decide anything about you and
never restrict you. We do not carry out profiling that produces legal effects or otherwise
significantly affects you, so GDPR Art. 22 is not engaged in our view.
[TO BE CONFIRMED: TBC-28 — counsel to confirm the Art. 22 position.]

## 11. Changes to this policy

If we change this policy we will update the "last updated" date above and, where the change is
material, notify you in the app or by email before it takes effect. Continuing to use [App Name]
after a change takes effect means the updated policy applies to you.
[TO BE CONFIRMED: TBC-29 — the notice mechanism and notice period for material changes, and whether
a version archive of prior policies will be published.]

## 12. Contact

[TO BE CONFIRMED: TBC-03] · [TO BE CONFIRMED: TBC-05] · [TO BE CONFIRMED: TBC-06]

---

**DRAFT — NOT LEGAL ADVICE. Requires review by qualified counsel before publication.**
