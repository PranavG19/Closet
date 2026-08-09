// Public surface of the session layer (the auth port + its React seam + the pure
// gate decision). Feature screens import from here; only src/App.tsx constructs
// the real supabase-backed adapter.
export * from './AuthPort.js';
export * from './gate.js';
export * from './tokenSource.js';
export * from './SessionProvider.js';
export { makeSupabaseAuthPort, type SupabaseAuthPortDeps } from './supabaseAuthPort.js';
// The credential adapters (pure, injectable) and the one module that binds the real
// native SDKs to them. Only src/App.tsx calls makeNativeCredentialProviders.
export {
  makeAppleCredentialProvider,
  makeGoogleCredentialProvider,
  type AppleNativeSurface,
  type GoogleNativeSurface,
} from './nativeCredentials.js';
export { makeNativeCredentialProviders } from './nativeProviders.js';
