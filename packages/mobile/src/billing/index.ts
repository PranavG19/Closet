// The billing seam: the BillingPort React context and the RevenueCat adapter.
//
// Lives under src/ rather than features/monetization/ for a mechanical reason worth
// knowing: the vitest `unit` project globs `packages/*/src/**/*.test.ts`, so a test placed
// under features/ is SILENTLY NOT RUN — it does not fail, it simply never executes. The
// adapter carries the store-contract tests that must run on every commit, so it lives
// where the runner can see it. (This mirrors src/session/nativeCredentials.ts, the same
// no-native-imports adapter pattern for Apple/Google sign-in.)
export * from './BillingProvider.js';
export { makeBillingPort } from './revenueCatNative.js';
export { makeRevenueCatBillingPort, type RevenueCatSurface, type RevenueCatPackage } from './revenueCatPort.js';
