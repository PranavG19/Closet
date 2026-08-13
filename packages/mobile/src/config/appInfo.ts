// The app version shown on the Account screen (so a user can quote it to support and a
// reviewer can read off the build under test).
//
// WHY A CONSTANT, NOT AN import of app.json: app.json is the source of truth, but importing it
// here fails under NodeNext (needs `with { type: 'json' }` AND app.json listed in the mobile
// tsconfig's file set — and tsconfig*.json is a human-owned cage file this agent must not edit).
// expo-constants would read it at runtime but is a new native dependency (another rebuild +
// version-skew risk) for one string. So this mirrors app.json's `expo.version` as a single
// constant with a sync note. The version changes rarely and deliberately (a release bump), so
// the drift risk is low and localised to one line.
//
// KEEP IN SYNC WITH packages/mobile/app.json → expo.version.
const APP_VERSION = '0.1.0';

export function appVersion(): string {
  return APP_VERSION;
}
