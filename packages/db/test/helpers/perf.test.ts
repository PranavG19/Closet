// The perf measurement tool needs its OWN oracle: if summarize()'s percentile math is
// wrong, every SLO number the Tier-5 lane reports is wrong in a way no downstream test
// would catch (they'd all be self-consistently wrong). So the percentiles are checked
// against hand-computed nearest-rank values on a known distribution — a signal the
// implementation did not produce.
import { describe, it, expect } from 'vitest';
import { summarize, rankedTable, type Sample } from './perf.js';

const samplesFrom = (label: string, ms: readonly number[]): Sample[] => ms.map((m) => ({ label, ms: m }));

describe('perf.summarize — nearest-rank percentiles over a known distribution', () => {
  it('1..100 → nearest-rank p50/p95/p99 land on observed samples', () => {
    // 100 samples of 1..100 ms. Nearest-rank: p50 = ceil(0.5*100)=50th = 50;
    // p95 = ceil(0.95*100)=95th = 95; p99 = 99th = 99. min 1, max 100, mean 50.5.
    const s = summarize(samplesFrom('op', Array.from({ length: 100 }, (_, i) => i + 1)));
    expect(s.n).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
    expect(s.mean).toBeCloseTo(50.5, 6);
  });

  it('is order-independent (sorts internally)', () => {
    const ascending = summarize(samplesFrom('op', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const shuffled = summarize(samplesFrom('op', [7, 2, 10, 4, 1, 9, 3, 8, 5, 6]));
    expect(shuffled).toEqual(ascending);
  });

  it('p95 always returns an OBSERVED sample, never an interpolated value', () => {
    // A bimodal set: 9 fast (1ms) + 1 slow (1000ms). Nearest-rank p95 of 10 = 10th = 1000,
    // p50 = 5th = 1. A linear-interpolation impl would report a p95 between 1 and 1000 that
    // never happened; nearest-rank must report exactly 1000.
    const s = summarize(samplesFrom('op', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1000]));
    expect(s.p50).toBe(1);
    expect(s.p95).toBe(1000);
    expect(s.max).toBe(1000);
  });

  it('single sample → every percentile is that sample', () => {
    const s = summarize(samplesFrom('op', [42]));
    expect([s.min, s.p50, s.p95, s.p99, s.max, s.mean]).toEqual([42, 42, 42, 42, 42, 42]);
  });

  it('empty samples throw (a vacuous measurement must not silently pass)', () => {
    expect(() => summarize([])).toThrow(/no samples/);
  });
});

describe('perf.rankedTable — slowest-first ordering', () => {
  it('orders rows by p95 descending so the top row is the next thing to optimize', () => {
    const fast = summarize(samplesFrom('fast-op', [1, 1, 1, 1, 2]));
    const slow = summarize(samplesFrom('slow-op', [50, 60, 70, 80, 90]));
    const mid = summarize(samplesFrom('mid-op', [10, 11, 12, 13, 14]));
    const table = rankedTable([fast, slow, mid]);
    const slowIdx = table.indexOf('slow-op');
    const midIdx = table.indexOf('mid-op');
    const fastIdx = table.indexOf('fast-op');
    expect(slowIdx).toBeGreaterThan(-1);
    expect(slowIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(fastIdx);
  });
});
