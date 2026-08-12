// Tier-5 DB perf lane (docs/05 Tier-5). Measures every repo read/write against REAL
// Postgres, through the real per-request tenant executor (BEGIN → SET LOCAL ROLE
// app_user → set sub → COMMIT), on a POPULATED wardrobe — the same substrate Tier-3
// uses, so the numbers reflect production RLS + indexes, not an in-memory mock.
//
// It does two things: (1) prints a ranked slowest-first table (the artifact the
// "optimize the slowest operation first" loop reads), and (2) asserts each op's p95
// against the Tier-5 DB-latency SLOs. Those SLOs are marked NEW in docs/05 and are the
// DB-only leg (no provider, no network) — a floor to catch a regression or a missing
// index, not the end-to-end budget.
//
// NOT in the gate wall. This runs in the `perf` vitest project (nightly / on-demand),
// because sampling N runs of every op blows the p95<90s synchronous budget (Rule 4).
// It is VM-gated like every integration test: no container, no run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  makeWardrobeRepo,
  makeOutfitsRepo,
  makeWearLogRepo,
  makeOutfitItemsRepo,
  MAX_PAGE_SIZE,
} from '../src/repos/index.js';
import { applyMigrations } from './helpers/applyMigrations.js';
import { makeTenantExecutor, type QueryExecutor } from './helpers/executor.js';
import { startPg, type PgHarness } from './helpers/pgContainer.js';
import { measure, summarize, rankedTable, type PerfSummary } from './helpers/perf.js';

const USER = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
// Sample count per op. 200 is the Tier-5 latency-sample floor; keep it modest so the
// whole lane stays minutes, not hours, on the shared VM.
const N = 200;
// A populated wardrobe well past one page, so list/keyset numbers are not a toy.
const SEED_ITEMS = MAX_PAGE_SIZE * 3;

// DB-only p95 SLOs (ms), docs/05 Tier-5. Generous vs. a warm local PG precisely so a
// PASS means "no pathological regression / missing index", not "matches a hosted RTT"
// (that re-baselines on the first real deployment — docs/05 open question).
const SLO_P95_MS: Record<string, number> = {
  'wardrobe.create': 80,
  'wardrobe.listByUser(page)': 100,
  'wardrobe.listByUser(filtered)': 100,
  'wardrobe.getById': 80,
  'wardrobe.setAvailability': 80,
  'outfits.createWithItems': 100,
  'outfits.listByUser': 100,
  'outfitItems.listByOutfit': 100,
  'wearLog.append': 80,
  'wearLog.listByUser': 100,
};

describe('Tier-5 — DB repo latency against real Postgres (ranked, SLO-gated)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let exec: QueryExecutor;
  const seededItemIds: string[] = [];
  let seededOutfitId = '';
  const summaries: PerfSummary[] = [];

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    exec = makeTenantExecutor(pool, USER);

    // Seed a populated wardrobe once. Sequential (not Promise.all) so pool pressure
    // during seeding doesn't distort the container's warm state before measurement.
    const wardrobe = makeWardrobeRepo(exec);
    const categories = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] as const;
    for (let i = 0; i < SEED_ITEMS; i += 1) {
      const item = await wardrobe.create(USER, {
        category: categories[i % categories.length]!,
        color: `#${(i % 16).toString(16).repeat(6).slice(0, 6)}`,
      });
      seededItemIds.push(item.id);
    }

    // One outfit with a handful of members, for the outfit-read ops.
    const outfit = await makeOutfitsRepo(exec).createWithItems(USER, {
      name: 'seed',
      items: seededItemIds.slice(0, 5).map((id, position) => ({ item_id: id, slot: 'top', position })),
    });
    seededOutfitId = outfit.id;
  }, 180_000);

  afterAll(async () => {
    // Emit the ranked table AFTER all measurements, so the whole slowest-first picture
    // prints in one block for the optimize loop to read.
    if (summaries.length > 0) {
      console.log(rankedTable(summaries));
    }
    await harness?.stop();
  });

  // Each `it` measures one op N times, records its summary for the ranked table, and
  // asserts p95 against the SLO. A missing SLO key fails loudly rather than skipping.
  const perfIt = (label: string, op: () => Promise<unknown>): void => {
    it(`${label} p95 within SLO`, async () => {
      const summary = summarize(await measure(label, N, op));
      summaries.push(summary);
      const slo = SLO_P95_MS[label];
      expect(slo, `no SLO defined for '${label}' — add one to SLO_P95_MS`).toBeTypeOf('number');
      expect(
        summary.p95,
        `${label}: p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${slo}ms ` +
          `(min ${summary.min.toFixed(2)} / p50 ${summary.p50.toFixed(2)} / max ${summary.max.toFixed(2)}). ` +
          `A regression here is a missing index or an N+1, not noise — investigate before relaxing the SLO.`,
      ).toBeLessThanOrEqual(slo!);
    }, 120_000);
  };

  const wardrobe = (): ReturnType<typeof makeWardrobeRepo> => makeWardrobeRepo(exec);

  perfIt('wardrobe.create', () => wardrobe().create(USER, { category: 'top' }));
  perfIt('wardrobe.listByUser(page)', () => wardrobe().listByUser(USER, { limit: MAX_PAGE_SIZE }));
  perfIt('wardrobe.listByUser(filtered)', () => wardrobe().listByUser(USER, { category: 'dress', limit: MAX_PAGE_SIZE }));
  perfIt('wardrobe.getById', () => wardrobe().getById(USER, seededItemIds[0]!));
  perfIt('wardrobe.setAvailability', () => wardrobe().setAvailability(USER, seededItemIds[0]!, 'clean'));
  perfIt('outfits.createWithItems', () => makeOutfitsRepo(exec).createWithItems(USER, { name: 'p', items: [] }));
  perfIt('outfits.listByUser', () => makeOutfitsRepo(exec).listByUser(USER));
  perfIt('outfitItems.listByOutfit', () => makeOutfitItemsRepo(exec).listByOutfit(USER, seededOutfitId));
  // Fresh clientId per run so each iteration is a real INSERT, not an ON-CONFLICT
  // re-read of the first row (which would measure the wrong path and read fast).
  let wearSeq = 0;
  perfIt('wearLog.append', () =>
    makeWearLogRepo(exec).appendWear({
      userId: USER,
      itemId: seededItemIds[1]!,
      outfitId: null,
      clientId: `perf-${(wearSeq += 1)}`,
      flipToDirty: false,
    }),
  );
  perfIt('wearLog.listByUser', () => makeWearLogRepo(exec).listByUser(USER, { limit: MAX_PAGE_SIZE }));
});

