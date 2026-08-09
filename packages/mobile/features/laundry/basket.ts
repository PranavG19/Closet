// The Basket — the selection model behind batch mark-clean.
//
// WHY BATCH AT ALL: the laundry screen only ever offered one "Mark clean" button per garment.
// Real laundry is a LOAD. Doing a wash means marking fifteen things clean, which was fifteen
// separate taps and fifteen separate round-trips, each invalidating the wardrobe cache and
// re-rendering the list underneath her finger — so the row she wanted next moved as she
// tapped. That is not a styling problem, it is the wrong interaction shape for the task.
//
// Kept as a PURE module so the selection logic (which is where off-by-one and stale-id bugs
// live) is unit-tested without a renderer. The screen holds it in one useState.

export interface Basket {
  // Insertion order is not meaningful — a Set keeps membership checks O(1) for the
  // per-row "is this selected" read that runs on every row of every render.
  readonly ids: ReadonlySet<string>;
}

export const EMPTY_BASKET: Basket = { ids: new Set() };

export function isSelected(basket: Basket, id: string): boolean {
  return basket.ids.has(id);
}

// Toggle one garment. Returns a NEW basket (never mutates) so React sees a changed reference
// and re-renders; mutating the Set in place is the classic "selection doesn't update" bug.
export function toggle(basket: Basket, id: string): Basket {
  const ids = new Set(basket.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids };
}

// Select every garment currently on screen. Takes the visible ids explicitly rather than
// "all" — a paginated list must never select rows the user cannot see, or "Mark clean" would
// silently act on garments she never looked at.
export function selectAll(visibleIds: readonly string[]): Basket {
  return { ids: new Set(visibleIds) };
}

export function clear(): Basket {
  return EMPTY_BASKET;
}

export function count(basket: Basket): number {
  return basket.ids.size;
}

// The ids to actually submit, INTERSECTED with what is still on screen.
//
// This intersection is the point of the function and not defensive noise: the list refetches
// after every mutation, so a garment can leave the dirty list (marked clean in another
// session, or deleted) while sitting in the basket. Submitting a stale id would produce a 404
// per stale row and a partial failure that is hard to explain. Sorted for a deterministic
// submission order, which makes the batch's behaviour reproducible in a test.
export function pending(basket: Basket, visibleIds: readonly string[]): string[] {
  const visible = new Set(visibleIds);
  return [...basket.ids].filter((id) => visible.has(id)).sort();
}

// Drop ids that are no longer on screen. Called after a refetch so the count in the action
// bar never claims more garments than exist — a basket that says "12 selected" over a list of
// 9 rows is a lie about what the button will do.
export function prune(basket: Basket, visibleIds: readonly string[]): Basket {
  const visible = new Set(visibleIds);
  const ids = new Set([...basket.ids].filter((id) => visible.has(id)));
  // Preserve the identity when nothing changed, so this can be called from an effect without
  // causing a render loop.
  return ids.size === basket.ids.size ? basket : { ids };
}
