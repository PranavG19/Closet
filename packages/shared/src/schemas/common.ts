// Shared leaf schemas: every column type derives from these so no ad-hoc
// z.string() is used where a uuid/timestamp is meant.
import { z } from 'zod';

// uuid columns (id, user_id, fk columns).
export const Uuid = z.string().uuid();

// timestamptz columns AFTER the repo's `::text` cast — an ISO-8601 string WITH
// an offset (docs/06 §3). Not a Date: the repo returns text, JSON carries text.
export const Timestamptz = z.string().datetime({ offset: true });

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
