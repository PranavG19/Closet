// Independent oracle for the data-export endpoint (GDPR Art. 15 / CCPA access).
// Runs against real Postgres with the FULL migration chain and RLS FORCE in effect;
// the handler goes through the REAL withAuth, so every export statement executes as
// app_user with request.jwt.claim.sub bound (the container superuser bypasses RLS,
// so it is used ONLY as the independent control — never as the path under test).
//
// The response body is never its own oracle. Completeness is graded against
// independent SUPERUSER SELECTs taken outside the export's transaction: the
// superuser sees ALL rows of both tenants, so it can prove both directions at once —
// that nothing of A's was dropped, and that nothing of B's was included.
//
// The two failure modes this endpoint has are asymmetric and both graded here:
//   - a MISSING table => an incomplete subject-access response (regulatory failure);
//   - an EXTRA tenant's row => a data breach (the more severe of the two).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { exportData, ExportDocument } from '../src/account/export-data.js';
import { parseBoundarySafe } from '@closet/shared';
import {
  applyMigrations,
  makeCaller,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type Caller,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
// A user that is seeded with NOTHING — the empty-account case.
const USER_EMPTY = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';

// The six user-facing tenant tables the export must cover. Named so a per-table
// assertion loop reports WHICH table an incomplete export dropped.
const ROW_TABLES = [
  'wardrobe_items',
  'parse_jobs',
  'outfits',
  'outfit_items',
  'wear_log',
] as const;
type RowTable = (typeof ROW_TABLES)[number];

// Ids of everything a seed created, per user, so the oracle can compare by id and
// not merely by count (equal counts with swapped rows would pass a count-only test).
interface SeedIds {
  readonly parseJobId: string;
  readonly itemIds: readonly string[];
  readonly outfitId: string;
  readonly outfitItemIds: readonly string[];
  readonly wearLogId: string;
}

// Seeds are written through the TENANT executor (app_user under RLS), independent of
// the code under test — except subscriptions, which app_user has SELECT-only on, so
// the money row must come from the superuser/service_role seam. That refusal is
// itself part of the schema's design and is asserted below.
// The userId doubles as the fixture label so every seeded string is per-tenant
// unique AND directly derivable in the assertions (a mismatched label would make a
// leak assertion silently vacuous).
async function seedUser(exec: QueryExecutor, userId: string): Promise<SeedIds> {
  const label = userId;
  const job = await exec.query<{ id: string }>(
    `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
     VALUES ($1, $2, $3, 'full') RETURNING id`,
    [userId, `hash-${label}`, `photos/${label}/original.jpg`],
  );
  const parseJobId = job.rows[0]!.id;

  // phash is a bigint deliberately BEYOND Number.MAX_SAFE_INTEGER so a lossy
  // numeric round-trip in the export projection would be detectable.
  const items = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items
       (user_id, category, color, pattern, attributes, cutout_path, parse_job_id, phash)
     VALUES
       ($1,'top',   'blue', 'solid',  '{"fabric":"cotton"}'::jsonb, $2, $4, 9007199254740993),
       ($1,'bottom','black', NULL,    NULL,                         $3, $4, NULL)
     RETURNING id`,
    [
      userId,
      `cutouts/${label}/top.png`,
      `cutouts/${label}/bottom.png`,
      parseJobId,
    ],
  );
  const itemIds = items.rows.map((r) => r.id);

  const outfit = await exec.query<{ id: string }>(
    `INSERT INTO public.outfits (user_id, name) VALUES ($1, $2) RETURNING id`,
    [userId, `outfit-${label}`],
  );
  const outfitId = outfit.rows[0]!.id;

  const outfitItems = await exec.query<{ id: string }>(
    `INSERT INTO public.outfit_items (user_id, outfit_id, item_id, slot, position)
     VALUES ($1,$2,$3,'top',1), ($1,$2,$4,'bottom',2)
     RETURNING id`,
    [userId, outfitId, itemIds[0], itemIds[1]],
  );
  const outfitItemIds = outfitItems.rows.map((r) => r.id);

  const wear = await exec.query<{ id: string }>(
    `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId, itemIds[0], outfitId, `client-${label}`],
  );
  const wearLogId = wear.rows[0]!.id;

  await exec.query(
    `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1, $2)`,
    [userId, JSON.stringify([`hue-${label}`])],
  );

  return { parseJobId, itemIds, outfitId, outfitItemIds, wearLogId };
}

