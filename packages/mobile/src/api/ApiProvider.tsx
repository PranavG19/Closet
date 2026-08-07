// Provides the ApiClient to the hook layer. The default client attaches the live
// Supabase session token; a test / preview injects a fake client. Kept separate
// from hooks.ts so the client instance is a single React context value.
import React, { createContext, useContext, useMemo } from 'react';
import { ApiClient } from './client.js';
import { currentAccessToken } from './supabase.js';

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiProviderProps {
  readonly children: React.ReactNode;
  // Injectable for tests/previews; defaults to a real client bound to the Supabase
  // session token.
  readonly client?: ApiClient;
}

export function ApiProvider({ children, client }: ApiProviderProps): React.JSX.Element {
  const value = useMemo(
    () => client ?? new ApiClient({ getToken: currentAccessToken }),
    [client],
  );
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error('useApiClient must be used within <ApiProvider>.');
  }
  return client;
}
