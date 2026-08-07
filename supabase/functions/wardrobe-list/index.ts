// Route: GET/POST /wardrobe-list — list the caller's wardrobe items (paged).
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { listWardrobe } from '@closet/functions/wardrobe/list.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(listWardrobe, makePool('DATABASE_URL'));
