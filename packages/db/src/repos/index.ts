// Repos barrel + the QueryExecutor seam. This is the SINGLE definition of
// QueryExecutor for the whole monorepo (task-09b assumption): the prod executor in
// packages/functions (task-09a) IMPLEMENTS this interface by importing it from
// @closet/db, and the W1 test helpers (makeTenantExecutor/makeSuperuserExecutor)
// already expose exactly this shape. There must be exactly one.
//
// The executor is the whole DB seam a repo sees: query() runs one statement in one
// transaction that already carries tenant context (SET LOCAL ROLE app_user + the
// verified sub). It exposes ONLY { rows } — no rowCount, no client handle, no tx
// control — so every "did this write happen" decision a repo makes rides on a
// RETURNING row, never a driver rowcount. No SQL lives in this file.
export interface QueryExecutor {
  query<Row = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export * from './wardrobe.repo.js';
export * from './parse-jobs.repo.js';
export * from './outfits.repo.js';
export * from './outfit-items.repo.js';
export * from './wear-log.repo.js';
export * from './palette.repo.js';
export * from './subscriptions.repo.js';
export * from './webhook-events.repo.js';
