// Route: GET /palette-read — read the caller's self-identified palette (the daily
// suggestion's advisory colour tie-break reads it). Reads palette_profile.hues under RLS
// as app_user (SELECT-only grant), so a caller only ever sees its own row; an absent row
// returns { hues: [] } (no palette signal), never a 404.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines the read to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { readPalette } from '@closet/functions/palette/read-palette.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(readPalette, makePool('DATABASE_URL'));
