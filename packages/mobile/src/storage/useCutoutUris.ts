// react-query hook over signCutoutUris: the signed image URLs for a page of garments.
//
// A SEPARATE QUERY FROM THE WARDROBE ROWS, ON PURPOSE. Signed URLs EXPIRE; wardrobe rows do
// not. Folding the signing into `useWardrobe` would tie the row cache's lifetime to a
// credential's lifetime, so either the rows would refetch pointlessly every hour or the
// URLs would go stale inside a cache that thinks it is fresh. Separate queries let each
// have the staleness it actually has.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getSupabase } from '../api/supabase.js';
import { signCutoutUris, CUTOUT_URL_TTL_SECONDS } from './cutoutUri.js';

export interface CutoutRowLike {
  readonly id: string;
  readonly cutout_path: string | null;
}

// Refresh comfortably before the URLs expire, so a tile never renders a dead link. Half the
// TTL is the standard margin for a bearer token you re-mint rather than refresh.
const REFETCH_MARGIN_MS = (CUTOUT_URL_TTL_SECONDS / 2) * 1000;

export function useCutoutUris(rows: readonly CutoutRowLike[]): UseQueryResult<Readonly<Record<string, string>>> {
  // The key is the set of PATHS, not the row array: the identical closet re-fetched produces
  // a new array instance but the same paths, and keying on identity would re-sign every URL
  // on every render. Sorted so the key is order-independent.
  const paths = rows
    .map((row) => row.cutout_path)
    .filter((path): path is string => path !== null)
    .sort();

  return useQuery({
    queryKey: ['cutout-uris', paths],
    queryFn: () => signCutoutUris(getSupabase(), rows),
    // No point signing nothing — an unparsed closet has no cutouts yet.
    enabled: paths.length > 0,
    staleTime: REFETCH_MARGIN_MS,
    // A failed signing degrades to the placeholder well; retrying hard would just delay the
    // paint. One retry covers a transient network blip.
    retry: 1,
  });
}
