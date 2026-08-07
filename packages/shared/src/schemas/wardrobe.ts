// Row + request/response schemas for wardrobe_items and parse_jobs (docs/06 §3).
// Row schemas mirror EXACTLY what the repo returns (timestamptz->::text, so
// Timestamptz strings; bigint phash comes back as text from node-pg). Request
// schemas are .strict() (reject unknown keys) and NEVER carry user_id.
import { z } from 'zod';
import {
  Uuid,
  Timestamptz,
  Json,
  StorageObjectKey,
  SourcePhotoHash,
  WardrobeCategory,
  Availability,
  ParseJobKind,
  ParseJobStatus,
} from './common.js';

export const WardrobeItemRow = z.object({
  id: Uuid,
  user_id: Uuid,
  category: WardrobeCategory,
  color: z.string().nullable(),
  pattern: z.string().nullable(),
  attributes: Json.nullable(),
  availability: Availability,
  cutout_path: z.string().nullable(),
  parse_job_id: Uuid.nullable(),
  // bigint dedupe signal; node-pg returns int8 as a decimal string (64-bit
  // exceeds JS safe-integer range, so it is NOT cast to ::float).
  phash: z.string().nullable(),
  created_at: Timestamptz,
  updated_at: Timestamptz,
});
export type WardrobeItemRow = z.infer<typeof WardrobeItemRow>;

export const ParseJobRow = z.object({
  id: Uuid,
  user_id: Uuid,
  source_photo_hash: SourcePhotoHash,
  // A bucket-relative Storage KEY, server-derived as `{user_id}/{hash}/original`.
  // Constrained on the way OUT of the DB too: this column is the only thing that
  // ever names the ORIGINAL photo a paid provider reads, so a row that somehow
  // holds a URL-shaped or traversing value must fail the boundary rather than be
  // handed onward.
  source_photo_path: StorageObjectKey,
  kind: ParseJobKind,
  status: ParseJobStatus,
  claimed_at: Timestamptz.nullable(),
  error_reason: z.string().nullable(),
  created_at: Timestamptz,
  updated_at: Timestamptz,
});
export type ParseJobRow = z.infer<typeof ParseJobRow>;

// wardrobe_items create path carries NO idempotency key (idempotency lives on
// parse_jobs, per photo — a UNIQUE on items would cap every photo at one garment).
export const CreateWardrobeItemRequest = z
  .object({
    category: WardrobeCategory,
    color: z.string().nullable().optional(),
    pattern: z.string().nullable().optional(),
    attributes: Json.optional(),
    cutout_path: z.string().nullable().optional(),
    parse_job_id: Uuid.nullable().optional(),
  })
  .strict();
export type CreateWardrobeItemRequest = z.infer<typeof CreateWardrobeItemRequest>;

// parse_jobs create request carries the per-photo idempotency key (source_photo_hash)
// and NOTHING that names a storage location.
//
// `source_photo_path` is DELIBERATELY ABSENT (and .strict() rejects it if sent). The
// path is a security boundary: parse-photo hands it to GPT-4o and Photoroom, whose
// servers do the FETCH, so a client-named path is a cross-tenant photo read and an
// SSRF sink that Storage RLS cannot stop — RLS governs `storage.objects` access by
// app_user, not what a third party fetches from a URL we gave it. The server derives
// the key from the verified JWT `sub` + this hash instead (sourcePhotoObjectKey), so
// naming another tenant's object is not representable rather than merely rejected.
// This mirrors the cutout path, which has always been composed server-side.
export const CreateParseJobRequest = z
  .object({
    source_photo_hash: SourcePhotoHash,
    kind: ParseJobKind,
  })
  .strict();
export type CreateParseJobRequest = z.infer<typeof CreateParseJobRequest>;

// F7 availability toggle.
export const UpdateAvailabilityRequest = z
  .object({
    item_id: Uuid,
    availability: Availability,
  })
  .strict();
export type UpdateAvailabilityRequest = z.infer<typeof UpdateAvailabilityRequest>;

export const WardrobeListResponse = z.object({
  items: z.array(WardrobeItemRow),
});
export type WardrobeListResponse = z.infer<typeof WardrobeListResponse>;