interface Document {
  exported_at: string;
  user_id: string;
  wardrobe_items: { id: string; phash: string | null; created_at: string }[];
  parse_jobs: { id: string; source_photo_path: string; created_at: string }[];
  outfits: { id: string; name: string | null }[];
  outfit_items: { id: string; item_id: string }[];
  wear_log: { id: string; worn_at: string }[];
  palette_profile: { user_id: string; hues: unknown } | null;
  subscription: { user_id: string; entitlement_active: boolean } | null;
}

// Every id the document contains, flattened — used for the leak assertion.
function allIds(doc: Document): string[] {
  return [
    ...doc.wardrobe_items.map((r) => r.id),
    ...doc.parse_jobs.map((r) => r.id),
    ...doc.outfits.map((r) => r.id),
    ...doc.outfit_items.map((r) => r.id),
    ...doc.wear_log.map((r) => r.id),
  ];
}

describe('account data export — completeness, tenant isolation, schema validity', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let callerEmpty: Caller;
  let superuser: QueryExecutor;
  let seedA: SeedIds;
  let seedB: SeedIds;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    callerEmpty = makeCaller(pool, USER_EMPTY);
    superuser = makeSuperuserExecutor(pool);

    seedA = await seedUser(makeTenantExecutor(pool, USER_A), USER_A);
    seedB = await seedUser(makeTenantExecutor(pool, USER_B), USER_B);

    // Money rows: app_user has SELECT-only on subscriptions, so these MUST come from
    // the service_role/superuser seam. Both users get one so the export cannot pass
    // the isolation check merely because B has no money row.
    await superuser.query(
      `INSERT INTO public.subscriptions
         (user_id, rc_app_user_id, entitlement_active, event_ts, expires_at)
       VALUES ($1,'rc_a', true,  now(), '2099-01-01T00:00:00Z'),
              ($2,'rc_b', false, now(), NULL)`,
      [USER_A, USER_B],
    );
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('control: the seed actually landed and app_user CANNOT write the money table', async () => {
    // If this control were wrong (e.g. the seed silently no-op'd), a "complete"
    // export of nothing would look green. Grade the fixture before grading the code.
    for (const table of ROW_TABLES) {
      const { rows } = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
        [USER_A],
      );
      expect(rows[0]?.n, `seed missing rows in ${table}`).not.toBe('0');
    }
    // The money row is unreachable to app_user for WRITE — proving the seed had to
    // use the superuser seam, i.e. the export reads a table it can never author.
    await expect(
      makeTenantExecutor(pool, USER_A).query(
        `UPDATE public.subscriptions SET entitlement_active = true WHERE user_id = $1`,
        [USER_A],
      ),
    ).rejects.toThrow();
  });

  it('COMPLETENESS: every seeded row of A appears, graded per table against superuser SELECTs', async () => {
    const res = await callerA.call(exportData);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Document;

    // Per-table: the export's id set must EQUAL the superuser's id set for A. A
    // missing table is an incomplete GDPR response, so each table is its own claim.
    for (const table of ROW_TABLES) {
      const { rows } = await superuser.query<{ id: string }>(
        `SELECT id FROM public.${table} WHERE user_id = $1`,
        [USER_A],
      );
      const expected = rows.map((r) => r.id).sort();
      const actual = (doc[table as RowTable] as { id: string }[]).map((r) => r.id).sort();
      expect(actual, `export dropped rows from ${table}`).toEqual(expected);
      expect(actual.length, `${table} exported empty`).toBeGreaterThan(0);
    }

    // The 1:1 tables are not id-keyed; assert them explicitly so neither can be
    // silently omitted (a null palette/subscription for a seeded user = incomplete).
    expect(doc.palette_profile).not.toBeNull();
    expect(doc.palette_profile?.hues).toEqual([`hue-${USER_A}`]);
    expect(doc.subscription).not.toBeNull();
    expect(doc.subscription?.entitlement_active).toBe(true);

    // Named-id spot checks: the specific rows the seed created, by identity.
    expect(doc.parse_jobs.map((r) => r.id)).toContain(seedA.parseJobId);
    expect(doc.wardrobe_items.map((r) => r.id).sort()).toEqual([...seedA.itemIds].sort());
    expect(doc.outfits.map((r) => r.id)).toEqual([seedA.outfitId]);
    expect(doc.outfit_items.map((r) => r.id).sort()).toEqual([...seedA.outfitItemIds].sort());
    expect(doc.wear_log.map((r) => r.id)).toEqual([seedA.wearLogId]);

    // Storage PATHS are present (the documented limitation is that the BYTES are not).
    expect(doc.parse_jobs[0]?.source_photo_path).toBe(`photos/${USER_A}/original.jpg`);
    const cutouts = doc.wardrobe_items
      .map((r) => (r as { cutout_path: string | null }).cutout_path)
      .filter((p): p is string => p !== null)
      .sort();
    expect(cutouts).toEqual([
      `cutouts/${USER_A}/bottom.png`,
      `cutouts/${USER_A}/top.png`,
    ]);
  });

  it('TENANT ISOLATION: A export contains ZERO rows belonging to B (breach check)', async () => {
    const res = await callerA.call(exportData);
    const doc = (await res.json()) as Document;

    // Collect EVERY id B owns, from the superuser vantage (which sees both tenants).
    const bIds = new Set<string>();
    for (const table of ROW_TABLES) {
      const { rows } = await superuser.query<{ id: string }>(
        `SELECT id FROM public.${table} WHERE user_id = $1`,
        [USER_B],
      );
      for (const row of rows) bIds.add(row.id);
    }
    expect(bIds.size, 'B fixture empty — isolation check would be vacuous').toBeGreaterThan(0);

    const leaked = allIds(doc).filter((id) => bIds.has(id));
    expect(leaked, 'export leaked another tenant rows').toEqual([]);

    // Named-id form of the same claim, plus every row's user_id must be A's.
    expect(allIds(doc)).not.toContain(seedB.parseJobId);
    expect(allIds(doc)).not.toContain(seedB.outfitId);
    expect(allIds(doc)).not.toContain(seedB.wearLogId);
    for (const id of seedB.itemIds) expect(allIds(doc)).not.toContain(id);

    const userIds = new Set([
      ...doc.wardrobe_items.map((r) => (r as { user_id: string }).user_id),
      ...doc.parse_jobs.map((r) => (r as { user_id: string }).user_id),
      ...doc.outfits.map((r) => (r as { user_id: string }).user_id),
      ...doc.outfit_items.map((r) => (r as { user_id: string }).user_id),
      ...doc.wear_log.map((r) => (r as { user_id: string }).user_id),
    ]);
    expect([...userIds]).toEqual([USER_A]);
    expect(doc.user_id).toBe(USER_A);
    expect(doc.palette_profile?.user_id).toBe(USER_A);
    expect(doc.subscription?.user_id).toBe(USER_A);
    // B's palette hue string must appear NOWHERE in the serialized document — a
    // whole-body substring scan, which catches a leak into any field, not just ids.
    expect(JSON.stringify(doc)).not.toContain(`hue-${USER_B}`);
    expect(JSON.stringify(doc)).not.toContain('rc_b');
  });

  it('ISOLATION IS STRUCTURAL: an UNFILTERED read as app_user still returns only A', async () => {
    // The repo's `user_id = $1` predicate is belt-and-braces; the actual boundary is
    // RLS FORCE. This runs the export's tables with NO user predicate at all under
    // the tenant executor, so if RLS were ever disabled/loosened on any of the six
    // tables (or the export ran with an elevated role), B's rows would appear HERE
    // even though the repo's own predicate would still hide them. That makes the
    // isolation guarantee independent of the repo's SQL, and this test non-vacuous.
    const execA = makeTenantExecutor(pool, USER_A);
    for (const table of ROW_TABLES) {
      const { rows } = await execA.query<{ user_id: string }>(
        `SELECT user_id FROM public.${table}`,
      );
      expect(rows.length, `${table} unfiltered read saw nothing — RLS check vacuous`).toBeGreaterThan(0);
      expect([...new Set(rows.map((r) => r.user_id))], `RLS not scoping ${table}`).toEqual([USER_A]);
    }
    // Same for the two 1:1 tables (money table included — SELECT-only, still scoped).
    const palette = await execA.query<{ user_id: string }>(
      `SELECT user_id FROM public.palette_profile`,
    );
    expect(palette.rows.map((r) => r.user_id)).toEqual([USER_A]);
    const subs = await execA.query<{ user_id: string }>(
      `SELECT user_id FROM public.subscriptions`,
    );
    expect(subs.rows.map((r) => r.user_id)).toEqual([USER_A]);
    // The superuser control proves B's rows DO exist and were withheld by RLS, not
    // simply absent from the database.
    const allUsers = await superuser.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM public.subscriptions`,
    );
    expect(allUsers.rows.map((r) => r.user_id).sort()).toEqual([USER_A, USER_B].sort());
  });

  it('SCHEMA VALIDITY: the whole payload round-trips through the composed schema', async () => {
    const res = await callerA.call(exportData);
    const raw: unknown = await res.json();

    // Parse the wire body (not the in-process object) back through the schema — an
    // independent re-parse of what the client actually receives.
    const parsed = parseBoundarySafe(ExportDocument, raw, 'oracle.export');
    if (!parsed.ok) throw new Error(`export failed its own schema: ${JSON.stringify(parsed.error.issues)}`);

    const doc = raw as Document;
    // No raw timestamptz rendering: a space separator, or a "+00" offset instead of
    // "Z", is exactly what an un-projected timestamptz looks like.
    const stamps = [
      doc.exported_at,
      ...doc.wardrobe_items.map((r) => r.created_at),
      ...doc.parse_jobs.map((r) => r.created_at),
      ...doc.wear_log.map((r) => r.worn_at),
    ];
    for (const stamp of stamps) {
      expect(stamp).not.toContain(' ');
      expect(stamp).toMatch(/T.*Z$/);
    }

    // bigint phash survives as a STRING with full precision. 9007199254740993 is
    // MAX_SAFE_INTEGER+2; if it had gone through a JS number it would read
    // ...992 or ...994. Compare against the superuser's own ::text rendering.
    const withPhash = doc.wardrobe_items.find((r) => r.phash !== null);
    expect(withPhash, 'no phash row in export').toBeDefined();
    expect(typeof withPhash!.phash).toBe('string');
    const { rows } = await superuser.query<{ phash: string }>(
      `SELECT phash::text AS phash FROM public.wardrobe_items WHERE id = $1`,
      [withPhash!.id],
    );
    expect(withPhash!.phash).toBe(rows[0]?.phash);
    expect(withPhash!.phash).toBe('9007199254740993');
  });

  it('EMPTY ACCOUNT: a brand-new user exports 200 with empty arrays and nulls', async () => {
    const res = await callerEmpty.call(exportData);
    expect(res.status).toBe(200);
    const raw: unknown = await res.json();
    // Must still satisfy the schema — an empty export is a valid export, not a 500.
    const parsed = parseBoundarySafe(ExportDocument, raw, 'oracle.export.empty');
    if (!parsed.ok) throw new Error(`empty export failed schema: ${JSON.stringify(parsed.error.issues)}`);

    const doc = raw as Document;
    expect(doc.user_id).toBe(USER_EMPTY);
    for (const table of ROW_TABLES) {
      expect(doc[table as RowTable], `${table} should be []`).toEqual([]);
    }
    // 1:1 tables are explicit nulls, and the KEYS are present (an omitted key would
    // make a client's "did I get everything?" check ambiguous).
    expect(doc.palette_profile).toBeNull();
    expect(doc.subscription).toBeNull();
    expect(Object.keys(doc)).toContain('palette_profile');
    expect(Object.keys(doc)).toContain('subscription');
  });
});
