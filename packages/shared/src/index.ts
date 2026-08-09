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

// On-device pure functions (task-07, task-08)
export * from './harmony.js';
export * from './dedupe.js';
export * from './suggestion.js';
export * from './palette.js';
export * from './subscriptionDisclosure.js';
