// F7 — change a garment's availability FROM the closet grid. The wire seam already exists
// (useToggleAvailability + the Availability enum); this is the pure "which states can I move
// to, and what do I call that move" logic, kept out of the tile so it tests without React.
//
// It never invents a state: the targets are exactly the OTHER two members of the closed
// Availability enum, so a garment can always be moved to either of the two states it is not
// in, and never "changed" to the state it already has (which would be a no-op write).
import type { Availability } from '@closet/shared';
import { AVAILABILITY_OPTIONS } from './wardrobeFilters.js';

// The two states a garment can move to from its current one — the enum minus the current
// value, in the enum's own display order (clean, dirty, unavailable). Deterministic and
// total: every Availability yields exactly the other two.
export function alternativeStatuses(current: Availability): Availability[] {
  return AVAILABILITY_OPTIONS.filter((status) => status !== current);
}

// The label for the ACTION of moving TO a state — a verb phrase, kind and non-clinical
// (docs/03: laundry is normal, not an error), distinct from AvailabilityChip's noun labels
// ("In the wash") because a menu row is a thing you DO, not a state you're in.
const TARGET_ACTION_LABEL: Readonly<Record<Availability, string>> = {
  clean: 'Ready to wear',
  dirty: 'Put in the wash',
  unavailable: 'Set aside',
};

export function statusActionLabel(target: Availability): string {
  return TARGET_ACTION_LABEL[target];
}
