// The Edge route map — reconciled to the deployed Deno shims (supabase/functions/*).
// The Supabase convention is ONE function directory = ONE deployed function = ONE
// URL, so each operation is its own flat route (not sub-paths under a domain
// function). These names MUST match the supabase/functions/<name> directories; this
// is the ONE place a route string lives — no call site hardcodes a URL. `method` is
// advisory for the client; every op posts JSON except the two reads, which GET.
export const ROUTES = {
  listWardrobe: { path: 'wardrobe-list', method: 'GET' },
  toggleAvailability: { path: 'wardrobe-availability', method: 'POST' },
  resolveDedupe: { path: 'wardrobe-dedupe', method: 'POST' },
  createOutfit: { path: 'outfits-create', method: 'POST' },
  listOutfits: { path: 'outfits-list', method: 'GET' },
  deleteOutfit: { path: 'outfits-delete', method: 'POST' },
  renameOutfit: { path: 'outfits-rename', method: 'POST' },
  logWear: { path: 'wear-log', method: 'POST' },
  upsertPalette: { path: 'palette-upsert', method: 'POST' },
  readEntitlement: { path: 'palette-entitlement', method: 'GET' },
  readPalette: { path: 'palette-read', method: 'GET' },
  parsePhoto: { path: 'parse-photo', method: 'POST' },
  // Account self-service. `deleteAccount` is the irreversible purge Apple Review
  // Guideline 5.1.1(v) requires be reachable IN-APP; `exportMyData` is the
  // GDPR Art. 15 / CCPA subject-access document.
  deleteAccount: { path: 'account-delete', method: 'POST' },
  exportMyData: { path: 'account-export', method: 'GET' },
} as const;

export type RouteName = keyof typeof ROUTES;
