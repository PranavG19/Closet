// @closet/shared — the type SSOT. Zod schemas, pure functions, and port interfaces
// live here; each new public symbol is re-exported through this barrel.

// parse-don't-cast boundary (task-05)
export * from './parse.js';

// Zod row + request/response schemas (task-05)
export * from './schemas/index.js';

// Vendor ports + Zod result contracts (task-06)
export * from './ports/AIVisionPort.js';
export * from './ports/CutoutPort.js';
export * from './ports/WeatherPort.js';
export * from './ports/BillingPort.js';
// The on-device photo intake seam (picker + screener + byte hashing). A PORT because
// every native module it would need — a picker, expo-file-system, expo-image-manipulator,
// an ML runtime — is absent from packages/mobile, and because the screener's absence must
// be a value the UI branches on (`screeningAvailable`) rather than an assumption.
export * from './ports/PhotoIntakePort.js';

// The approval brand + the ONE source-photo key composer. In `shared` because both
// the client (upload) and the server (signing) must compose the identical key, and
// mobile cannot import @closet/functions.
export * from './approvedPhoto.js';

// On-device pure functions (task-07, task-08)
export * from './harmony.js';
export * from './colorFamily.js';
export * from './dedupe.js';
export * from './suggestion.js';
export * from './palette.js';
export * from './subscriptionDisclosure.js';
export * from './wardrobeSuggestion.js';
export * from './suggestionNote.js';
