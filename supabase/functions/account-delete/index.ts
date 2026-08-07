// Route: POST /account-delete — permanently purge the caller's account rows
//        (Apple App Store Review Guideline 5.1.1(v) in-app account deletion).
// Pool role: app_user-capable (DATABASE_URL); makePgExecutor drops to app_user per
//            tx and binds the verified sub, so the SECURITY DEFINER
//            public.delete_my_account() resolves auth.uid() to the caller and can
//            only ever erase the caller's own rows.
// Env: DATABASE_URL (pg connection string), JWKS_URL (asymmetric JWT verify).
// NOT covered here (service_role, deploy-wired): the Storage bytes in the
// originals/cutouts buckets and the Supabase auth.users identity record. A
// user-JWT function has no authority over either — see migration 0014's header.
import { serveAuthed } from '@closet/functions/auth/serveAuthed.js';
import { deleteAccount } from '@closet/functions/account/delete-account.js';
import { makePool } from '../_shared/pool.ts';

serveAuthed(deleteAccount, makePool('DATABASE_URL'));
