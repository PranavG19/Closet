# LLM / vision-model efficiency audit

Read-only audit of every AI/LLM/vision call site under `packages/`, an efficiency
verdict for each, and 2–4 small locally-runnable guard tests. Date: 2026-08-11.
Method: `git grep` for `openai|vision|anthropic|gpt|completion|prompt|model|parse|
CutoutPort|VisionPort`, then read every implementation (never inferred from a name).

## Scope: what is and is not an LLM in this repo

The repo's self-description is correct: **the OpenAI GPT-4o vision call is the ONLY
LLM in the codebase.** Everything else that touches "parse", "vision", "suggestion",
or "colour" is a pure deterministic heuristic or a non-LLM image API:

- `packages/functions/src/adapters/photoroom-cutout.adapter.ts` — Photoroom
  background-removal (a segmentation image API, not an LLM). One call site.
- `packages/shared/src/suggestion.ts` + `wardrobeSuggestion.ts` — F5 outfit
  suggestion is a **pure function** (warmth ordinal + weather band + palette
  tie-break; no I/O, no `Date`, no `Math.random`). Runs on-device.
- `packages/shared/src/dedupe.ts` — phash Hamming-distance dedupe (pure).
- `packages/shared/src/colorFamily.ts`, `harmony.ts`, `palette.ts` — pure colour maths.
- `packages/mobile/.../photoIntakeNative.ts` — the on-device privacy screener is
  **not built** (no classifier bound; every verdict is `undetermined`, human-gated).
  Not an LLM and out of scope; do not describe it as classifying.
- `classifyParseFailure` (mobile) — a `switch` over server error codes, not ML.

So there is exactly **one LLM call site** and **one adjacent paid vision API** to audit.

---

## Call site 1 — OpenAI GPT-4o vision (the only LLM)

`packages/functions/src/adapters/openai-vision.adapter.ts` →
`POST https://api.openai.com/v1/chat/completions`. Wired in production via
`makeProviderPorts` (`adapters/index.ts`) and driven by `parse-photo.ts` step 5,
after the entitlement gate + spend limiter + atomic claim.

**Task:** extract 7 fixed garment attributes (category, primaryColor,
secondaryColors[], material, pattern, formality, season) from ONE approved image,
returned as JSON validated against `AIVisionResultSchema` at the boundary.

### Payload leanness — VERDICT: GOOD (already tightly guarded)
- Exactly 2 messages: one system instruction + one user turn. No history.
- Exactly one `image_url` part. No duplicate image.
- `response_format: { type: 'json_object' }` — JSON mode on, no wasted prose tokens.
- `max_tokens: 400` (default) vs a ~80-token response — generous headroom, caps a
  runaway. Overridable via `maxTokens` / (no env today; injected only).
- Image `detail` is **omitted by default** (model `auto`), an opt-in `low`/`high`
  via `OPENAI_VISION_IMAGE_DETAIL`. `low` is the single biggest per-call cost lever
  (~85 tokens vs hundreds), correctly gated behind a labeled-corpus decision (docs/05
  Tier-1) rather than silently flipped — flipping it blind would risk `material`/fine
  `pattern` accuracy, the product's make-or-break metric.
- The existing `.test.ts` already asserts all of the above (message count, single
  image, JSON mode, bounded prompt <3000 chars, max_tokens, detail opt-in).

Nothing to cut. The one residual lever (`detail: low`) is a deliberate corpus-gated
decision, not an oversight.

### Model choice — VERDICT: DEFENSIBLE, with a cheaper lever left un-pulled
- `gpt-4o` (default, overridable via `OPENAI_VISION_MODEL`). For a 7-field
  fixed-vocabulary extraction from a clean single-garment photo, **`gpt-4o-mini`**
  is very likely sufficient and materially cheaper. This is the same class of
  corpus-gated call as `detail: low`: the model id is already an env knob, so the
  cheaper model can be A/B'd against the bench-scan corpus without a code change.
  Recommend the corpus decision explicitly evaluate `gpt-4o-mini` before GA.
- A non-LLM heuristic cannot replace this call: category/material/pattern from pixels
  is exactly what a VLM is for. Colour (`primaryColor`) *could* in principle come
  from a cheap dominant-colour extraction on the cutout, but that would be a new
  on-device/edge code path; not worth it pre-corpus.

### Determinism / caching — VERDICT: STRONG at the job layer, ABSENT at the call layer
- The parse pipeline is **content-addressed and idempotent**: the source key is
  `{user_id}/{source_photo_hash}/original` (`supabase-storage.reader.ts`), and
  `parse-photo.ts` step 3 short-circuits an already-`done` job with NO re-call of the
  vision model. So a resubmit of the same photo by the same user never re-bills GPT-4o
  — proven by `parse-metamorphic.integration.test.ts` (`visionCalls()` stays 1).
- Gap: caching is **per (user, hash)**. Two users who upload the same garment photo
  each pay a full GPT-4o call. Cross-user content-addressed caching is deliberately
  NOT done and should NOT be added — it would require reading across tenant prefixes
  (breaks RLS / the privacy invariant). The per-user idempotency is the correct ceiling.
