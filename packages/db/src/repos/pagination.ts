// The server page-size clamp (docs/06 §4), declared ONCE.
//
// It was declared three times: byte-identical `MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE` + an
// identical `clampLimit` in both wardrobe.repo.ts and wear-log.repo.ts, plus a third pair of
// constants in packages/functions/src/wardrobe/schemas.ts — where the handler clamped a SECOND
// time against its own copy of the numbers.
//
// Three copies of a limit is not a style problem. The clamp is a real server-side guarantee
// (a caller cannot ask for the whole table), and a guarantee that exists in three places is a
// guarantee that can disagree with itself: raise the cap in the repo and the handler still
// truncates to its own stale 100, silently, with no test failing because both numbers are
// individually "correct".
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

// Total by construction: every input maps to an integer in [1, MAX_PAGE_SIZE].
//
// `undefined` (no limit asked for) is the DEFAULT, not the maximum — an unspecified page must
// not become the largest possible query. Anything non-finite or below 1 collapses to 1 rather
// than throwing, because this sits behind a Zod boundary that has already rejected genuinely
// malformed input; the remaining job is to be unsurprising, not to re-litigate validation.
// `Math.floor` before the min so a fractional limit cannot produce a fractional LIMIT clause.
export function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}
