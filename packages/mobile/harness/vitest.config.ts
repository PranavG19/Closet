// Harness-only vitest config. The root vitest.config.ts `unit` project globs only
// packages/*/src and packages/*/features, so a test under harness/ matches NO project
// and runs ZERO tests — a vacuous green (see docs/ORCHESTRATION.md lesson 5 and the note
// atop fakeBackend.test.ts). This config exists so the harness's canned-data oracle
// actually executes:
//
//   pnpm -w exec vitest run --config packages/mobile/harness/vitest.config.ts
//
// It is a harness file (dev/E2E only), not part of the shipped app or the gate wall.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/mobile/harness/**/*.test.ts'],
    // Anti-vacuity: if the glob ever matches nothing, fail loudly rather than pass green.
    passWithNoTests: false,
  },
});
