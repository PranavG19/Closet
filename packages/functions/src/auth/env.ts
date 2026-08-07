// envValue — the ONLY sanctioned way to read configuration. Edge runs Deno, where
// `Deno.env.get` is the source of truth and a bare `process.env.X` silently yields
// undefined; under Node (tests, tsc) `process.env` is the source. This reads
// whichever global is present so the same handler code runs in both runtimes
// without a bare `process.env` reference leaking into a handler (CLAUDE.md).
//
// It never throws for a missing key here — callers that require a value use
// `requireEnv`, which fails loudly at startup rather than proceeding with an
// undefined secret.

interface DenoEnv {
  env: { get(key: string): string | undefined };
}

function fromDeno(key: string): string | undefined {
  const maybeDeno = (globalThis as { Deno?: DenoEnv }).Deno;
  return maybeDeno?.env?.get(key);
}

function fromNode(key: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return maybeProcess?.env?.[key];
}

export function envValue(key: string): string | undefined {
  return fromDeno(key) ?? fromNode(key);
}

export function requireEnv(key: string): string {
  const value = envValue(key);
  if (value === undefined || value === '') {
    throw new Error(`missing required env: ${key}`);
  }
  return value;
}
