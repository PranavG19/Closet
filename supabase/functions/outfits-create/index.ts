// Route: POST /outfits-create — create an outfit for the caller.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { createOutfit } from '@closet/functions/outfits/create.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(createOutfit, makePool('DATABASE_URL'));
