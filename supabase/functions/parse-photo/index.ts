// Route: POST /parse-photo — enqueue/parse an uploaded (user-approved) photo.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
//
// STATUS: parsePhoto is currently bound to `unwiredPorts` (the GPT-4o / Photoroom
// provider adapters are NOT wired — they are a SEPARATE task that needs API keys).
// This shim is CORRECT as-is: the handler returns 502 until those adapters land.
// Deploying this route now stands up the auth + DB seam; the parse worker itself is
// inert until the provider-adapter task ships (see functions/README.md).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { parsePhoto } from '@closet/functions/parse/parse-photo.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(parsePhoto, makePool('DATABASE_URL'));
