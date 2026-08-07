// Route: GET /palette-entitlement — read the caller's entitlement state (the
// paywall + kind='full' gating read it). Reads subscriptions.entitlement_active
// under RLS as app_user (SELECT-only grant), so a caller only ever sees its own row.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines the read to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { readEntitlement } from '@closet/functions/palette/read-entitlement.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(readEntitlement, makePool('DATABASE_URL'));
