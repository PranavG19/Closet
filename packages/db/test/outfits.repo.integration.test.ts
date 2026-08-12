// Independent oracle for makeOutfitsRepo (task-09b + task-11 createWithItems).
// Idempotent create (D-001: ON CONFLICT (user_id,id)), cross-tenant isolation,
// composite-FK unrepresentability, as app_user against real PG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { OutfitRow, OutfitSummary, OUTFIT_PREVIEW_LIMIT } from '@closet/shared';
import { makeOutfitsRepo } from '../src/repos/outfits.repo.js';
import { makeWardrobeRepo } from '../src/repos/wardrobe.repo.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeSuperuserExecutor, makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';
import { expectRlsDenies } from './helpers/rls-oracle.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const USER_C = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';

describe('makeOutfitsRepo — idempotent create + isolation', () => {
  let harness: PgHarness;
  let pool: Pool;
  let execA: QueryExecutor;
  let execB: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    execA = makeTenantExecutor(pool, USER_A);
    execB = makeTenantExecutor(pool, USER_B);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('createWithItems round-trips + matches OutfitRow', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfit = await makeOutfitsRepo(execA).createWithItems(USER_A, {
      name: 'Monday',
      items: [{ item_id: item.id, slot: 'top', position: 0 }],
    });
    expect(() => OutfitRow.parse(outfit)).not.toThrow();
    const members = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfit.id],
    );
    expect(members.rows[0]?.n).toBe('1');
  });

  it('idempotent create with client-minted id — retry yields exactly one row (differential)', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'dress' });
    const outfitId = 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5';
    const repo = makeOutfitsRepo(execA);
    const first = await repo.createWithItems(USER_A, {
      id: outfitId,
      name: 'Fixed',
      items: [{ item_id: item.id }],
    });
    const retry = await repo.createWithItems(USER_A, {
      id: outfitId,
      name: 'Fixed',
      items: [{ item_id: item.id }],
    });
    expect(first.id).toBe(outfitId);
    expect(retry.id).toBe(outfitId);
    // Exactly one outfit row and one member (retry re-inserted nothing).
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(outfitCount.rows[0]?.n).toBe('1');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberCount.rows[0]?.n).toBe('1');
  });

  it('CONCURRENT duplicate create — loser reads the winner row, never 500s (READ COMMITTED race)', async () => {
    // The sequential-retry test above passes because `first` commits in its own
    // transaction before `retry` runs, so the retry's snapshot sees it. This test
    // forces the TRULY-SIMULTANEOUS case the old in-statement UNION-ALL fallback got
    // wrong: the loser's CTE statement snapshot is fixed BEFORE the winner commits, so
    // a same-statement `SELECT ... WHERE NOT EXISTS(ins_outfit)` sees zero rows and the
    // repo 500s with 'returned no row'. Fire-drilled: reverting the fresh-query fix
    // makes this reject (verified against the pre-fix repo on this container).
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfitId = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';

    // A held-client executor: the TEST owns the transaction (BEGIN / COMMIT), so the
    // winner can stay open while the loser's statement starts and blocks on the lock.
    // Each exec.query is a new COMMAND on the same client, which under READ COMMITTED
    // takes a fresh snapshot — exactly what the production per-query() transaction does.
    const heldExec = async (): Promise<{ exec: QueryExecutor; commit: () => Promise<void>; release: () => void }> => {
      const client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', USER_A]);
      return {
        exec: { query: async (sql, params) => client.query(sql, params ? [...params] : undefined) },
        commit: async () => void (await client.query('COMMIT')),
        release: () => client.release(),
      };
    };
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    const winner = await heldExec();
    const loser = await heldExec();
    try {
      const args = { id: outfitId, name: 'Race', items: [{ item_id: item.id }] };
      // Winner inserts and RETURNs the row, but its transaction stays OPEN (holds the
      // unique-key lock on outfitId).
      const winnerRow = await makeOutfitsRepo(winner.exec).createWithItems(USER_A, args);
      expect(winnerRow.id).toBe(outfitId);

      // Loser fires the same create; its ins_outfit INSERT blocks on the winner's lock.
      // Do NOT await yet — let it reach the lock-wait with its snapshot already taken.
      const loserPromise = makeOutfitsRepo(loser.exec).createWithItems(USER_A, args);
      await sleep(250);

      // Winner commits → loser's INSERT unblocks as ON CONFLICT DO NOTHING (no row),
      // and the committed outfit is NOT visible in the loser's CTE-statement snapshot.
      await winner.commit();

      // The fix: on the empty CTE result the repo issues a FRESH command whose new
      // snapshot sees the committed row. Old code returned nothing here and threw.
      const loserRow = await loserPromise;
      await loser.commit();
      expect(loserRow.id).toBe(outfitId);
      expect(loserRow.name).toBe('Race');
    } finally {
      winner.release();
      loser.release();
    }

    // Exactly one outfit and one member survived the race (idempotent, no duplicate).
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(outfitCount.rows[0]?.n).toBe('1');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberCount.rows[0]?.n).toBe('1');
  });

  it('cross-tenant item_id in createWithItems raises FK 23503 (unrepresentable)', async () => {
    const bItem = await makeWardrobeRepo(execB).create(USER_B, { category: 'top' });
    // A names B's item under A's user_id: no wardrobe_items(A, bItem.id) parent.
    await expect(
      makeOutfitsRepo(execA).createWithItems(USER_A, {
        name: 'bad',
        items: [{ item_id: bItem.id }],
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  // RENAMED + STRENGTHENED. Both listByUser calls pass the READER'S OWN id, which is
  // what lands in the repo's `WHERE user_id = $1` — so both 0-row results came from the
  // repo predicate, not from a policy, and this stayed green with outfits_select_own
  // widened to USING (true). The two original assertions are kept (they do prove
  // listByUser returns only the requested tenant's rows), and the RLS claim is now
  // measured by an unfiltered probe that is fire-drilled on this container.
  it('B/C listByUser returns none of A outfits (repo predicate) + RLS denies unfiltered', async () => {
    await makeOutfitsRepo(execA).createWithItems(USER_A, { name: 'A-only', items: [] });
    const bList = await makeOutfitsRepo(execB).listByUser(USER_B);
    expect(bList.some((r) => r.name === 'A-only')).toBe(false);
    const superCount = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits`);
    expect(Number(superCount.rows[0]?.n)).toBeGreaterThan(0);
    const execC = makeTenantExecutor(pool, USER_C);
    const cList = await makeOutfitsRepo(execC).listByUser(USER_C);
    expect(cList.length).toBe(0);
    await expectRlsDenies(superuser, execB, 'outfits', USER_A);
    await expectRlsDenies(superuser, execC, 'outfits', USER_A);
  });

  // Independent oracle for listWithCounts. The count is graded against a superuser COUNT(*)
  // over outfit_items — a source the repo query did not produce — not a number I copied from
  // the repo. A zero-member outfit must still appear (LEFT JOIN), with count 0.
  it('listWithCounts reports each outfit\'s real member count (0-member outfit still listed)', async () => {
    const user = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    const exec = makeTenantExecutor(pool, user);
    const wardrobe = makeWardrobeRepo(exec);
    const repo = makeOutfitsRepo(exec);

    const i1 = await wardrobe.create(user, { category: 'top' });
    const i2 = await wardrobe.create(user, { category: 'bottom' });
    const i3 = await wardrobe.create(user, { category: 'shoes' });

    // A 3-member outfit, a 1-member outfit, and a 0-member outfit.
    const three = await repo.createWithItems(user, {
      name: 'Full',
      items: [{ item_id: i1.id }, { item_id: i2.id }, { item_id: i3.id }],
    });
    const one = await repo.createWithItems(user, { name: 'Single', items: [{ item_id: i1.id }] });
    const zero = await repo.createWithItems(user, { name: 'Empty', items: [] });

    const summaries = await repo.listWithCounts(user);
    // Every row parses as an OutfitSummary (item_count present, non-negative int).
    for (const s of summaries) expect(() => OutfitSummary.parse(s)).not.toThrow();

    const byId = new Map(summaries.map((s) => [s.id, s.item_count]));
    expect(byId.get(three.id)).toBe(3);
    expect(byId.get(one.id)).toBe(1);
    // LEFT JOIN: the empty outfit is present, not dropped, with count 0.
    expect(byId.get(zero.id)).toBe(0);

    // Differential ground truth: the repo's count for each outfit equals a superuser COUNT(*).
    for (const s of summaries) {
      const truth = await superuser.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
        [s.id],
      );
      expect(s.item_count).toBe(Number(truth.rows[0]?.n));
    }

    // Same ordering contract as listByUser (created_at DESC, id DESC).
    const listed = await repo.listByUser(user);
    expect(summaries.map((s) => s.id)).toEqual(listed.map((r) => r.id));
  });

  // Independent oracle for preview_paths: position-ordered member cutout paths, members with
  // no cutout excluded, capped at OUTFIT_PREVIEW_LIMIT. Graded against the cutout_path values
  // the WARDROBE repo returned (not the outfit query) and a superuser member-count.
  it('listWithCounts.preview_paths = position-ordered member cutouts, null-cutout excluded, capped', async () => {
    const user = 'e7e7e7e7-e7e7-47e7-87e7-e7e7e7e7e7e7';
    const exec = makeTenantExecutor(pool, user);
    const wardrobe = makeWardrobeRepo(exec);
    const repo = makeOutfitsRepo(exec);

    // Six garments, five WITH a cutout_path, one WITHOUT — so we can prove null exclusion and
    // the cap (>OUTFIT_PREVIEW_LIMIT with-cutout members). Paths are distinct + recognizable.
    const withCut = async (tag: string) =>
      wardrobe.create(user, { category: 'top', cutout_path: `${user}/${tag}/cutout` });
    const a = await withCut('a');
    const b = await withCut('b');
    const c = await withCut('c');
    const d = await withCut('d');
    const e = await withCut('e');
    const noCut = await wardrobe.create(user, { category: 'shoes' }); // cutout_path null

    // Insert in a deliberately NON-sequential position order to prove ordering is BY position,
    // not by insert/id order: noCut(pos 0) first, then a,b,c,d,e at positions 1..5.
    const outfit = await repo.createWithItems(user, {
      name: 'Layered',
      items: [
        { item_id: noCut.id, position: 0 },
        { item_id: a.id, position: 1 },
        { item_id: b.id, position: 2 },
        { item_id: c.id, position: 3 },
        { item_id: d.id, position: 4 },
        { item_id: e.id, position: 5 },
      ],
    });

    const summary = (await repo.listWithCounts(user)).find((s) => s.id === outfit.id);
    expect(summary).toBeDefined();
    expect(() => OutfitSummary.parse(summary)).not.toThrow();
    // item_count counts ALL members (6), including the one without a cutout.
    expect(summary!.item_count).toBe(6);
    // preview_paths: capped at the limit, null-cutout member (noCut, pos 0) EXCLUDED, and the
    // survivors are the next-lowest positions in order: a(1), b(2), c(3), d(4). e(5) is over cap.
    expect(summary!.preview_paths).toEqual([
      `${user}/a/cutout`,
      `${user}/b/cutout`,
      `${user}/c/cutout`,
      `${user}/d/cutout`,
    ]);
    expect(summary!.preview_paths.length).toBe(OUTFIT_PREVIEW_LIMIT);
    // Every previewed path is a real member's cutout_path (differential vs the wardrobe repo).
    const memberPaths = new Set(
      [a, b, c, d, e].map((row) => row.cutout_path).filter((p): p is string => p !== null),
    );
    for (const path of summary!.preview_paths) expect(memberPaths.has(path)).toBe(true);
  });

  // Independent oracle for remove (F6 delete). The security-critical claims: a cross-tenant
  // delete is a no-op (B cannot remove A's outfit — RLS, graded by a superuser row-still-exists
  // probe the repo query can't see), members cascade, and delete is idempotent.
  it('remove deletes own outfit + cascades members; cross-tenant delete is a no-op; idempotent', async () => {
    const item = await makeWardrobeRepo(execA).create(USER_A, { category: 'top' });
    const outfit = await makeOutfitsRepo(execA).createWithItems(USER_A, {
      name: 'ToDelete',
      items: [{ item_id: item.id }],
    });

    // B tries to delete A's outfit: RLS scopes the DELETE to B's own rows, so it matches
    // nothing → false, and A's outfit is UNTOUCHED (superuser confirms it still exists).
    const bDeleted = await makeOutfitsRepo(execB).remove(USER_B, outfit.id);
    expect(bDeleted).toBe(false);
    const afterCrossTenant = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfit.id],
    );
    expect(afterCrossTenant.rows[0]?.n).toBe('1');

    // A deletes its own outfit → true, and BOTH the outfit and its member (cascade) are gone.
    const aDeleted = await makeOutfitsRepo(execA).remove(USER_A, outfit.id);
    expect(aDeleted).toBe(true);
    const outfitGone = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfit.id],
    );
    expect(outfitGone.rows[0]?.n).toBe('0');
    const membersGone = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfit.id],
    );
    expect(membersGone.rows[0]?.n).toBe('0');

    // Idempotent: deleting the already-deleted outfit is false, never an error.
    expect(await makeOutfitsRepo(execA).remove(USER_A, outfit.id)).toBe(false);
  });
});
