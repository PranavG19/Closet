# D-001 — Outfit create idempotency: client-minted id, no client_id column

**Date:** 2026-08-06 · **Decider:** orchestrator (raised by a W3 authoring subagent) · **Status:** accepted

## Context
task-11 (outfits endpoint, F6) requires idempotent outfit *create*. A W3 authoring agent found that neither the committed `outfits` table (0004) nor `CreateOutfitRequest` (task-05) can express idempotency within task-11's original file scope, and asked whether to (A) widen task-11 to edit the request schema, (B) drop outfit-row idempotency, or (C) land a prerequisite schema edit first.

## Decision — refined Option A
- **Do NOT add a `client_id` column to `outfits`.** docs/06 §3 (authoritative on columns) gives `outfits` no `client_id`; adding one needs a migration and contradicts the spec. Only `wear_log` carries `client_id` + partial `UNIQUE(user_id, client_id)`.
- **Use the constraint that already exists.** `outfits` has `id uuid PRIMARY KEY` + `CONSTRAINT outfits_user_id_id_key UNIQUE (user_id, id)` (committed in 0004). The caller mints the `id` (CLAUDE.md: "client_id minted by the CALLER at tap time" — the principle is a caller-minted identifier, which a client-minted `id` satisfies).
- **Scope:** task-11 owns a ~2-line edit to `packages/shared/src/schemas/outfits.ts` — add optional `id: Uuid` to `CreateOutfitRequest` (keep `.strict()`; `id` is the only new field). This is a deliberate, orchestrator-approved one-file widening of task-11's scope; task-11 still must NOT touch any other shared schema file. Collision-safe: task-11 is the only W3 task touching `schemas/outfits.ts`.
- **Handler:** `INSERT ... ON CONFLICT (user_id, id) DO NOTHING`, then read the row back so a retry with the same `id` returns the same outfit (not a racy SELECT-then-INSERT).
- **Oracle:** integration test as `app_user` against real Postgres — create with id X, retry with id X → exactly one row, same outfit; cross-tenant item_id still rejected by the composite FK.

## Rejected
- **B (item-grain-only idempotency):** loses outfit-create idempotency, which retries genuinely need.
- **C (separate prerequisite task+build cycle):** overkill for a 2-line edit; end-state is identical to A anyway.
- **Literal "add a client_id column":** more than needed and contradicts docs/06 §3.

## Integration check (orchestrator owns)
When integrating W3, confirm: (1) NO new migration adds a `client_id`/extra column to `outfits`; (2) the only change to `schemas/outfits.ts` is the optional `id: Uuid`; (3) the outfits handler uses `ON CONFLICT (user_id, id)`.
