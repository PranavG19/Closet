// ThemeProvider + useTokens() — the single seam through which every component
// reads design tokens. A component NEVER imports `lightTokens` directly and NEVER
// writes a literal color/px; it calls useTokens() and reads the semantic token.
// That indirection is what lets the real hex/typeface slot into tokens.ts without
// touching a component, and is what the no-literal-color CI gate assumes.
import React, { createContext, useContext } from 'react';
import { lightTokens, type Tokens } from './tokens.js';

const TokensContext = createContext<Tokens>(lightTokens);

export interface ThemeProviderProps {
  readonly children: React.ReactNode;
  // Injectable so a future dark theme (or a test) can supply a different Tokens
  // object; the default is the light theme (the only theme in MVP, docs/03).
  readonly tokens?: Tokens;
}

export function ThemeProvider({ children, tokens = lightTokens }: ThemeProviderProps): React.JSX.Element {
  return <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>;
}

// The ONLY sanctioned source of colors/spacing/type in a component.
export function useTokens(): Tokens {
  return useContext(TokensContext);
}
