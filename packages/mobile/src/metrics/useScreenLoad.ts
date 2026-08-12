// Screen-load instrumentation. The API client already times each request (client.ts), but
// nothing measured the metric the directive actually asks for — how long a SCREEN takes to
// become useful, mount → first ready paint. That number is dominated by RN render + the
// query it waits on, not the DB (measured: DB ops are p50 4–8ms noise), so it is the honest
// place to look for a bottleneck.
//
// Contract: a screen calls useScreenLoad(name, ready). `ready` is false while it shows a
// LoadingState and flips true on the first render with data. The hook emits EXACTLY ONE
// `screen_load` line, on that first true, carrying the elapsed ms from mount. A screen that
// mounts already-ready (cache hit) logs a near-zero duration — which is itself the signal
// that the cache, not the fetch, served it.
//
// No PII: the vocabulary is {event, screen, durationMs} — a screen name and a number, never
// a row or a query param. Same single sink + field types as logger.ts.
import { useEffect, useRef } from 'react';
import { logger } from '../api/logger.js';
import { screenLoadFields } from './screenLoad.js';

// Monotonic clock — performance.now (not Date.now) so a wall-clock adjustment mid-load can't
// yield a negative duration. Mirrors client.ts's nowMs exactly.
function nowMs(): number {
  return (globalThis as { performance: { now(): number } }).performance.now();
}

export function useScreenLoad(screen: string, ready: boolean): void {
  // Mount timestamp, captured once. useRef (not state) so reading it never triggers a render.
  const mountedAt = useRef<number>(nowMs());
  // Latches so the line is emitted exactly once, even though `ready` may re-render true many
  // times after the first (every subsequent data render keeps it true).
  const logged = useRef(false);

  useEffect(() => {
    if (ready && !logged.current) {
      logged.current = true;
      logger.info(screenLoadFields(screen, mountedAt.current, nowMs()));
    }
  }, [ready, screen]);
}
