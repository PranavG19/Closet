// Runtime config for the API client + Supabase client. Read from Expo's public
// env vars (EXPO_PUBLIC_*), which Metro statically inlines into the bundle at
// build time — so these are compile-time constants on-device, NOT a Deno-style
// runtime `process.env` lookup (the "never bare process.env" rule targets the
// Edge/Deno runtime, where bare process.env silently yields undefined; in the
// Metro-bundled RN app EXPO_PUBLIC_* is the sanctioned mechanism). Set them in
// `.env` / EAS env; NEVER hardcode.
//
// The Edge base URL, Supabase URL, and anon key are public-by-design values (the
// anon key is safe on the client; RLS FORCE is the real control) — no secret lives
// here.
export interface AppConfig {
  // Base URL of the Supabase project (used by supabase-js for auth + storage).
  readonly supabaseUrl: string;
  // The public anon key. Safe on-device: every table is RLS FORCE default-deny;
  // the key alone grants nothing without a verified user JWT.
  readonly supabaseAnonKey: string;
  // Base URL the Edge Functions are served under, e.g.
  // `https://<ref>.supabase.co/functions/v1`. One typed method per route appends
  // the route name to this.
  readonly functionsBaseUrl: string;
}

// Obviously-fake DEV stand-ins, used ONLY when __DEV__ is true and the real value is
// absent. `.invalid` is the RFC 2606 reserved TLD that is guaranteed never to
// resolve, so a request built from these fails at DNS instead of reaching a real
// host — a placeholder that cannot silently talk to someone else's project. They
// still satisfy supabase-js's constructor (which requires an http(s) URL and a
// non-empty key), which is what lets the app mount and render at all.
const DEV_PLACEHOLDERS: AppConfig = {
  supabaseUrl: 'https://placeholder.supabase.invalid',
  supabaseAnonKey: 'placeholder-anon-key-not-a-real-credential',
  functionsBaseUrl: 'https://placeholder.supabase.invalid/functions/v1',
};

// `typeof` guard, not a bare `__DEV__`: the identifier is a Metro/RN global, so a
// bare reference is a ReferenceError under any non-Metro consumer of this module
// (vitest, `tsc`-emitted output run in node). Metro's inline-plugin replaces the
// identifier with the literal `false` in a release bundle whether or not it sits
// behind a typeof — verified against metro-transform-plugins' inline-plugin — so
// this reads as `false && ...` in production and the throw below is unreachable-free
// and unconditional. Nothing here weakens the release guarantee.
function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

// Emitted once per missing key, through a bracket access on the global console —
// the same single-sanctioned-sink shape as packages/functions' structured logger
// (`console.` member access is lint-banned). Carries only the key NAME; a config
// value is never logged.
function warnPlaceholder(key: string): void {
  (globalThis as { console: { warn(line: string): void } }).console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'config.dev_placeholder_used',
      key,
      detail: 'DEV build only — requests using this value will fail. Set it in .env.',
    }),
  );
}

function requireEnv(value: string | undefined, key: string, devFallback: string): string {
  if (value !== undefined && value.length > 0) return value;
  // DEV ONLY: fall back so the app boots with no backend provisioned yet and the UI
  // can be observed. A RELEASE build takes the throw below, unchanged.
  if (isDevBuild()) {
    warnPlaceholder(key);
    return devFallback;
  }
  throw new Error(
    `Missing config "${key}". Set it as an EXPO_PUBLIC_* env var (.env / EAS env) so Metro inlines it.`,
  );
}

// Reads + validates config once. In a PRODUCTION build a missing required value
// still throws, so a misconfigured release fails loudly at startup rather than
// sending requests to `undefined`. In DEV a missing value degrades to an
// obviously-fake placeholder plus a loud warning, so the app renders and API calls
// fail per-request instead of the whole tree dying before first paint. Metro
// replaces each `process.env.EXPO_PUBLIC_*` reference with a string literal at
// bundle time.
export function loadConfig(): AppConfig {
  return {
    supabaseUrl: requireEnv(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      'EXPO_PUBLIC_SUPABASE_URL',
      DEV_PLACEHOLDERS.supabaseUrl,
    ),
    supabaseAnonKey: requireEnv(
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      DEV_PLACEHOLDERS.supabaseAnonKey,
    ),
    functionsBaseUrl: requireEnv(
      process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL,
      'EXPO_PUBLIC_FUNCTIONS_BASE_URL',
      DEV_PLACEHOLDERS.functionsBaseUrl,
    ),
  };
}
