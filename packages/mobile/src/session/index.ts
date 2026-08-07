// Public surface of the session layer (the auth port + its React seam + the pure
// gate decision). Feature screens import from here; only src/App.tsx constructs
// the real supabase-backed adapter.
export * from './AuthPort.js';
export * from './gate.js';
export * from './tokenSource.js';
export * from './SessionProvider.js';
export { makeSupabaseAuthPort, type SupabaseAuthPortDeps } from './supabaseAuthPort.js';
