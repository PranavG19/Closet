// Selection-model tests. This is where the real bugs in a batch UI live — stale ids,
// mutation-in-place, and a count that disagrees with what the button will actually do — so
// the model is pure and graded here rather than through a renderer.
//
// This file is under features/ and RUNS, as of the vitest glob fix (dd001b9). Before that a
// test here executed silently never.
import { describe, it, expect } from 'vitest';
import {
  EMPTY_BASKET,
  clear,
  count,
  isSelected,
  pending,
  prune,
  selectAll,
  toggle,
} from './basket.js';

describe('toggle', () => {
  it('adds an unselected id and removes a selected one', () => {
    const one = toggle(EMPTY_BASKET, 'a');
    expect(isSelected(one, 'a')).toBe(true);
    expect(isSelected(toggle(one, 'a'), 'a')).toBe(false);
  });

  it('NEVER mutates the basket it was given', () => {
    // Mutating the Set in place is the classic "selection doesn't update" bug: React sees the
    // same reference and skips the re-render, so taps appear to do nothing.
    const before = toggle(EMPTY_BASKET, 'a');
    const after = toggle(before, 'b');
    expect(isSelected(before, 'b')).toBe(false);
    expect(after).not.toBe(before);
  });

  it('leaves other selections untouched', () => {
    const basket = toggle(toggle(toggle(EMPTY_BASKET, 'a'), 'b'), 'c');
    const without = toggle(basket, 'b');
    expect(isSelected(without, 'a')).toBe(true);
    expect(isSelected(without, 'b')).toBe(false);
    expect(isSelected(without, 'c')).toBe(true);
  });
});

describe('selectAll / clear / count', () => {
  it('selects exactly the VISIBLE ids, never more', () => {
    // A paginated list must not select rows she cannot see — "Mark clean" would then act on
    // garments she never looked at.
    const basket = selectAll(['a', 'b']);
    expect(count(basket)).toBe(2);
    expect(isSelected(basket, 'c')).toBe(false);
  });

  it('clear empties the basket', () => {
    expect(count(clear())).toBe(0);
  });

  it('an empty basket has count 0', () => {
    expect(count(EMPTY_BASKET)).toBe(0);
  });
});

describe('pending — the ids actually submitted', () => {
  it('drops ids that are no longer on screen', () => {
    // The list refetches after every mutation, so a garment can leave the dirty list (marked
    // clean elsewhere, or deleted) while still sitting in the basket. Submitting it would 404.
    const basket = selectAll(['a', 'b', 'c']);
    expect(pending(basket, ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('returns an empty list when nothing selected is still visible', () => {
    expect(pending(selectAll(['a', 'b']), ['z'])).toEqual([]);
  });

  it('is deterministic in order, so a batch is reproducible', () => {
    const basket = toggle(toggle(toggle(EMPTY_BASKET, 'c'), 'a'), 'b');
    expect(pending(basket, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('never returns duplicates even if visibleIds repeats an id', () => {
    expect(pending(selectAll(['a']), ['a', 'a'])).toEqual(['a']);
  });
});

describe('prune — keeps the count honest after a refetch', () => {
  it('removes vanished ids so the action bar cannot overstate what it will do', () => {
    // A bar reading "12 selected" above a list of 9 rows is a lie about the button.
    const pruned = prune(selectAll(['a', 'b', 'c']), ['a']);
    expect(count(pruned)).toBe(1);
    expect(isSelected(pruned, 'a')).toBe(true);
  });

  it('PRESERVES IDENTITY when nothing changed, so it is safe to call from an effect', () => {
    // Returning a fresh object every time would re-trigger any effect keyed on the basket and
    // spin a render loop.
    const basket = selectAll(['a', 'b']);
    expect(prune(basket, ['a', 'b'])).toBe(basket);
    expect(prune(basket, ['a', 'b', 'c'])).toBe(basket);
  });

  it('empties when nothing survives', () => {
    expect(count(prune(selectAll(['a', 'b']), []))).toBe(0);
  });
});
