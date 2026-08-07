-- UP Migration
-- Storage RLS on storage.objects — the ONLY control preventing cross-user photo
-- byte reads/writes (docs/06 §6). Two PRIVATE buckets, `originals` (approved
-- uploads) and `cutouts` (parse output), path convention {user_id}/{parse_job_id}/{...}
-- so the FIRST path segment is the owner. Each policy pins `bucket_id` (an
-- `originals` policy can never match a `cutouts` object, and vice versa) and binds
-- (storage.foldername(name))[1] = auth.uid()::text. The ::text cast is MANDATORY:
-- auth.uid() is uuid, foldername() returns text; without it the comparison
-- misbehaves. Path obscurity is NEVER the control — this policy is.
--
-- Dual-target (mirrors 0001_substrate): on hosted Supabase the `storage` schema is
-- owned by the platform and already exists, so the bootstrap block is a no-op and
-- we never mutate Supabase-owned objects. On a bare postgres:17 test container
-- `storage.*` does NOT exist, so we fabricate a faithful-enough stand-in
-- (buckets + objects + foldername) so the SAME policy text below is genuinely
-- EXERCISED by the integration oracle (docs/06 §6: "Proof, not by construction").

-- Storage stand-in — created ONLY when `storage` is absent (bare container).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    CREATE SCHEMA storage;

    CREATE TABLE storage.buckets (
      id          text PRIMARY KEY,
      name        text NOT NULL,
      public      boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE storage.objects (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id   text NOT NULL REFERENCES storage.buckets (id),
      name        text NOT NULL,
      owner       uuid,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Faithful to Supabase's own definition: split the path on '/', drop the
    -- trailing filename, return the folder segments as text[]; [1] is the owner.
    CREATE FUNCTION storage.foldername(name text) RETURNS text[]
      LANGUAGE plpgsql IMMUTABLE
      AS $fn$
      DECLARE _parts text[];
      BEGIN
        _parts := string_to_array(name, '/');
        RETURN _parts[1:array_length(_parts, 1) - 1];
      END;
      $fn$;

    -- Enforce RLS on the stand-in so the policies below are REALLY exercised.
    -- On hosted Supabase RLS on storage.objects is already enabled by the
    -- platform (storage.objects is Supabase-owned) so we do not toggle it there.
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- `authenticated` is the role the client-direct Storage path runs under on
-- Supabase (upload originals / download cutouts). Create it idempotently for the
-- bare container so the policies below can target it; on hosted Supabase it
-- already exists (no-op).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA storage TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO app_user, authenticated;

-- The two PRIVATE buckets. Idempotent so up->down->up redo is clean.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('originals', 'originals', false),
  ('cutouts',   'cutouts',   false)
ON CONFLICT (id) DO NOTHING;

-- === The cross-user control. One policy per (bucket × operation), covering read
-- (SELECT) AND write (INSERT/UPDATE/DELETE) on BOTH buckets. Targets BOTH
-- `authenticated` (client-direct upload/download) and `app_user` (parse-photo
-- reads the original / writes the cutout as app_user, never service_role).

-- originals
CREATE POLICY storage_originals_select ON storage.objects
  FOR SELECT TO authenticated, app_user
  USING (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_originals_insert ON storage.objects
  FOR INSERT TO authenticated, app_user
  WITH CHECK (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_originals_update ON storage.objects
  FOR UPDATE TO authenticated, app_user
  USING (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_originals_delete ON storage.objects
  FOR DELETE TO authenticated, app_user
  USING (bucket_id = 'originals' AND (storage.foldername(name))[1] = auth.uid()::text);

-- cutouts
CREATE POLICY storage_cutouts_select ON storage.objects
  FOR SELECT TO authenticated, app_user
  USING (bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_cutouts_insert ON storage.objects
  FOR INSERT TO authenticated, app_user
  WITH CHECK (bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_cutouts_update ON storage.objects
  FOR UPDATE TO authenticated, app_user
  USING (bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_cutouts_delete ON storage.objects
  FOR DELETE TO authenticated, app_user
  USING (bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- DOWN Migration
-- Drop the control in BOTH targets; tear the stand-in fully down ONLY where WE
-- own the storage schema (bare container). Never drop the Supabase-owned schema,
-- table, function, buckets, or the pre-existing `authenticated` role in prod.
-- Two INDEPENDENT conditions must BOTH hold before this branch touches the schema
-- itself: (1) we own it, and (2) it structurally IS our stand-in — Supabase's real
-- storage.objects carries a `path_tokens` column that our stand-in never creates,
-- so its absence is a positive discriminator, not an inference from ownership. A
-- single ownership check is one mis-evaluation away from destroying every user's
-- photo bytes, so it is not trusted alone. Drops are EXPLICIT and named (never
-- `DROP SCHEMA ... CASCADE`, matching 0001_substrate): if this branch is ever
-- reached in error against a real project, an ownership error ABORTS the migration
-- instead of cascading through Supabase-owned objects.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspname = 'storage'
      AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'path_tokens'
  ) THEN
    DROP POLICY IF EXISTS storage_originals_select ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_insert ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_update ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_delete ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_select ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_insert ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_update ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_delete ON storage.objects;
    REVOKE SELECT, INSERT, UPDATE, DELETE ON storage.objects FROM app_user, authenticated;
    REVOKE USAGE ON SCHEMA storage FROM app_user, authenticated;
    DROP FUNCTION IF EXISTS storage.foldername(text);
    DROP TABLE IF EXISTS storage.objects;
    DROP TABLE IF EXISTS storage.buckets;
    DROP SCHEMA IF EXISTS storage;
    -- `authenticated` is dropped ONLY if this migration created it. On hosted
    -- Supabase the role pre-exists and this branch is unreachable; dropping a
    -- platform role would break every client session.
    DROP ROLE IF EXISTS authenticated;
  ELSE
    -- Supabase-owned: drop only the policies and bucket rows we added, and
    -- revoke only the grants we made. Leave the schema/table/role intact.
    DROP POLICY IF EXISTS storage_originals_select ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_insert ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_update ON storage.objects;
    DROP POLICY IF EXISTS storage_originals_delete ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_select ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_insert ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_update ON storage.objects;
    DROP POLICY IF EXISTS storage_cutouts_delete ON storage.objects;
    DELETE FROM storage.buckets WHERE id IN ('originals', 'cutouts');
    REVOKE SELECT, INSERT, UPDATE, DELETE ON storage.objects FROM app_user, authenticated;
    REVOKE USAGE ON SCHEMA storage FROM app_user, authenticated;
  END IF;
END $$;
