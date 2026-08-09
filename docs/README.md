# Closet App — Design & Spec

Working name: **TBD** (women's premium wardrobe app).

This folder is the north-star spec, split for agentic implementation. Read in order.

| Doc | What it is |
|---|---|
| [`00-north-star-vision.md`](./00-north-star-vision.md) | The full product vision — every feature incl. deferred. The "why" and the destination. |
| [`01-product-requirements.md`](./01-product-requirements.md) | PRD. MVP scope, user flows, feature specs, acceptance criteria. What we build now. |
| [`02-engineering-requirements.md`](./02-engineering-requirements.md) | Stack, architecture, Supabase schema, provider abstractions, data flow, non-functionals. |
| [`03-design-system.md`](./03-design-system.md) | Look & feel: color, type, spacing, components, motion, tone of voice. **Intent, not current state** — several of its accessibility commitments are not met by the shipped tokens; see `07-ui-state.md`. |
| [`04-development-phases.md`](./04-development-phases.md) | The autonomy model: 5 phases, human-gate = escalation-trigger mapping, enforcement hooks/gates. |
| [`05-testing-gauntlet.md`](./05-testing-gauntlet.md) | Backend test taxonomy organized by **oracle independence** (kill the mirror oracle). Tiers 0–4 + the standing gauntlet. |
| [`06-backend-design.md`](./06-backend-design.md) | The backend: on-device/remote split, **9 tables** + RLS, **12 Edge Functions**, ports, storage security, escalation triggers. Authoritative on columns (per `decisions/D-001`). |
| [`07-ui-state.md`](./07-ui-state.md) | **What the app actually looks like** — the 17 committed simulator screenshots, the 6 confirmed visual defects, and how to reproduce a capture. The UI oracle, per Rule 3. |
| [`roadmap.md`](./roadmap.md) | **DO NOT IMPLEMENT** — the prioritised future map (retention layer, deferred features, social poll, events) + which requests belong to the sibling **fitapp** project. Context only. |
| [`../tasks/`](../tasks/) | Day-sized `.code-task.md` files for coding agents. |

### Where the current build state lives (docs above are the *spec*, not the *status*)

| Doc | What it is |
|---|---|
| [`LAUNCH-READINESS.md`](./LAUNCH-READINESS.md) | **Start here for "what is actually built."** Adversarial audit, every count carrying the command that re-derives it, graded VERIFIED / ASSERTED-NOT-EXERCISED / ABSENT. |
| [`RUN-LOG.md`](./RUN-LOG.md) | The durable per-wave record. Numbers in old entries are historical snapshots, not current facts. |
| [`DEPLOY-RUNBOOK.md`](./DEPLOY-RUNBOOK.md) | Step-by-step deploy + the **canonical route→env mapping** (cite it, don't restate it) + rollback. |
| [`ORCHESTRATION.md`](./ORCHESTRATION.md) | The work frontier, collision rules, and the durable workflow/verification lessons. |
| [`PATTERNS.md`](./PATTERNS.md) · [`decisions/`](./decisions/) | Exemplar code · decision records (`D-001`, `D-002` — note the prefix is `D-`, not `ADR-`). |
| [`legal/`](./legal/) | Privacy policy · ToS · subscription terms. **All DRAFTS pending counsel.** |

**The cardinal rule:** never trust a `[x]` or a number in any of these — re-derive it from the tree. Docs here have drifted repeatedly, and a confidently wrong doc is worse than a missing one.

## The one-line thesis
A woman points the app at her camera roll, sees her real closet digitized in ~30 seconds, and pays — because the use case is obvious and the aha is immediate. We are the **premium** option; free competitors exist.

## Decisions locked (2026-08-06)
- **Platform:** React Native / Expo (iOS + Android from one codebase).
- **Parse pipeline:** Hybrid — on-device gate (filter intimate/non-you photos) → cloud parse for user-approved photos only.
- **Onboarding/paywall:** Scan → processing animation → parse a *handful* of items for a teaser preview → **hard paywall** (no free trial) → full camera-roll parse runs *after* payment during onboarding. Premium-only.
- **Backend:** Supabase (Postgres + auth + storage + edge functions) + RevenueCat (subscriptions).
- **Vision model:** GPT‑4o as default, behind a swappable provider interface. Cutout/background-removal is a separate provider.
- **Skin-tone palette:** self-identified swatch quiz, NOT camera detection (beta). Garment-to-garment color harmony ships as rules.

## Deferred (in the vision, not the MVP)
Virtual try-on · gap-fill shopping/affiliate · social/closet-circle · borrow/joint closets · resale · fit ledger · travel packing. See [`00-north-star-vision.md`](./00-north-star-vision.md) for the full future map.
