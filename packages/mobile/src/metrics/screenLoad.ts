// The PURE core of the screen-load metric, kept out of the hook so it tests without React (the
// repo has no React renderer in unit tests — the pattern is wardrobeFilters/statusChange/basket:
// the logic lives in a pure module, the hook is a thin wrapper). The hook (useScreenLoad) owns
// only the mount-timestamp capture and the emit-once latch; everything gradeable is here.
import type { LogFields } from '../api/logger.js';

// The one structured line a screen emits when it first becomes ready. durationMs is the
// mount → first-ready-paint elapsed, rounded to a whole ms and clamped at 0 (a monotonic clock
// should never go backwards, but a defensive clamp means a bad reading logs 0, never a negative
// that would poison a p50). The vocabulary is {event, screen, durationMs} — a name and a number,
// no row, no query param, so there is no PII path (same contract as logger.ts).
export function screenLoadFields(screen: string, mountedAt: number, now: number): LogFields {
  const durationMs = Math.max(0, Math.round(now - mountedAt));
  return { event: 'screen_load', screen, durationMs };
}
