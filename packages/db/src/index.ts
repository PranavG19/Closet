// @closet/db — the ONLY DB-access seam. Repos (QueryExecutor pattern) and the
// migration chain live here. Every repo factory + the QueryExecutor type is
// exposed through this barrel so functions import them by name from @closet/db.
export * from './repos/index.js';
