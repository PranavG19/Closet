// Route: POST /revenuecat-webhook — RevenueCat server-to-server entitlement events.
// Pool role: service_role (SUPABASE_DB_SERVICE_URL). This is the SOLE writer of the
//            money table; makeServiceExecutor issues NO `SET LOCAL ROLE`, so the
//            pool's OWN identity must be the RLS-exempt service_role that can write
//            subscriptions + the ledger (app_user has no grant there).
// Auth: NOT JWT — a shared secret (REVENUECAT_WEBHOOK_SECRET), compared in constant
//       time inside the handler. So this function is deployed with verify_jwt=false
//       (config.toml) and calls Deno.serve(revenueCatWebhook(sql)) directly, NOT
//       serveAuthed (there is no end-user JWT in a webhook request).
// Env: SUPABASE_DB_SERVICE_URL (service_role pg connection string),
//      REVENUECAT_WEBHOOK_SECRET (shared secret; read by defaultWebhookDeps).
import { revenueCatWebhook } from '@closet/functions/billing/revenuecat-webhook.js';
import { makePool } from '../_shared/pool.ts';

const serve = (globalThis as { Deno: { serve: (h: (req: Request) => Promise<Response>) => void } }).Deno
  .serve;

serve(revenueCatWebhook(makePool('SUPABASE_DB_SERVICE_URL')));
