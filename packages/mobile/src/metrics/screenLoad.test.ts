// Oracle for the screen-load metric's pure core. The duration is graded against clock deltas
// the TEST controls (mountedAt/now are passed in), not a number the code computed for me — so
// this is not a mirror. The claims: durationMs is the rounded elapsed, never negative (a
// clamped bad reading logs 0, never poisons a p50), and the field vocabulary is exactly
// {event, screen, durationMs} with no PII channel.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { screenLoadFields } from './screenLoad.js';

describe('screenLoadFields — the pure screen-load metric', () => {
  it('durationMs is the rounded elapsed between mount and ready', () => {
    expect(screenLoadFields('wardrobe', 100, 350).durationMs).toBe(250);
    expect(screenLoadFields('wardrobe', 100.2, 350.9).durationMs).toBe(251); // 250.7 → 251
  });

  it('a screen that mounts already-ready logs ~0 (the cache-hit signal), not a negative', () => {
    expect(screenLoadFields('today', 500, 500).durationMs).toBe(0);
  });

  it('clamps a backwards clock reading to 0 rather than emitting a negative duration', () => {
    // A monotonic clock should never go backwards, but if it does the metric must not poison a
    // percentile with a negative — it floors at 0.
    expect(screenLoadFields('today', 500, 480).durationMs).toBe(0);
  });

  it('carries EXACTLY {event, screen, durationMs} — no extra key that could smuggle a row', () => {
    const fields = screenLoadFields('outfits', 0, 42);
    expect(Object.keys(fields).sort()).toEqual(['durationMs', 'event', 'screen']);
    expect(fields.event).toBe('screen_load');
    expect(fields.screen).toBe('outfits');
  });

  it('PROPERTY: durationMs is always a non-negative integer, for any clock pair', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), fc.double({ min: 0, max: 1e9, noNaN: true }), (a, b) => {
        const { durationMs } = screenLoadFields('s', a, b);
        expect(Number.isInteger(durationMs)).toBe(true);
        expect(durationMs).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
