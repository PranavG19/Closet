// Tier-2 adversarial cross-tenant isolation matrix (docs/05 Tier-2), purely at the
// repo/DB seam. The attacker is a FULLY VALID authenticated tenant B (a real
// app_user context with request.jwt.claim.sub=B) that simply NAMES rows owned by A
// — nothing forged. Every one of the 7 tenant tables is covered for BOTH read and
// write isolation, and the two composite-FK child tables get the stronger
// "unrepresentable, not merely detected" proof (a cross-owner reference raises
// 23503 at write time — no such parent row can exist).
//
// The response is NEVER the oracle: read isolation asserts B's own RLS-scoped
// SELECT returns 0 WHILE a superuser (RLS-exempt) count confirms A's rows exist
// (the 0 is isolation, not an empty table); write isolation asserts the statement
// throws AND an independent superuser count shows nothing landed; and after every
// probe a superuser cross-owner join (child.user_id <> parent.user_id) counts 0.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

// The 7 tenant tables (RLS FORCE, keyed on auth.uid()=user_id). subscriptions is
// the money table (SELECT-only for app_user). webhook_events is NOT a tenant table
// (no app_user policy/grant at all) and is probed separately below.
const TENANT_TABLES = [
  'wardrobe_items',
  'parse_jobs',
  'outfits',
  'outfit_items',
  'wear_log',
  'palette_profile',
  'subscriptions',
] as const;

