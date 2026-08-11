// @closet/mobile — the Expo app (built in the FRONTEND phase, docs/04). Feature
// domains land under features/<root> (roots declared in conventions.json). Colors
// come from useTokens() only; the app talks to the Edge Functions through the typed
// API client (repos-only — never supabase.from() for tables).
//
// Shared building blocks (tokens, UI primitives, API client + hooks) are exported
// here; feature screens live under features/<root> and are composed by App.tsx.
export * from './tokens/index.js';
export * from './ui/index.js';
export * from './api/index.js';
export * from './session/index.js';
export * from './account/index.js';
export * from './photo/index.js';
export { App, default } from './App.js';
