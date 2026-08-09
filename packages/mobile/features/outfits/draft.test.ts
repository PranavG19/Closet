// Outfit-draft tests. The oracle is the STYLING RULES stated in draft.ts, not the module's own
// output — each test names the rule and the nonsense it prevents. This layer matters precisely
// because the server has no opinion here: `OutfitItemInput.slot` is a nullable string, so a
// bug in this model saves a contradictory outfit that the backend accepts happily.
import { describe, it, expect } from 'vitest';
import {
  EMPTY_DRAFT,
  OUTFIT_SLOTS,
  incompleteReason,
  isComplete,
  itemCount,
  place,
  remove,
  rename,
  slotForCategory,
  toItems,
} from './draft.js';

describe('slotForCategory', () => {
  it('maps every canvas slot back from its category', () => {
    // Iterating the slot list means a new slot cannot be added without a mapping.
    for (const slot of OUTFIT_SLOTS) {
      expect(slotForCategory(slot)).toBe(slot);
    }
  });

  it('returns null for a category with no slot, rather than guessing one', () => {
    expect(slotForCategory('kimono')).toBeNull();
  });
});

describe('place — replaces rather than refuses', () => {
  it('fills an empty slot', () => {
    const draft = place(EMPTY_DRAFT, 'top', 'tee');
    expect(draft.filled.top).toBe('tee');
  });

  it('REPLACES the current occupant of a slot', () => {
    // Tapping a second pair of shoes means "these instead". Making her clear the slot first
    // would be friction with no purpose.
    const draft = place(place(EMPTY_DRAFT, 'shoes', 'boots'), 'shoes', 'flats');
    expect(draft.filled.shoes).toBe('flats');
    expect(itemCount(draft)).toBe(1);
  });

  it('never mutates the draft it was given', () => {
    const before = place(EMPTY_DRAFT, 'top', 'tee');
    place(before, 'bottom', 'jeans');
    expect(before.filled.bottom).toBeUndefined();
  });
});

describe('place — the dress rule (the one real styling constraint)', () => {
  it('placing a dress CLEARS a top and a bottom', () => {
    // A dress occupies torso and legs. Keeping the top would save a contradiction the server
    // would accept without complaint.
    const dressed = place(place(place(EMPTY_DRAFT, 'top', 'tee'), 'bottom', 'jeans'), 'dress', 'wrap');
    expect(dressed.filled.dress).toBe('wrap');
    expect(dressed.filled.top).toBeUndefined();
    expect(dressed.filled.bottom).toBeUndefined();
  });

  it('placing a top CLEARS a dress', () => {
    const topped = place(place(EMPTY_DRAFT, 'dress', 'wrap'), 'top', 'tee');
    expect(topped.filled.top).toBe('tee');
    expect(topped.filled.dress).toBeUndefined();
  });

  it('placing a bottom CLEARS a dress', () => {
    const bottomed = place(place(EMPTY_DRAFT, 'dress', 'wrap'), 'bottom', 'jeans');
    expect(bottomed.filled.bottom).toBe('jeans');
    expect(bottomed.filled.dress).toBeUndefined();
  });

  it('a dress coexists happily with shoes, outerwear and accessories', () => {
    // The rule is specifically about the torso/leg conflict — it must not over-clear.
    let draft = place(EMPTY_DRAFT, 'dress', 'wrap');
    draft = place(draft, 'shoes', 'heels');
    draft = place(draft, 'outerwear', 'coat');
    draft = place(draft, 'accessory', 'belt');
    expect(draft.filled.dress).toBe('wrap');
    expect(itemCount(draft)).toBe(4);
  });
});

describe('isComplete / incompleteReason', () => {
  it('an empty draft is not saveable, and says why', () => {
    expect(isComplete(EMPTY_DRAFT)).toBe(false);
    expect(incompleteReason(EMPTY_DRAFT)).toMatch(/add a few pieces/i);
  });

  it('ONE garment is not an outfit — it is a garment', () => {
    const one = place(EMPTY_DRAFT, 'top', 'tee');
    expect(isComplete(one)).toBe(false);
    expect(incompleteReason(one)).toMatch(/one more piece/i);
  });

  it('two garments make a look', () => {
    const two = place(place(EMPTY_DRAFT, 'top', 'tee'), 'bottom', 'jeans');
    expect(isComplete(two)).toBe(true);
    expect(incompleteReason(two)).toBeNull();
  });

  it('a dress ALONE is saveable — it is self-sufficient', () => {
    const dress = place(EMPTY_DRAFT, 'dress', 'wrap');
    expect(isComplete(dress)).toBe(true);
    expect(incompleteReason(dress)).toBeNull();
  });

  it('the reason is null exactly when complete (copy cannot drift from the rule)', () => {
    const drafts = [
      EMPTY_DRAFT,
      place(EMPTY_DRAFT, 'shoes', 's'),
      place(EMPTY_DRAFT, 'dress', 'd'),
      place(place(EMPTY_DRAFT, 'top', 't'), 'shoes', 's'),
    ];
    for (const draft of drafts) {
      expect(incompleteReason(draft) === null).toBe(isComplete(draft));
    }
  });
});

describe('rename', () => {
  it('stores a trimmed name', () => {
    expect(rename(EMPTY_DRAFT, '  Sunday brunch  ').name).toBe('Sunday brunch');
  });

  it('stores NULL for an empty or whitespace-only name, never an empty string', () => {
    // The list renders null as "Untitled look"; an empty string would be a second, uglier way
    // to be nameless.
    expect(rename(EMPTY_DRAFT, '').name).toBeNull();
    expect(rename(EMPTY_DRAFT, '   ').name).toBeNull();
  });
});

describe('remove', () => {
  it('empties one slot and leaves the rest', () => {
    const draft = place(place(EMPTY_DRAFT, 'top', 'tee'), 'shoes', 'boots');
    const without = remove(draft, 'top');
    expect(without.filled.top).toBeUndefined();
    expect(without.filled.shoes).toBe('boots');
  });

  it('removing an empty slot is a no-op, not an error', () => {
    expect(itemCount(remove(EMPTY_DRAFT, 'top'))).toBe(0);
  });
});

describe('toItems — the wire payload', () => {
  it('orders items by how the outfit reads on the body, not by tap order', () => {
    // She tapped shoes first; the payload must still read outerwear → top → bottom → shoes.
    let draft = place(EMPTY_DRAFT, 'shoes', 'boots');
    draft = place(draft, 'top', 'tee');
    draft = place(draft, 'outerwear', 'coat');
    draft = place(draft, 'bottom', 'jeans');
    expect(toItems(draft).map((i) => i.item_id)).toEqual(['coat', 'tee', 'jeans', 'boots']);
  });

  it('assigns strictly increasing positions', () => {
    const draft = place(place(EMPTY_DRAFT, 'top', 'tee'), 'shoes', 'boots');
    const positions = toItems(draft).map((i) => i.position!);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('sends the slot explicitly, so a saved outfit can be re-placed on the canvas', () => {
    const items = toItems(place(EMPTY_DRAFT, 'dress', 'wrap'));
    expect(items).toEqual([{ item_id: 'wrap', slot: 'dress', position: 2 }]);
  });

  it('omits empty slots entirely', () => {
    expect(toItems(EMPTY_DRAFT)).toEqual([]);
  });
});