describe('cross-tenant isolation matrix — all 7 tenant tables, read + write', () => {
  let harness: PgHarness;
  let pool: Pool;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  // Ids seeded for A, used by the read-isolation and composite-FK probes.
  let aOutfitId = '';
  let aItemId = '';

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);

    // Seed exactly one A-owned row in every tenant table (as the owner where a
    // policy allows it; as service_role/superuser for the write-locked money table).
    aItemId = (
      await execA.query<{ id: string }>(
        `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
        [USER_A],
      )
    ).rows[0]!.id;
    aOutfitId = (
      await execA.query<{ id: string }>(
        `INSERT INTO public.outfits (user_id, name) VALUES ($1,'A-outfit') RETURNING id`,
        [USER_A],
      )
    ).rows[0]!.id;
    await execA.query(
      `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind)
       VALUES ($1,'A-HASH','a/p.jpg','teaser')`,
      [USER_A],
    );
    await execA.query(
      `INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`,
      [USER_A, aOutfitId, aItemId],
    );
    await execA.query(
      `INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'A-wear')`,
      [USER_A, aItemId],
    );
    await execA.query(`INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,'{"warm":true}'::jsonb)`, [USER_A]);
    // Money table: app_user has no INSERT policy, so the webhook's service_role path
    // (== the RLS-exempt superuser here) is the only writer.
    await superuser.query(
      `INSERT INTO public.subscriptions (user_id, entitlement_active, rc_app_user_id) VALUES ($1,true,'rc_a')`,
      [USER_A],
    );
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // ---- READ isolation: B sees 0 of A's rows in every tenant table --------------
  // The superuser count proves the rows exist (isolation, not an empty table).
  it.each(TENANT_TABLES)('read isolation — B sees 0 rows of A in %s (superuser confirms A has rows)', async (table) => {
    const superCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
      [USER_A],
    );
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);

    const bView = await execB.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`, [
      USER_A,
    ]);
    expect(Number(bView.rows[0]?.n)).toBe(0);
  });

  // ---- WRITE isolation: B cannot INSERT a row owned by A -----------------------
  // Each write names user_id=A from B's context; RLS WITH CHECK (auth.uid()=user_id)
  // refuses it (and for the money table there is no INSERT policy/grant at all). The
  // statement throws AND a superuser count confirms nothing new for A landed.
  const OWNER_INSERTS: Record<(typeof TENANT_TABLES)[number], string> = {
    wardrobe_items: `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top')`,
    parse_jobs: `INSERT INTO public.parse_jobs (user_id, source_photo_hash, source_photo_path, kind) VALUES ($1,'B-INJECT','b/x.jpg','teaser')`,
    outfits: `INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-injected-into-A')`,
    outfit_items: `INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`,
    wear_log: `INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'B-INJECT')`,
    palette_profile: `INSERT INTO public.palette_profile (user_id, hues) VALUES ($1,'{"hacked":true}'::jsonb)`,
    subscriptions: `INSERT INTO public.subscriptions (user_id, entitlement_active) VALUES ($1,true)`,
  };

  it.each(TENANT_TABLES)('write isolation — B cannot INSERT a row owned by A in %s', async (table) => {
    const before = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
      [USER_A],
    );

    const sql = OWNER_INSERTS[table];
    // outfit_items / wear_log reference A's parent rows too; pass those params.
    const params =
      table === 'outfit_items'
        ? [USER_A, aOutfitId, aItemId]
        : table === 'wear_log'
          ? [USER_A, aItemId]
          : [USER_A];
    await expect(execB.query(sql, params)).rejects.toThrow();

    // Independent oracle: A's row count is unchanged — nothing B named landed.
    const after = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${table} WHERE user_id = $1`,
      [USER_A],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  // ---- Composite-FK: the cross-owner child write is UNREPRESENTABLE ------------
  // B builds a row it IS allowed to own (user_id=B satisfies RLS WITH CHECK) but
  // points the FK at A's parent. No parent row (B, A's id) exists, so the composite
  // FK raises 23503 — the reference cannot be expressed, not merely policy-denied.
  it('outfit_items — B naming A wardrobe item as a member of B own outfit → 23503 (unrepresentable)', async () => {
    const bOutfit = (
      await execB.query<{ id: string }>(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-own') RETURNING id`, [
        USER_B,
      ])
    ).rows[0]!.id;
    await expect(
      execB.query(`INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`, [
        USER_B,
        bOutfit,
        aItemId, // A's item — no (B, aItemId) parent exists
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('outfit_items — B naming A outfit as the parent (member = B own item) → 23503 (unrepresentable)', async () => {
    const bItem = (
      await execB.query<{ id: string }>(
        `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
        [USER_B],
      )
    ).rows[0]!.id;
    await expect(
      execB.query(`INSERT INTO public.outfit_items (user_id, outfit_id, item_id) VALUES ($1,$2,$3)`, [
        USER_B,
        aOutfitId, // A's outfit — no (B, aOutfitId) parent exists
        bItem,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('wear_log — B naming A wardrobe item → 23503 (unrepresentable), no row lands', async () => {
    await expect(
      execB.query(`INSERT INTO public.wear_log (user_id, item_id, client_id) VALUES ($1,$2,'B-xt')`, [USER_B, aItemId]),
    ).rejects.toMatchObject({ code: '23503' });
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wear_log WHERE client_id = 'B-xt'`,
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  // ---- webhook_events — opaque to every tenant (system table) ------------------
  it('webhook_events — app_user can neither SELECT nor INSERT (no policy, no grant)', async () => {
    await superuser.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt-xt-seed') ON CONFLICT DO NOTHING`);
    await expect(execB.query(`SELECT event_id FROM public.webhook_events`)).rejects.toThrow();
    await expect(execB.query(`INSERT INTO public.webhook_events (event_id) VALUES ('evt-xt-hack')`)).rejects.toThrow();
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.webhook_events WHERE event_id = 'evt-xt-hack'`,
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  // ---- Global cross-owner-join invariants: exactly 0 in every child table ------
  // The whole point of the composite FKs — no child row can reference a parent owned
  // by a different tenant. This holds by construction; after every probe above it
  // must still be 0 (superuser sees ALL rows, so a leak would show up here).
  it('cross-owner join = 0 — no child references a parent owned by another tenant', async () => {
    const oiOnItem = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.outfit_items oi JOIN public.wardrobe_items w ON oi.item_id = w.id
       WHERE oi.user_id <> w.user_id`,
    );
    expect(oiOnItem.rows[0]?.n).toBe('0');

    const oiOnOutfit = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.outfit_items oi JOIN public.outfits o ON oi.outfit_id = o.id
       WHERE oi.user_id <> o.user_id`,
    );
    expect(oiOnOutfit.rows[0]?.n).toBe('0');

    const wlOnItem = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.wear_log wl JOIN public.wardrobe_items w ON wl.item_id = w.id
       WHERE wl.user_id <> w.user_id`,
    );
    expect(wlOnItem.rows[0]?.n).toBe('0');

    const wiOnJob = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM public.wardrobe_items w JOIN public.parse_jobs pj ON w.parse_job_id = pj.id
       WHERE w.user_id <> pj.user_id`,
    );
    expect(wiOnJob.rows[0]?.n).toBe('0');
  });
});
