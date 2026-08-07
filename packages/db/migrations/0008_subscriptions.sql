-- UP Migration
-- subscriptions: the money table. A tenant can READ its own row but can NEVER
-- grant itself entitlement: there is a SELECT policy ONLY (no insert/update/delete
-- policy) and app_user gets GRANT SELECT ONLY. The sole writer is
-- revenuecat-webhook running as service_role (RLS-exempt). Columns follow docs/06
-- §3 (authoritative): the minimal set — a second representation of "is she
-- entitled" invites drift on the money path, so status/product_id are cut.
-- user_id is the PK (one row per user).

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id             uuid PRIMARY KEY,
  rc_app_user_id      text,
  entitlement_active  boolean NOT NULL DEFAULT false,
  event_ts            timestamptz,
  expires_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

-- SELECT-only for app_user. No insert/update/delete policy ⇒ a client granting
-- itself entitlement is structurally unrepresentable.
CREATE POLICY subscriptions_select_own ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT ON public.subscriptions TO app_user;

-- DOWN Migration
DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
REVOKE SELECT ON public.subscriptions FROM app_user;
DROP TABLE IF EXISTS public.subscriptions;