- No `temperature`/`seed` is set (defaults). Determinism is enforced downstream by
  the schema + JSON mode, not by sampling params — acceptable, since the boundary
  rejects drift rather than trusting it.

### Prompt quality — VERDICT: GOOD
- The system prompt enumerates the EXACT enum vocabulary field-by-field and demands
  lowercase `#rrggbb` hex ("NEVER a color name"). Off-vocabulary output is rejected at
  `parseBoundary`, never coerced — a wrong-but-plausible value is treated as worse than
  a clean 502. The only sanctioned mutation is lowercasing a hex. This is a well-formed,
  parseable-output prompt aligned to the schema.

---

## Call site 2 — Photoroom cutout (not an LLM, audited for completeness)

`packages/functions/src/adapters/photoroom-cutout.adapter.ts` →
`POST https://sdk.photoroom.com/v1/segment`. Sends `image_url` + `format=png`
form-encoded; returns cutout bytes handed to an injected Supabase storage writer.

- Payload leanness: minimal (URL + format). Fine.
- Determinism/caching: same per-(user,hash) idempotency as vision — a `done` job never
  re-calls Photoroom. Fine.
- It shares the `http.ts` transport (15s timeout, bounded 429/5xx retry). Fine.
- Not an LLM; no prompt/model concerns. Included only so the audit is exhaustive.

---

## Shared cost/latency infrastructure (both providers)

- `http.ts`: one AbortController timeout (`PROVIDER_TIMEOUT_MS`, default 15s) + bounded
  jittered retry on 429/5xx only (`PROVIDER_MAX_RETRIES`, default 2). Thrown/abort
  errors do NOT retry (fail fast, no budget multiplication). Sound.
- `parse/rate-limit.ts`: per-user DB-backed spend throttle (default 20 / hour) sits
  BEFORE any provider call, fails closed, and has no "unlimited" env value. This is the
  real cost blast-radius control — a stolen token or retry loop cannot run up the LLM
  bill unbounded. Sound.
- `parse-photo.ts` logs `providerMs` separately from `totalMs` so the LLM+cutout
  network cost is observable in production without a real key. Good.

---

## Proposed guard tests (small, local, no external keys)

All reuse the existing injected-`fetch` harness in
`openai-vision.adapter.test.ts` (recorded payloads, no network). These target the
gaps the current guards miss: model-choice cost regression, and behaviour under a
future `detail`/`maxTokens` env flip.

### Test A — model-id cost guard (catches a silent upgrade to a pricier model)
**File:** `packages/functions/src/adapters/openai-vision.adapter.test.ts`
Assert the request body's `model` equals the configured default (`gpt-4o`) with no
deps, and that `OPENAI_VISION_MODEL` / `{ model }` override is honoured. Rationale: a
regression that hardcoded a larger model, or dropped the env knob, would silently
multiply every parse's cost with nothing going red today. This is the one input-cost
axis (model tier) the existing leanness guards do not cover.

### Test B — env-driven cost levers actually reach the wire
**File:** `packages/functions/src/adapters/openai-vision.adapter.test.ts`
Drive `makeOpenAIVisionAdapter` with `OPENAI_VISION_IMAGE_DETAIL=low` and
`OPENAI_VISION_MODEL=gpt-4o-mini` set via env (not deps), capture the body, and assert
both land in the request. Rationale: the corpus decision will flip these via env; this
proves the env path (not just the injected-dep path already tested) works, so the cost
lever isn't dead on the deployed Deno config.

### Test C — response contract / effectiveness floor on a recorded corpus
**File:** `packages/functions/src/adapters/openai-vision.effectiveness.test.ts` (new)
Feed a small table (~6) of recorded GPT-4o envelopes representing plausible real
outputs — a clean top, a floral dress, an uppercase-hex response, a colour-name
response, a missing-field response, a non-JSON refusal — through the real adapter and
assert: valid ones parse to the exact expected `AIVisionResult`; the uppercase hex is
lowercased; and every malformed one throws `BoundaryParseError` (never a coerced
garment). Rationale: locks the prompt→schema contract so a prompt edit that changed the
requested shape, or a loosened schema, is caught as an effectiveness regression without
a live key. (Extends, does not duplicate, the existing parse-don't-cast cases.)

### Test D — idempotency = no re-billing (cost guard at the orchestration layer)
**File:** `packages/functions/test/parse-photo.integration.test.ts` (existing) or the
metamorphic file. A focused assertion (largely already present) that a second submit of
the same `source_photo_hash` leaves `visionCalls()` at 1. Rationale: the strongest cost
control is "never call the LLM twice for the same photo"; a regression that broke the
`done` short-circuit would double every user's LLM spend silently. Keep this as an
explicit named cost guard, not an incidental side-assertion.

## Bottom line

The one LLM call site is already lean, schema-pinned, idempotent, throttled, and
well-guarded on payload shape. The two un-pulled efficiency levers — `gpt-4o-mini` and
`detail: low` — are correctly gated behind a labeled-corpus decision, not neglected.
The proposed tests add the missing cost axes (model tier, env-lever plumbing, and a
recorded-corpus effectiveness floor) as cheap red-first guards.
