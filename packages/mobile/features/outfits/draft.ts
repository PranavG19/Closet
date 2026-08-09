// The outfit-builder draft — F6's missing write model, as a pure module.
//
// F6's backend has been complete for a long time (outfits-create + outfit_items with a
// composite FK, integration-tested) and `useCreateOutfit` exists, but there was no UI: the
// Outfits screen's "Build an outfit" button was `onAction={() => {}}`. This is the model the
// canvas needs, kept pure so the slot rules are unit-tested rather than trusted.
//
// SLOTS ARE MODELLED, NOT FREE-FORM. `OutfitItemInput.slot` is a nullable string server-side,
// which means the wire accepts anything — but a look is not an arbitrary bag of garments. Two
// tops is not an outfit; a top with a dress is a contradiction. Encoding that here is what
// stops the UI from cheerfully saving nonsense the backend has no opinion about.
import type { OutfitItemInput } from '@closet/shared';

// The canvas slots, in the order they read top-to-bottom on the body. `position` is derived
// from this order, so the saved outfit's item order is meaningful rather than insertion order.
export const OUTFIT_SLOTS = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory'] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

// Which wardrobe categories may occupy which slot. Deliberately 1:1 with the category enum
// today, but named separately because the SLOT is a styling concept and the CATEGORY is a
// property of the garment — a future "layer a second top" slot would break the 1:1 without
// changing what a top is.
const CATEGORY_FOR_SLOT: Readonly<Record<OutfitSlot, string>> = {
  outerwear: 'outerwear',
  top: 'top',
  dress: 'dress',
  bottom: 'bottom',
  shoes: 'shoes',
  accessory: 'accessory',
};

export interface Draft {
  // One garment per slot. A slot with no garment is simply absent.
  readonly filled: Readonly<Partial<Record<OutfitSlot, string>>>;
  readonly name: string | null;
}

export const EMPTY_DRAFT: Draft = { filled: {}, name: null };

export function slotForCategory(category: string): OutfitSlot | null {
  const slot = OUTFIT_SLOTS.find((s) => CATEGORY_FOR_SLOT[s] === category);
  return slot ?? null;
}

// Place a garment. Returns a new draft; the previous occupant of that slot is REPLACED, not
// rejected — tapping a second pair of shoes obviously means "these instead", and making her
// clear the slot first would be friction with no purpose.
export function place(draft: Draft, slot: OutfitSlot, itemId: string): Draft {
  const filled: Partial<Record<OutfitSlot, string>> = { ...draft.filled, [slot]: itemId };

  // THE ONE REAL RULE: a dress occupies the torso AND the legs, so it cannot coexist with a
  // top or a bottom. Whichever the user just placed wins, and the conflicting slots clear —
  // rather than refusing the tap, which would leave her guessing which garment is the problem.
  if (slot === 'dress') {
    delete filled.top;
    delete filled.bottom;
  } else if (slot === 'top' || slot === 'bottom') {
    delete filled.dress;
  }

  return { ...draft, filled };
}

export function remove(draft: Draft, slot: OutfitSlot): Draft {
  const filled = { ...draft.filled };
  delete filled[slot];
  return { ...draft, filled };
}

export function rename(draft: Draft, name: string): Draft {
  const trimmed = name.trim();
  // Empty means "no name" — the list already renders `null` as "Untitled look", so storing an
  // empty string would create a second, uglier way to be nameless.
  return { ...draft, name: trimmed.length === 0 ? null : trimmed };
}

export function itemCount(draft: Draft): number {
  return Object.keys(draft.filled).length;
}

// Is this saveable? A single garment is not an outfit — it is a garment. Two is the minimum
// that constitutes a "look", except that a dress is self-sufficient and may be saved alone.
export function isComplete(draft: Draft): boolean {
  if (draft.filled.dress !== undefined) return true;
  return itemCount(draft) >= 2;
}

// Why the save button is disabled, in her words. Returned rather than derived in the screen so
// the copy is tested and cannot drift from the rule above.
export function incompleteReason(draft: Draft): string | null {
  if (isComplete(draft)) return null;
  if (itemCount(draft) === 0) return 'Add a few pieces to build a look.';
  return 'Add one more piece — or pick a dress.';
}

// The wire payload. `position` comes from OUTFIT_SLOTS order, so the saved item order reflects
// how the outfit reads on the body rather than the order she happened to tap.
//
// `slot` is sent explicitly: it is what lets a later render place a saved outfit back onto the
// canvas without re-deriving slots from categories (which would break the moment slots and
// categories stop being 1:1).
export function toItems(draft: Draft): OutfitItemInput[] {
  return OUTFIT_SLOTS.flatMap((slot, index) => {
    const itemId = draft.filled[slot];
    return itemId === undefined ? [] : [{ item_id: itemId, slot, position: index }];
  });
}