// Its OWN describe + harness so the large delete-pool seed (below) doesn't perturb the
// listByUser baselines measured above. Outfit delete is the one write that fans out to
// three tables: the outfit row, its cascaded outfit_items (ON DELETE CASCADE), and the
// referencing wear_log rows (ON DELETE SET NULL (outfit_id), migration 0018). That SET
// NULL sweep is exactly what wear_log_outfit_id_idx backs — without the index it seq-scans
// the append-only moat, so this op is where a missing-index regression on the moat would
// surface. Correctness of the delete is proven in wear-log-outfit-fk.integration.test.ts;
// this proves it stays FAST on a populated wear_log.
describe('Tier-5 — outfit delete latency on a populated moat (real Postgres, SLO-gated)', () => {
  let harness: PgHarness;
  let pool: Pool;
  let exec: QueryExecutor;
  // Each measured remove() consumes one pre-seeded worn outfit; measure() runs WARMUP + N
  // times, so the pool must cover both. Seed a little slack and guard exhaustion loudly.
  const WARMUP = 5;
  const POOL = N + WARMUP + 5;
  const wornOutfitIds: string[] = [];
  // A background of unrelated wear_log rows so the SET NULL sweep runs against a moat with
  // real volume, not just the rows it will null — the seq-scan-vs-index difference only
  // shows up when there is a table to scan.
  const MOAT_BACKGROUND = MAX_PAGE_SIZE * 5;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    exec = makeTenantExecutor(pool, USER);

    const wardrobe = makeWardrobeRepo(exec);
    const outfits = makeOutfitsRepo(exec);
    const wearLog = makeWearLogRepo(exec);

    // A handful of real items to compose outfits from and wear.
    const itemIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const item = await wardrobe.create(USER, { category: 'top' });
      itemIds.push(item.id);
    }

    // Background moat volume: wears NOT tied to any pooled outfit, so the SET NULL sweep
    // has a populated table to probe into.
    let bgSeq = 0;
    for (let i = 0; i < MOAT_BACKGROUND; i += 1) {
      await wearLog.appendWear({
        userId: USER,
        itemId: itemIds[i % itemIds.length]!,
        outfitId: null,
        clientId: `bg-${(bgSeq += 1)}`,
        flipToDirty: false,
      });
    }

    // The delete pool: each outfit has a member (to cascade) AND a wear_log row pointing at
    // it (to SET NULL) — the full fan-out the delete must handle.
    let wearSeq = 0;
    for (let i = 0; i < POOL; i += 1) {
      const outfit = await outfits.createWithItems(USER, {
        name: `del-${i}`,
        items: [{ item_id: itemIds[i % itemIds.length]!, slot: 'top', position: 0 }],
      });
      await wearLog.appendWear({
        userId: USER,
        itemId: itemIds[i % itemIds.length]!,
        outfitId: outfit.id,
        clientId: `del-wear-${(wearSeq += 1)}`,
        flipToDirty: false,
      });
      wornOutfitIds.push(outfit.id);
    }
  }, 300_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('outfits.remove (worn, cascade + SET NULL) p95 within SLO', async () => {
    let cursor = 0;
    const outfits = makeOutfitsRepo(exec);
    const op = async (): Promise<void> => {
      const id = wornOutfitIds[cursor];
      cursor += 1;
      // Loud failure if the pool is exhausted: a missing id makes remove() a fast no-op that
      // would report a falsely-good p95 — the classic vacuous-perf trap.
      if (id === undefined) throw new Error(`delete pool exhausted at ${cursor}/${wornOutfitIds.length} — increase POOL`);
      const deleted = await outfits.remove(USER, id);
      if (!deleted) throw new Error(`remove returned false for a seeded outfit ${id} — pool corrupted, measurement would be vacuous`);
    };
    const summary = summarize(await measure('outfits.remove(worn)', N, op, { warmup: WARMUP }));
    console.log(rankedTable([summary]));
    const slo = 100; // three-table fan-out; generous like the other write SLOs (docs/05 Tier-5)
    expect(
      summary.p95,
      `outfits.remove(worn): p95 ${summary.p95.toFixed(2)}ms exceeds SLO ${slo}ms ` +
        `(min ${summary.min.toFixed(2)} / p50 ${summary.p50.toFixed(2)} / max ${summary.max.toFixed(2)}). ` +
        `A regression here is the missing wear_log_outfit_id_idx re-introducing a moat seq-scan, not noise.`,
    ).toBeLessThanOrEqual(slo);
  }, 180_000);
});
