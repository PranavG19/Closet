// Route: POST /parse-photo — enqueue/parse an uploaded (user-approved) photo.
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so RLS confines rows to the caller.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify),
//      OPENAI_API_KEY, PHOTOROOM_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
//
// STATUS: parsePhoto is bound to `makeProviderPorts` — the REAL GPT-4o vision and
// Photoroom cutout adapters, the latter wired to the real Supabase Storage writer.
// The cutout is uploaded under the CALLER'S OWN JWT (never service_role) to
// `cutouts/{user_id}/{parse_job_id}/cutout.png`, so migration 0013's Storage RLS
// predicate `(storage.foldername(name))[1] = auth.uid()::text` is genuinely
// evaluated. A missing key, a vendor fault, or an RLS refusal throws and surfaces as
// the req-9 502 (markFailed + parse_provider_failed) — never a fabricated cutout.
// Deploying this route requires the two provider keys AND the private `cutouts`
// bucket to exist (0013 creates the policies; the bucket must exist in the project).
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { parsePhoto } from '@closet/functions/parse/parse-photo.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(parsePhoto, makePool('DATABASE_URL'));
