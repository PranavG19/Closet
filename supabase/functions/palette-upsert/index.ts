// Route: POST /palette-upsert — upsert the caller's self-identified palette.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { upsertPalette } from '@closet/functions/palette/upsert-palette.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(upsertPalette, makePool('DATABASE_URL'));
