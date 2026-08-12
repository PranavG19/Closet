// The SERIF display face, platform-forked at the module boundary.
//
// WHY A FORKED MODULE, not `Platform.select` inside tokens.ts: tokens.ts is imported by
// contrast.test.ts in the Node unit lane, and ANY static `import ... from 'react-native'`
// breaks that lane (rolldown cannot parse react-native's Flow index.js). This module imports
// nothing — it exports a plain string — so tokens.ts stays Node-importable.
//
// Metro resolves `serifFamily.ios.ts` / `serifFamily.android.ts` per platform (the custom
// resolver in metro.config.js strips the NodeNext `.js` specifier and lets Metro's
// platform-aware sourceExts search pick the fork). tsc and Node/vitest resolve THIS base file,
// where the value is only ever read in non-rendering contexts (tests), so the iOS default is a
// harmless stand-in there.
export const serifFamily = 'Georgia';
