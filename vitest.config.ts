import { defineConfig } from 'vitest/config';

// Two tiers for the backend phase (mobile/nightly projects are added with the
// frontend / paid-provider work). Vitest v4 folds workspaces into `test.projects`.
//
// - `unit`: the inner loop (<5s) — pure logic + schemas in packages/*/src, PLUS
//   packages/*/features (the mobile feature slices — see the note on that glob).
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
          // `packages/*/features/**` is here because its ABSENCE was a silent hole, not
          // because anything lives there today (it is currently empty — every mobile test
          // was deliberately placed under src/ once this was discovered).
          //
          // The failure mode: packages/mobile is organised as `src/` + `features/`
          // (conventions.json declares featureRoots), and a `.test.ts` written under
          // features/ matched NO project glob — so it did not run and DID NOT FAIL. It was
          // invisible. That happened twice in one session: a 20-test billing-adapter suite
          // and a 10-test storage suite both silently never executed, and were only caught
          // by running vitest against the file and reading "No test files found".
          //
          // Widening an include can only make MORE tests run, so this strengthens the gate
          // rather than relaxing one. It is landed on its own, with no code depending on it,
          // precisely so it is not a config change bundled with the thing it unblocks.
          //
          // Same class of trap, already documented in docs/ORCHESTRATION.md lesson 5: an
          // `.integration.test.ts` placed under src/ is silently skipped by the integration
          // project. If you add a directory convention, add its glob in the same change.
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/features/**/*.test.ts',
            // Pure-logic test-helper unit tests (e.g. the perf percentile math oracle,
            // helpers/perf.test.ts). These live under test/ because the helper is test
            // infra, but the test itself is pure (no container) and MUST run in the fast
            // lane — without this line it matched no project and silently never ran (the
            // aggregate-emptiness trap this repo has hit before). Container-backed helper
            // tests do NOT belong here; they carry the .integration/.perf suffix and are
            // excluded below, so a new one cannot accidentally join the fast wall.
            'packages/*/test/helpers/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: ['**/*.integration.test.ts', '**/*.perf.test.ts', 'node_modules/**', 'dist/**'],
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
      {
        // Tier-5 perf/SLO lane (docs/05 Tier-5). Its OWN project, deliberately NOT part
        // of `pnpm verify`'s test:unit/test:integration steps, because sampling N runs of
        // every operation blows the synchronous p95<90s gate budget (Rule 4). Run it
        // on-demand / nightly with `pnpm test:perf`. Same real-Postgres substrate as
        // integration, so it needs the container-runtime setup and the long timeouts.
        // Runs single-file (fileParallelism off): concurrent Postgres containers on the
        // dev VM contend for CPU and would distort the very wall-clock numbers this
        // lane exists to measure.
        test: {
          name: 'perf',
          include: ['packages/*/test/**/*.perf.test.ts'],
          exclude: ['node_modules/**', 'dist/**'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
          fileParallelism: false,
          passWithNoTests: true,
          setupFiles: ['packages/db/test/detect-container-runtime.ts'],
        },
      },
    ],
  },
});
