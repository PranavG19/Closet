// Route: GET /wear-log-list — the caller's recent wear entries (newest first).
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { listWear } from '@closet/functions/wear-log/list-wear.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(listWear, makePool('DATABASE_URL'));
