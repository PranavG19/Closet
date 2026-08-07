// serveAuthed — the ~1-line entrypoint a Deno Edge shim calls:
//   serveAuthed(listWardrobe)
// It wraps the AuthedHandler in withAuth (JWKS verify + per-request app_user
// executor) and registers the result as the runtime fetch handler. The concrete
// Postgres pool and the runtime `serve` are resolved from the environment the shim
// runs in, so this file carries no driver import and no Deno import at the type
// level — keeping the handler layer runtime-agnostic and unit-testable via
// withAuth directly (serveAuthed itself is the untested glue).
import { withAuth, defaultDeps, type AuthedHandler, type WithAuthDeps } from './withAuth.js';
import type { Sql } from './executor.js';

// The runtime's request server (Deno.serve / std http serve). Injected so this
// module never hard-imports a Deno global at type-check time.
export type Serve = (handler: (req: Request) => Promise<Response>) => void;

// Wire a handler to a request server with explicit deps. This is the testable
// core; the zero-config `serveAuthed` below builds prod deps + finds `serve`.
export function serveWith(handler: AuthedHandler, deps: WithAuthDeps, serve: Serve): void {
  serve(withAuth(handler, deps));
}

function runtimeServe(): Serve {
  const serve = (globalThis as { Deno?: { serve: Serve } }).Deno?.serve;
  if (!serve) throw new Error('no runtime serve() available (expected Deno.serve)');
  return serve;
}

// The zero-config entrypoint a Deno shim calls: `serveAuthed(handler, sql)`. It
// builds production deps (JWKS verifier + per-request app_user executor over the
// injected pool) and registers the wrapped handler on the runtime server. The
// `sql` pool binding is supplied by the deploy-time shim (which owns the concrete
// Deno-postgres import); this core stays runtime-agnostic and driver-free.
export function serveAuthed(handler: AuthedHandler, sql: Sql): void {
  serveWith(handler, defaultDeps(sql), runtimeServe());
}
