# Task: AIVisionPort, CutoutPort, WeatherPort interfaces + Zod result contracts

## 1. Intent

Three vendor integrations — GPT-4o garment-attribute extraction, Photoroom background cutout, and keyless Open-Meteo weather — must sit behind narrow port interfaces whose result shapes are Zod schemas, so any vendor is swappable for an A/B alternative without editing a single caller and no vendor-specific request/response type ever crosses the boundary. The property: a caller depends only on the port interface and the parsed result contract; the concrete adapter (real vendor or fake) is interchangeable and invisible upstream.

## 2. Context and constraints

**Spec reference:** docs/06 §5 "Ports" — the port surface (interface names, method signatures, result field sets) is defined there and MUST match exactly. This task is the type-level contract only; concrete vendor adapters are separate wave-3 tasks.

**Codebase patterns:** See docs/PATTERNS.md. The relevant blocks:
- *Parse-don't-cast at boundaries* — `parseBoundary(Schema, x)` is the only way data enters a trusted shape; every port method returns a value that has passed a Zod `.parse()`, never a raw vendor object cast to a type. (Backup reference: `../fitapp/packages/shared/src/schema/*`.)
- *Repo/port-as-seam* — like `QueryExecutor`, a port is a hand-written interface the caller receives by injection; the port NEVER imports a vendor SDK type into its published surface. Vendor SDK types are confined to the (future) adapter implementation file, never re-exported.

These ports live in `packages/shared` because both `packages/functions` (handlers) and `packages/db` (none expected) may consume the contracts; shared holds cross-cutting types and Zod schemas.

**Explicit code-style rules (CLAUDE.md):**
- `const` over `let`/`var`; immutable by default.
- Early returns over nested conditionals.
- Parse, don't cast — no `as` on external data; Zod `.parse` / `.safeParse` only.
- No `supabase.from()` outside `packages/db` (N/A here but do not introduce DB access).
- Config via `envValue(...)` helper, never `process.env` directly (N/A for interfaces — do NOT read env in this task; adapters do that later).
- `git grep` for discovery, structured logger over `console` (no logging added in interface files).
- Small single-purpose declarations; names that say what they hold.

**What NOT to touch:** no vendor SDK dependencies added to `package.json`; no adapter implementations; no handler/caller files; no `packages/db`, no migrations, no Deno shims. Only the four files listed below.

**Reversibility class:** reversible (new files only; no schema, no data, no external calls).

**Files this task writes (one-writer-per-file — touch ONLY these):**
- `packages/shared/src/ports/AIVisionPort.ts`
- `packages/shared/src/ports/CutoutPort.ts`
- `packages/shared/src/ports/WeatherPort.ts`
- `packages/shared/src/ports/AIVisionPort.test.ts`
- `packages/shared/src/ports/CutoutPort.test.ts`
- `packages/shared/src/ports/WeatherPort.test.ts`

## 3. Technical requirements (numbered, dependency-ordered)

1. **AIVisionPort result contract.** In `AIVisionPort.ts`, define and export a Zod schema `AIVisionResultSchema` describing the extracted garment attributes per docs/06 §5 (at minimum: category, primary color, secondary color(s), material/fabric, pattern, formality/occasion, season — use the exact field names and enums docs/06 §5 lists). Derive and export the type: `export type AIVisionResult = z.infer<typeof AIVisionResultSchema>`. Colors that feed the palette pipeline MUST be represented as documented (e.g. hex or named tokens per §5), so no numeric cast leaks.
2. **AIVisionPort interface.** Export `interface AIVisionPort { extractAttributes(input: AIVisionInput): Promise<AIVisionResult> }` where `AIVisionInput` is a minimal port-owned input type (e.g. `{ imageUrl: string }` or `{ imageBytes: Uint8Array; mimeType: string }` exactly as §5 specifies). No GPT-4o / OpenAI request or response type appears anywhere in this file.
3. **CutoutPort result contract.** In `CutoutPort.ts`, export `CutoutResultSchema` (per §5: the cutout output — e.g. `{ imageUrl: string }` or `{ imageBytes: Uint8Array; mimeType: string }`, plus any documented `hasAlpha`/dimensions fields) and `export type CutoutResult = z.infer<...>`.
4. **CutoutPort interface.** Export `interface CutoutPort { removeBackground(input: CutoutInput): Promise<CutoutResult> }` with a port-owned `CutoutInput`. No Photoroom type leaks.
5. **WeatherPort result contract.** In `WeatherPort.ts`, export `WeatherResultSchema` (per §5: e.g. `{ tempC: number; condition: <enum>; ... }` matching the exact §5 fields — Open-Meteo is keyless, but the port surface is still keyless-agnostic; no API-key field in `WeatherInput`) and `export type WeatherResult = z.infer<...>`.
6. **WeatherPort interface.** Export `interface WeatherPort { getCurrent(input: WeatherInput): Promise<WeatherResult> }` with port-owned `WeatherInput` (e.g. `{ lat: number; lon: number }`). No Open-Meteo response type leaks.
7. **Barrel-free / no side effects.** These files contain only types, interfaces, and Zod schema `const`s. No top-level execution, no env reads, no I/O.
8. Each `*.test.ts` file (see §5) is co-located and imports only from its sibling port file.

