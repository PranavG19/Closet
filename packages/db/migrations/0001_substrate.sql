-- UP Migration
-- Substrate applied before every domain migration. Dual-target: fabricates a
-- faithful local `auth` stand-in ONLY on a bare container, no-op on hosted
-- Supabase (where GoTrue owns `auth`). Everything idempotent so up->down->up
-- redo produces a byte-identical schema fingerprint.

-- pgcrypto provides gen_random_uuid(). Shared extension; never dropped on DOWN.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dual-target auth bootstrap. CREATE SCHEMA has no IF NOT EXISTS variant that
-- preserves the owned/unowned distinction the DOWN needs, so gate on absence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  END IF;
END $$;

-- Canonical tenant identity. Defined unconditionally via OR REPLACE so it exists
-- in both targets (stand-in and real Supabase) and stays idempotent. NULLIF maps
-- an empty/unset sub to NULL rather than raising a cast error.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;

-- Shared updated_at trigger function for every domain table.
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$;

-- Least-privilege tenant role. Created idempotently. Domain migrations grant it
-- exactly the DML their policies allow; the substrate grants only schema USAGE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA auth TO app_user;

-- DOWN Migration
-- Reverse in dependent order. Restores a bare container to its pre-migration
-- state but MUST NOT drop the `auth` schema when Supabase owns it (production
-- safety default: if ownership is not us, leave it).

REVOKE USAGE ON SCHEMA public FROM app_user;

-- Drop auth.uid() first, then the stand-in schema/table only when WE own it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspname = 'auth'
      AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    -- Local stand-in owned by the migration role: tear it fully down.
    DROP FUNCTION IF EXISTS auth.uid();
    REVOKE USAGE ON SCHEMA auth FROM app_user;
    DROP TABLE IF EXISTS auth.users;
    DROP SCHEMA IF EXISTS auth;
  ELSE
    -- Supabase-owned (or ownership unresolved): drop only our own function,
    -- never the schema/table we did not create.
    DROP FUNCTION IF EXISTS auth.uid();
    REVOKE USAGE ON SCHEMA auth FROM app_user;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.tg_set_updated_at();

DROP ROLE IF EXISTS app_user;
