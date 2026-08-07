// Shared harness for the functions integration oracles. It boots a real Postgres
// (reusing the W1 db helpers unchanged), applies the FULL migration chain, and
// wraps a built AuthedHandler in the REAL withAuth using a fake TokenVerifier
// (the bearer token IS the sub) and the W1 makeTenantExecutor as the per-request
// executor — so every handler call runs as app_user with request.jwt.claim.sub
// set, exercising RLS exactly as production. The container superuser bypasses RLS,
// so a control that must fail as app_user stays meaningful.
import type { Pool } from 'pg';
import { withAuth, type AuthedHandler } from '../../src/auth/withAuth.js';
import { makeTenantExecutor, makeSuperuserExecutor, type QueryExecutor } from '../../../db/test/helpers/executor.js';
import { applyMigrations } from '../../../db/test/helpers/applyMigrations.js';
import { startPg, type PgHarness } from '../../../db/test/helpers/pgContainer.js';

export { applyMigrations, makeTenantExecutor, makeSuperuserExecutor, startPg };
export type { QueryExecutor, PgHarness };

// A caller bound to one verified sub. `call` invokes the handler as that user.
export interface Caller {
  call(handler: AuthedHandler, init?: { body?: unknown; query?: string }): Promise<Response>;
}

// Build a caller for a given userId over the pool. The fake verifier treats the
// bearer token as the already-verified sub (production verifies a real JWT; the
// identity semantics — sub → tenant — are identical).
export function makeCaller(pool: Pool, userId: string): Caller {
  const wrap = (handler: AuthedHandler): ((req: Request) => Promise<Response>) =>
    withAuth(handler, {
      verifier: { verify: async (token: string) => ({ sub: token }) },
      makeExecutor: (verifiedUser: string) => makeTenantExecutor(pool, verifiedUser),
      newCorrelationId: () => 'test-correlation',
    });

  return {
    async call(handler, init) {
      const url = `https://test.local/fn${init?.query ?? ''}`;
      const headers: Record<string, string> = { authorization: `Bearer ${userId}` };
      const reqInit: RequestInit = { method: 'POST', headers };
      if (init?.body !== undefined) {
        reqInit.body = JSON.stringify(init.body);
        headers['content-type'] = 'application/json';
      }
      return wrap(handler)(new Request(url, reqInit));
    },
  };
}
