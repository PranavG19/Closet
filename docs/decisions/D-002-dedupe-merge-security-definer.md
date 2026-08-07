# D-002 — Dedupe keep-one merge via SECURITY DEFINER fn (append-only wear_log preserved)

**Date:** 2026-08-06 · **Decider:** orchestrator (raised by the W3 build agent) · **Status:** accepted

## Context
The dedupe keep-one MERGE (docs/06 §7) must re-point `wear_log.item_id` and `outfit_items.item_id` off the discarded garment, then delete the discard. But `wear_log` is deliberately **append-only**: migration 0006 grants `app_user` only `SELECT, INSERT` — no UPDATE (§3: "no UPDATE/DELETE policy ⇒ append-only structurally"). So a direct re-point UPDATE as `app_user` fails 42501. `GRANT UPDATE on wear_log` would fix the error but **destroy the append-only moat invariant** for all direct access — rejected by the build agent, correctly.

## Decision
Implement the merge as a **`SECURITY DEFINER` plpgsql function** (`public.merge_keep_one(keep, discard)`), migration `0011_dedupe_merge_fn.sql` — the spec's "one plpgsql fn". It is the ONLY mutation path allowed to re-point wear history; `wear_log` stays append-only for every direct client access (a client still cannot UPDATE/DELETE a wear row). Additive + reversible (real UP+DOWN dropping the fn).

**Mandatory hardening (SECURITY DEFINER bypasses RLS — these are non-negotiable):**
1. **`SET search_path = ''`** on the function + every object reference schema-qualified (`public.*`, `auth.uid()`, `pg_catalog` ops). Closes the classic definer privilege-escalation vector. **Mechanically enforced** by the new `check-definer-search-path` gate (sync, structural, fire-drill-proven).
2. **Up-front ownership assertion**, RAISE (42501) on foreign/missing keep or a true cross-tenant discard — don't rely on a silently-0-row WHERE.
3. **REVOKE ALL ON FUNCTION … FROM PUBLIC**, then GRANT EXECUTE to `app_user` (default is EXECUTE-to-PUBLIC).
4. Real UP + DOWN; comment the definer-owner divergence (superuser on bare container; migration role on hosted).

**Cross-tenant vs idempotency resolution (Option B):** condition-2's "RAISE on cross-tenant" conflicted with task-10's idempotent-retry contract (a retry after a successful merge names an own-but-now-deleted id, which must be a `merged:false` no-op, not an error). Because the fn is DEFINER it can see across tenants, so it distinguishes:
- discard EXISTS under another user → RAISE (true cross-tenant probe);
- discard absent (never existed OR already-merged) → return false (idempotent no-op);
- keep must be own+present → RAISE otherwise.
Accepted tradeoff: this is technically a cross-tenant *existence* oracle, but non-exploitable (ids are 122-bit random `gen_random_uuid()`, unguessable; keep must be own). Noted in the fn comment.

## Oracle (integration, app_user, real Postgres)
(a) within-tenant merge re-points + deletes, wear history preserved; (b) cross-tenant probe RAISEs AND B's rows byte-unchanged (DB-state oracle, not the raise alone); (c) `app_user` STILL cannot directly UPDATE/DELETE wear_log (fn is the only mutation path); (d) check-rls + check-definer-search-path green.

## Enforcement added
`scripts/gates/check-definer-search-path.mjs` (committed, sync, weight 0) — fails if any SECURITY DEFINER fn in migrations lacks a pinned search_path. Makes the unsafe form detectable on every future migration, not reviewed once.
