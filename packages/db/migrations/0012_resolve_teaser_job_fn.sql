-- UP Migration
-- resolve_teaser_job: the idempotent teaser-job create with a HARD per-user cap,
-- as ONE plpgsql function (docs/06 §4 teaser cost cap; CLAUDE.md "atomicity inside
-- ONE statement OR ONE plpgsql function").
--
-- WHY A FUNCTION AND NOT A SINGLE CTE (this is the whole point):
-- The executor runs each query() in its own READ COMMITTED transaction. A single
-- SQL statement takes its MVCC snapshot ONCE, at statement start — BEFORE any
-- pg_advisory_xact_lock taken inside that same statement's CTE is granted. So a CTE
-- of the form `WITH locked AS (SELECT pg_advisory_xact_lock(...)), cnt AS (SELECT
-- count(*) ...) INSERT ... WHERE cnt.n < cap` serializes EXECUTION but not SNAPSHOT
-- VISIBILITY: a second connection blocks on the lock, but when it proceeds its count
-- still reads the pre-lock snapshot, misses the first racer's just-committed insert,
-- and inserts anyway. N concurrent racers each read n=cap-1 and all land → the cap is
-- blown (proven: 12 racers, 1 slot, all 12 inserted).
--
-- In plpgsql under READ COMMITTED each statement below takes a FRESH snapshot. So:
--   1. pg_advisory_xact_lock(user) — held until THIS function's (outer) tx commits.
--   2. count(*) — re-snapshots AFTER the lock is granted, so it sees a prior racer's
--      committed teaser row.
--   3. INSERT — only if under cap.
-- The lock serializes the trio per user_id; the fresh per-statement snapshot makes
-- the count honest. That combination is what a single statement cannot express.
--
-- SECURITY INVOKER (the DEFAULT — NOT definer): this fn touches ONLY the caller's own
-- rows and needs NO RLS bypass (unlike 0011's merge, which must move append-only
-- wear_log rows). It runs as app_user under the caller's request context, so RLS
-- applies normally: the SELECT count sees only the caller's rows, and the INSERT's
-- WITH CHECK (auth.uid() = user_id) rejects a mismatched p_user_id LOUD (42501),
-- never silently. search_path is pinned = '' with every table fully schema-qualified
-- (defense-in-depth + keeps the check-definer-search-path gate satisfied); pg_catalog
-- builtins (pg_advisory_xact_lock, hashtextextended, count) resolve implicitly.
--
-- Returns the resolved job's id (existing photo = idempotent, does NOT count against
-- the cap; new photo under cap = the freshly inserted id). Returns NULL iff a NEW
-- teaser photo hits the cap — the caller reads NULL as cap_reached.

CREATE OR REPLACE FUNCTION public.resolve_teaser_job(
  p_user_id uuid,
  p_hash    text,
  p_path    text,
  p_kind    text,
  p_cap     integer
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $fn$
DECLARE
  v_id    uuid;
  v_count integer;
BEGIN
  -- (1) Serialize count-then-insert per user. Held until the outer tx commits.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Already-submitted photo → idempotent; return its id, do NOT count against cap.
  SELECT id INTO v_id
    FROM public.parse_jobs
   WHERE user_id = p_user_id AND source_photo_hash = p_hash;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- (2) Teaser cap (full skips it entirely). Fresh snapshot post-lock, so this sees
  -- any prior racer's committed teaser row.
  IF p_kind = 'teaser' THEN
    SELECT count(*) INTO v_count
      FROM public.parse_jobs
     WHERE user_id = p_user_id AND kind = 'teaser';
    IF v_count >= p_cap THEN
      RETURN NULL;  -- cap reached: no insert, caller maps NULL → cap_reached
    END IF;
  END IF;

  -- (3) Insert under the lock. ON CONFLICT guards the (still-possible) race where a
  -- concurrent connection inserted the SAME hash between our read and here; if it
  -- swallowed, re-read the winning row so we always return a real id.
  INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
  VALUES (p_user_id, p_hash, p_path, p_kind)
  ON CONFLICT (user_id, source_photo_hash) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.parse_jobs
     WHERE user_id = p_user_id AND source_photo_hash = p_hash;
  END IF;

  RETURN v_id;
END;
$fn$;

-- Default EXECUTE is granted to PUBLIC; narrow it to app_user (the only caller).
REVOKE ALL ON FUNCTION public.resolve_teaser_job(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_teaser_job(uuid, text, text, text, integer) TO app_user;

-- DOWN Migration
REVOKE EXECUTE ON FUNCTION public.resolve_teaser_job(uuid, text, text, text, integer) FROM app_user;
DROP FUNCTION IF EXISTS public.resolve_teaser_job(uuid, text, text, text, integer);
