// eslint.config.mjs — flat config. HUMAN-OWNED (see conventions.json humanOwnedPaths):
// the agent must not edit this to unblock a change. The FEATURE_ROOTS array below is
// the ONE generated region — edit conventions.json featureRoots and run `pnpm gen`,
// never hand-edit between the markers.
//
// Scaffold baseline: the structural boundary rules the docs promise (no cross-feature
// imports, no supabase.from() outside db, colors from useTokens() only, no bare
// process.env, no-console) are wired here as the corresponding source lands. This
// file starts with the always-true rules (typescript-eslint recommended + the
// cross-feature import zone scaffolding) and grows with the code it guards.

import tseslint from "typescript-eslint";

// <<< GENERATED FEATURE_ROOTS (gen-conventions.mjs) — DO NOT EDIT >>>
const FEATURE_ROOTS = [
  "auth",
  "laundry",
  "monetization",
  "navigation",
  "onboarding",
  "outfits",
  "palette",
  "suggestions",
  "wardrobe",
  "wearlog",
];
// <<< END GENERATED FEATURE_ROOTS >>>

// Cross-feature import ban (to activate WITH the mobile UI task that adds
// eslint-plugin-import + the first features/ dirs): a file under features/<A> may
// not import from features/<B>; shared code routes through packages/shared. The
// zones are derived from FEATURE_ROOTS so adding a domain in conventions.json wires
// its isolation for free. Kept as a pure value now (referenced so the generated
// array isn't flagged unused) — the import/no-restricted-paths rule is wired in the
// same task that adds the plugin, per "add the gate with the code it guards."
export const crossFeatureZones = FEATURE_ROOTS.map((root) => ({
  target: `./packages/mobile/features/${root}`,
  from: "./packages/mobile/features",
  except: [`./${root}`],
  message:
    "Cross-feature imports are banned. Route shared logic through packages/shared.",
}));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      ".worktrees/**",
      ".claude/worktrees/**",
      "packages/mobile/.expo/**",
    ],
  },
  ...tseslint.configs.recommended,
);
