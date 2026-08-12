// Route: POST /outfits-rename — rename one of the caller's saved outfits.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines the update to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { renameOutfit } from '@closet/functions/outfits/rename.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(renameOutfit, makePool('DATABASE_URL'));
