-- UP Migration
-- webhook_events: the replay/ordering dedup ledger for revenuecat-webhook. It
-- replaces a racy last_event_id column: INSERT ... ON CONFLICT (event_id) DO
-- NOTHING makes dedup ATOMIC (zero rows inserted ⇒ duplicate ⇒ skip). Columns
-- follow docs/06 §3 (authoritative minimal set): event_id text PK + received_at.
-- NOT tenant data: written/read ONLY by service_role. RLS FORCE with NO app_user
-- policy and NO app_user grant ⇒ app_user can neither read nor write it.

CREATE TABLE IF NOT EXISTS public.webhook_events (
  event_id     text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;

-- No policy, no grant for app_user. service_role is RLS-exempt and is the sole
-- reader/writer.

-- DOWN Migration
DROP TABLE IF EXISTS public.webhook_events;
