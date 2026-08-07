// Route: POST /account-export — the caller's full data export (GDPR Art. 15 /
// CCPA right of access). Returns ONE JSON document of every row the caller owns
// across the six user-facing tenant tables plus their money row. Read-only.
// Storage BYTES (photos + cutouts) are NOT in the body — it carries their PATHS;
// the client fetches the objects with its own Storage-scoped token.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines the export to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { exportData } from '@closet/functions/account/export-data.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(exportData, makePool('DATABASE_URL'));
