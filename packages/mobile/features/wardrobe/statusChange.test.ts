// Oracle for the pure status-change logic behind the closet tile's status menu. The claims the
// SCREEN relies on but can't itself prove: from any state you can move to EXACTLY the other two
// states (never to the one you're in, never to an invented one), the targets are drawn from the
// wire enum itself (no drift), and every target has a distinct verb label so no menu row renders
// blank or duplicated. None of this touches React.
import { describe, it, expect } from 'vitest';
import { alternativeStatuses, statusActionLabel } from './statusChange.js';
import { Availability } from '@closet/shared';

describe('statusChange — the closet-tile status menu logic', () => {
  it('from every state, offers EXACTLY the other two enum members (never a no-op to itself)', () => {
    for (const current of Availability.options) {
      const targets = alternativeStatuses(current);
      // Two targets, the current state excluded, and every target a real enum member.
      expect(targets).toHaveLength(2);
      expect(targets).not.toContain(current);
      expect(new Set(targets)).toEqual(new Set(Availability.options.filter((s) => s !== current)));
    }
  });

  it('the union of {current} ∪ alternatives is the WHOLE enum, for every state (nothing unreachable)', () => {
    for (const current of Availability.options) {
      const reachable = new Set([current, ...alternativeStatuses(current)]);
      expect(reachable).toEqual(new Set(Availability.options));
    }
  });

  it('every enum member has a non-empty action label, and the labels are all distinct', () => {
    const labels = Availability.options.map(statusActionLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    // Distinct: two rows in the menu must never read the same verb.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('does not mutate or reorder the shared enum (returns a fresh filtered array)', () => {
    const before = [...Availability.options];
    alternativeStatuses('clean');
    expect([...Availability.options]).toEqual(before);
  });
});
