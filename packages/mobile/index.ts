// Expo entry point. Registers the composition root (src/App) as the RN root
// component. `expo.main` in package.json points here. Kept at the package root
// (the conventional Expo entry location) so the tooling finds it without config.
//
// SCREENSHOT-HARNESS BRANCH (dev / E2E only). When EXPO_PUBLIC_HARNESS === '1' — set
// only by the `start:harness` / `ios:harness` scripts — the harness root is registered
// instead of the production App. The harness boots with a default user already signed
// in, a fake backend serving canned data, and fake billing/photo ports, so a screenshot
// agent can drive every screen on a simulator WITHOUT a deployed Supabase project or
// provider keys. When the var is UNSET the production `App` path is unchanged.
//
// WHY `require`, NOT a top-level `import`: the harness lives under harness/, which the
// human-owned packages/mobile/tsconfig.json `include` (index.ts + src + features) does
// NOT list. A static `import './harness/…'` would add those files to this project's TS
// program and fail `tsc --build` with TS6307 ("not listed within the file list"), and the
// tsconfig is cage-locked (CLAUDE.md — the agent cannot edit its own cage). A string
// `require()` is not statically collected into the TS program, so tsc stays green, while
// Metro DOES statically collect it for the bundle. The metro.config.js resolver maps the
// `.js` specifier to the on-disk `.tsx` the same way it does for every other import here.
import { registerRootComponent } from 'expo';
import { App } from './src/App.js';

// Three tools disagree on how to reference the harness, and require() is the only specifier all
// three accept: (1) tsc — harness/ is outside this package's cage-locked tsconfig `include`, so a
// static `import` raises TS6307 and a dynamic `import()` still pulls it into the TS program;
// (2) Metro — must STATICALLY see the specifier to bundle the harness, which an async import or
// createRequire defeats; (3) registerRootComponent needs the component SYNCHRONOUSLY at startup,
// so `await import()` is out. Dev/E2E-only, one branch in the entry file — not a pattern.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const harnessRoot = (): typeof App => require('./harness/HarnessApp.js').HarnessApp as typeof App;

registerRootComponent(process.env.EXPO_PUBLIC_HARNESS === '1' ? harnessRoot() : App);
