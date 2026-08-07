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

function requireEnv(value: string | undefined, key: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing config "${key}". Set it as an EXPO_PUBLIC_* env var (.env / EAS env) so Metro inlines it.`,
    );
  }
  return value;
}

// Reads + validates config once. Throws a clear error if a required value is
// absent, so a misconfigured build fails loudly at startup rather than sending
// requests to `undefined`. Metro replaces each `process.env.EXPO_PUBLIC_*`
// reference with a string literal at bundle time.
export function loadConfig(): AppConfig {
  return {
    supabaseUrl: requireEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: requireEnv(
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    ),
    functionsBaseUrl: requireEnv(
      process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL,
      'EXPO_PUBLIC_FUNCTIONS_BASE_URL',
    ),
  };
}
