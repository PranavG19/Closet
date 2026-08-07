// The supabase-js client. Used ONLY for (1) auth (session / JWT) and (2) Storage
// bytes (upload originals, download cutouts). It is NEVER used for table access:
// `supabase.from()` is lint-banned in mobile — every table read/write goes through
// the typed Edge API client (repos-only is a locked invariant). The session's
// access token is what the API client attaches as the bearer.
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { loadConfig } from './config.js';

// SecureStore-backed session storage: the JWT never touches AsyncStorage/plaintext.
// supabase-js expects a getItem/setItem/removeItem string store.
const secureStorageAdapter = {
  getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  setItem(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key);
  },
};

function makeSupabase(): SupabaseClient {
  const config = loadConfig();
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: secureStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      // No URL-based session detection on native.
      detectSessionInUrl: false,
    },
  });
}

let cached: SupabaseClient | undefined;

// Lazily constructed so a missing-config error surfaces at first use, not at
// module import time (which would crash before the error boundary mounts).
export function getSupabase(): SupabaseClient {
  cached ??= makeSupabase();
  return cached;
}

// The current access token (JWT) for the bearer header, or null if signed out.
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
