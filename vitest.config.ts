import { defineConfig } from 'vitest/config';

// Two tiers for the backend phase (mobile/nightly projects are added with the
// frontend / paid-provider work). Vitest v4 folds workspaces into `test.projects`.
//
// - `unit`: the inner loop (<5s) — pure logic + schemas in packages/*/src.
// - `integration`: boots real Postgres via testcontainers (3-8s/file) — the RLS
//   oracle. Excluded from the fast unit selection. Its setup file configures the
//   container runtime (colima vs Docker Desktop) before any test imports.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
          exclude: ['**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts'],
          exclude: ['node_modules/**', 'dist/**'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          passWithNoTests: true,
          setupFiles: ['packages/db/test/detect-container-runtime.ts'],
        },
      },
    ],
  },
});
