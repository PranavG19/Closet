// The perf measurement tool needs its OWN oracle: if summarize()'s percentile math is
// wrong, every SLO number the Tier-5 lane reports is wrong in a way no downstream test
// would catch (they'd all be self-consistently wrong). So the percentiles are checked
// against hand-computed nearest-rank values on a known distribution — a signal the
// implementation did not produce.
import { describe, it, expect } from 'vitest';
import { summarize, rankedTable, measureConcurrent, type Sample } from './perf.js';

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

describe('perf.measureConcurrent — the load-test primitive is honest', () => {
  // The three properties a load test's floor depends on: every op runs EXACTLY once
  // (never lost, never double-counted → total is real), never more than `concurrency`
  // are in flight (→ the "under load" claim is true, not a serial loop in disguise), and
  // every sample is recorded (→ the percentile summary isn't computed over holes).
  it('runs each op exactly once, at indices 0..total-1, and records every sample', async () => {
    const seen: number[] = [];
    const { samples } = await measureConcurrent('op', 20, 4, async (i) => {
      seen.push(i);
    });
    expect(samples).toHaveLength(20);
    expect(samples.every((s) => typeof s.ms === 'number' && s.label === 'op')).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('never exceeds the concurrency cap in flight (the "under load" claim is real)', async () => {
    let inFlight = 0;
    let peak = 0;
    await measureConcurrent('op', 30, 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield so multiple workers genuinely overlap before any settles.
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    });
    expect(peak).toBeGreaterThan(1); // actually concurrent, not accidentally serial
    expect(peak).toBeLessThanOrEqual(5); // never over the cap
  });

  it('caps workers at total when concurrency exceeds it (no idle over-spawn)', async () => {
    let peak = 0;
    let inFlight = 0;
    await measureConcurrent('op', 3, 100, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
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
