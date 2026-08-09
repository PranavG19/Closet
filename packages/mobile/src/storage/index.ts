// The Storage seam: turning a stored object path into something <Image> can load.
// The `cutouts` bucket is private with an RLS policy bound to auth.uid(), so this is a
// signed-URL mint, not a URL concatenation. See cutoutUri.ts.
export { signCutoutUri, signCutoutUris, CUTOUT_URL_TTL_SECONDS } from './cutoutUri.js';
export { useCutoutUris, type CutoutRowLike } from './useCutoutUris.js';
