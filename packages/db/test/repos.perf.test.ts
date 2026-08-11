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
