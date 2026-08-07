// Metro config for the Expo app.
//
// It exists for ONE reason: this repo's tsconfig is `module: NodeNext`, which
// REQUIRES a relative import to carry the extension of the EMITTED file — so every
// source here writes `import { App } from './src/App.js'` while the file on disk is
// `App.tsx`. `tsc` understands that mapping; Metro does not. Metro resolves the
// literal specifier, finds no `src/App.js`, and the bundle fails at the entry point
// with "Unable to resolve module ./src/App.js".
//
// The fix is a resolver that, for a RELATIVE `.js`/`.jsx` specifier that does not
// resolve literally, retries without the extension and lets Metro's normal
// sourceExts search (which puts `.ts`/`.tsx` ahead of `.js`) find the real file.
//
// Deliberately NOT done instead:
//   - rewriting every import to be extensionless: that breaks `tsc` under NodeNext,
//     and tsconfig is human-owned;
//   - unconditional stripping: a genuine `.js` file next to a same-named `.ts` would
//     silently resolve to the wrong one. The literal path is tried FIRST and only a
//     resolution failure falls through, so an existing `.js` always wins.
//
// Scoped to relative specifiers on purpose: a bare package specifier ('expo',
// '@closet/shared') resolves through node_modules / package "exports", where the
// extension is already correct and rewriting it would be wrong.
// This package is `"type": "module"`, so Metro loads this file as real ESM. Two
// consequences, both load-bearing: the specifier needs its explicit `.js` (the expo
// package publishes no "exports" map, so ESM will not extension-search it), and the
// module is CJS (`module.exports = require('@expo/metro-config')`) — a re-export the
// CJS named-export lexer cannot see through, so the default import is destructured
// rather than named-imported.
import metroConfig from 'expo/metro-config.js';

const { getDefaultConfig } = metroConfig;

const config = getDefaultConfig(import.meta.dirname);

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;

  const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../');
  const jsExtension = /\.(js|jsx)$/.exec(moduleName);

  if (!isRelative || jsExtension === null) {
    return resolve(context, moduleName, platform);
  }

  try {
    return resolve(context, moduleName, platform);
  } catch {
    // The literal `.js` does not exist — this is the NodeNext-specifier case. Retry
    // extensionless so Metro's sourceExts search picks up the `.ts`/`.tsx` source.
    // If THIS throws too, the error propagates: a genuinely missing module must
    // still be a hard failure, not a silently swallowed one.
    return resolve(context, moduleName.slice(0, -jsExtension[0].length), platform);
  }
};

export default config;
