// Shared leaf schemas: every column type derives from these so no ad-hoc
// z.string() is used where a uuid/timestamp is meant.
import { z } from 'zod';

// uuid columns (id, user_id, fk columns).
export const Uuid = z.string().uuid();

// timestamptz columns AFTER the repo's `::text` cast — an ISO-8601 string WITH
// an offset (docs/06 §3). Not a Date: the repo returns text, JSON carries text.
export const Timestamptz = z.string().datetime({ offset: true });

// A Storage object KEY (bucket-relative name), never a URL. Migration 0013 binds
// `(storage.foldername(name))[1] = auth.uid()::text`, so the first path segment IS
// the owner and this value is a SECURITY BOUNDARY, not a naming convention.
//
// The allowlist is positive on purpose: anything a key does not need is
// unrepresentable rather than merely checked. It therefore cannot carry a URL scheme
// (`:` is absent from the set, so `https://evil/x.jpg` cannot parse), cannot re-root
// (a leading `/` is excluded by the anchored first character), and cannot smuggle a
// backslash some client would later normalize into `/`. `..` is refused separately
// because the character class alone would admit it. Bounded so an over-long key can
// never become an unbounded string on a vendor URL.
const STORAGE_OBJECT_KEY_MAX = 512;
const STORAGE_OBJECT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
export const StorageObjectKey = z
  .string()
  .max(STORAGE_OBJECT_KEY_MAX)
  .regex(STORAGE_OBJECT_KEY_RE)
  .refine((key) => !key.includes('..'), { message: 'must not contain a traversal segment' });

// The per-photo idempotency key, computed on-device (docs/06 §2). It is ALSO a
// derived path segment (parse-photo composes `{user_id}/{hash}/original`), so it is
// held to a single opaque token: no `/`, no `.`, no `:` — one hash can therefore
// never widen into a second path segment, a traversal, or a URL.
const SOURCE_PHOTO_HASH_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const SourcePhotoHash = z.string().regex(SOURCE_PHOTO_HASH_RE);

// Arbitrary JSON value, for `jsonb` columns (wardrobe_items.attributes,
// palette_profile.hues). Recursive so nested objects/arrays are allowed.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export const Json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(Json),
    z.record(z.string(), Json),
  ]),
);

// Cross-table enums (docs/06 §3 CHECK constraints).
export const WardrobeCategory = z.enum([
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
]);
export type WardrobeCategory = z.infer<typeof WardrobeCategory>;

export const Availability = z.enum(['clean', 'dirty', 'unavailable']);
export type Availability = z.infer<typeof Availability>;

export const ParseJobKind = z.enum(['teaser', 'full']);
export type ParseJobKind = z.infer<typeof ParseJobKind>;

export const ParseJobStatus = z.enum(['pending', 'processing', 'done', 'failed']);
export type ParseJobStatus = z.infer<typeof ParseJobStatus>;
