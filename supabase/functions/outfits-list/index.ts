// Route: GET/POST /outfits-list — list the caller's outfits.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { listOutfits } from '@closet/functions/outfits/list.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(listOutfits, makePool('DATABASE_URL'));
