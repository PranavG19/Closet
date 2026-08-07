// Route: POST /wardrobe-dedupe — resolve a duplicate-item merge for the caller.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { resolveDedupe } from '@closet/functions/wardrobe/dedupe.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(resolveDedupe, makePool('DATABASE_URL'));