## 4. Acceptance criteria (Given-When-Then)

- **Happy — AIVision:** Given a fake adapter `const fakeVision: AIVisionPort = { extractAttributes: async () => AIVisionResultSchema.parse(validFixture) }`, When it is assigned to a variable typed `AIVisionPort`, Then the project typechecks (`tsc --noEmit`) with zero errors and the fixture parses.
- **Happy — Cutout / Weather:** Same for `CutoutPort` and `WeatherPort` with their fixtures.
- **Edge — malformed vendor output rejected:** Given a payload missing a required §5 field or with a wrong-type field (e.g. `tempC: "warm"`), When passed to the corresponding `*ResultSchema.parse`, Then it throws a `ZodError` (the contract refuses to let unvalidated data cross).
- **Edge — no vendor type leak:** Given `git grep -nE 'openai|OpenAI|photoroom|Photoroom|open-meteo|openmeteo' packages/shared/src/ports`, When run, Then it returns zero matches (adapters, not ports, know vendor names).
- **Edge — enum boundary:** Given a value one step outside a documented enum (e.g. `category: "spaceship"`), When parsed, Then `ZodError`; given the exact documented enum member, Then it parses.
- **Empty/optional:** Given an input where §5 marks a field optional (e.g. `secondaryColors: []`), When parsed, Then it succeeds and the field is present-and-empty, not `undefined`-collapsed inconsistently.
- **Swap invariant (concurrent/A-B):** Given two distinct fake adapters both typed `AIVisionPort` returning different valid fixtures, When a generic caller `run(port: AIVisionPort)` is invoked with each, Then both typecheck and run identically — proving the caller is vendor-agnostic.

## 5. Verification requirements — independent oracle

**Tier (docs/05):** Tier-0 spec-literal contract test. This is NOT a self-graded unit test of hand-written logic; there is no logic — the oracle checks that the *published surface conforms to the spec* and that *only Zod-validated data crosses*.

**Mechanism — two independent signals:**

1. **Type-conformance (compiler as oracle):** Each `*.test.ts` declares a *fake in-memory adapter* satisfying the interface (`const fake: AIVisionPort = {...}`). The independent signal is the TypeScript compiler under `tsc --noEmit`: if a port method signature drifts from §5 or a vendor type leaks in, the fake fails to typecheck. A deliberately-wrong control (see below) confirms the check has teeth.
2. **Contract assertion (differential valid/invalid):** Each `*.test.ts` asserts, with vitest:
   - a `validFixture` built to match docs/06 §5 field-for-field → `Schema.parse(validFixture)` returns and deep-equals the fixture (round-trip: parse of a spec-shaped object preserves it);
   - **red-first control:** an `invalidFixture` (missing required field / wrong type / out-of-enum) → `expect(() => Schema.parse(invalidFixture)).toThrow(ZodError)`. This must be RED if the schema were loosened to `z.any()`/`z.object({}).passthrough()`, which is what makes it a real oracle rather than a tautology.
3. **Leak grep (mutation-target):** a test (or documented CI grep) asserting zero vendor-name matches under `packages/shared/src/ports` — mutating a port to import a vendor SDK type turns this red.

**What green looks like:** `pnpm --filter @closet/shared test` runs the three `*.integration`-not-required unit contract tests to pass (this is Tier-0, plain `*.test.ts`), `tsc --noEmit` is clean with all three fake adapters present, the three invalid-fixture cases each throw `ZodError`, and the vendor-name grep returns nothing. Fields and enums in each `*ResultSchema` match docs/06 §5 exactly — reviewer diffs the schema against §5.

## 6. Failure / degradation behavior

These are interface + contract definitions only; they perform no I/O, so they cannot fail at runtime here. The contracts nonetheless encode the degradation seam callers rely on:
- Method signatures return `Promise<Result>` and are permitted to **reject** — the port does not bake in a fallback shape (no `{ ok: false }` union unless docs/06 §5 specifies one). Timeout/retry/circuit-break policy belongs to the adapters and callers (wave 3), NOT to these interfaces; do not add retry or fallback fields here.
- Because Weather is keyless (Open-Meteo) but the port takes no API-key input, a future keyed weather vendor is swappable without a signature change — verify `WeatherInput` carries no credential field.
- The Zod schemas are the degradation guard at the boundary: a vendor returning a partial/garbage payload surfaces as a `ZodError` at `parse` time in the adapter rather than propagating an untyped object into the domain.

## Metadata

- **Parent spec:** docs/06 §5 Ports.
- **Step:** wave 2.
- **Demo (isolatable):** `pnpm --filter @closet/shared test` + `pnpm --filter @closet/shared exec tsc --noEmit` — green in isolation, no DB, no network, no other packages required.
- **Complexity:** Low (type + Zod contract definitions; no runtime logic).
- **Dependencies:** `zod` (already a `packages/shared` dependency); no new packages, no vendor SDKs. Downstream: wave-3 real adapters (GPT-4o / Photoroom / Open-Meteo) and parse-job handler consume these ports — not in scope here.
