// perf — the measurement primitive the Tier-5 SLO lane is built on (docs/05 Tier-5).
//
// The whole point of this file is that the grading signal is the CLOCK, not a
// self-report: `measure()` runs an operation N times, records wall-clock per run with
// process.hrtime.bigint() (monotonic, nanosecond, immune to wall-clock adjustment),
// and `summarize()` reduces the samples to a distribution. Nothing here asserts — the
// caller decides pass/fail against an SLO — so this stays a pure measurement tool that
// a perf test and a future CI reporter can both consume.
//
// Percentile convention: nearest-rank on the sorted samples (p95 of 200 samples = the
// 190th smallest, index ceil(0.95*200)-1 = 189). Nearest-rank is chosen over linear
// interpolation deliberately — it always returns an OBSERVED sample, so a reported p95
// is a latency that actually happened, never a number between two that did.

export interface Sample {
  readonly label: string;
  readonly ms: number;
}

export interface PerfSummary {
  readonly label: string;
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

// Nearest-rank percentile over an already-sorted ascending array. p in [0,1].
function percentileSorted(sortedMs: readonly number[], p: number): number {
  if (sortedMs.length === 0) return NaN;
  if (p <= 0) return sortedMs[0]!;
  if (p >= 1) return sortedMs[sortedMs.length - 1]!;
  const rank = Math.ceil(p * sortedMs.length);
  return sortedMs[rank - 1]!;
}

// Run `op` `n` times, discarding `warmup` leading runs (JIT / connection-pool warmup
// would otherwise inflate the min and skew a small sample). Returns raw per-run ms.
export async function measure(
  label: string,
  n: number,
  op: () => Promise<unknown>,
  opts?: { readonly warmup?: number },
): Promise<Sample[]> {
  const warmup = opts?.warmup ?? Math.min(5, Math.floor(n / 10));
  for (let i = 0; i < warmup; i += 1) await op();
  const samples: Sample[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = process.hrtime.bigint();
    await op();
    const end = process.hrtime.bigint();
    samples.push({ label, ms: Number(end - start) / 1e6 });
  }
  return samples;
}

export function summarize(samples: readonly Sample[]): PerfSummary {
  if (samples.length === 0) throw new Error('summarize: no samples (a vacuous perf measurement)');
  const label = samples[0]!.label;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const sum = sorted.reduce((acc, ms) => acc + ms, 0);
  return {
    label,
    n: sorted.length,
    min: sorted[0]!,
    p50: percentileSorted(sorted, 0.5),
    p95: percentileSorted(sorted, 0.95),
    p99: percentileSorted(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  };
}

// A fixed-width, slowest-first table. This is the artifact the "optimize the slowest
// operation first" loop reads — ranked by p95 descending so the top row is the next
// thing to work on. Emitted to stdout by the perf suite; not an assertion.
export function rankedTable(summaries: readonly PerfSummary[]): string {
  const ranked = [...summaries].sort((a, b) => b.p95 - a.p95);
  const f = (n: number): string => n.toFixed(2).padStart(9);
  const nameW = Math.max(24, ...ranked.map((s) => s.label.length));
  const header =
    `${'operation'.padEnd(nameW)}  ${'n'.padStart(5)}  ${'min'.padStart(9)}  ${'p50'.padStart(9)}  ${'p95'.padStart(9)}  ${'p99'.padStart(9)}  ${'max'.padStart(9)}`;
  const rows = ranked.map(
    (s) =>
      `${s.label.padEnd(nameW)}  ${String(s.n).padStart(5)}  ${f(s.min)}  ${f(s.p50)}  ${f(s.p95)}  ${f(s.p99)}  ${f(s.max)}`,
  );
  return ['', 'PERF — ranked slowest-first by p95 (ms), measured wall-clock', header, '-'.repeat(header.length), ...rows, ''].join('\n');
}
