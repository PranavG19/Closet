// Route: POST /wear-log — log a wear event for one of the caller's items.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { logWear } from '@closet/functions/wear-log/log-wear.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(logWear, makePool('DATABASE_URL'));
