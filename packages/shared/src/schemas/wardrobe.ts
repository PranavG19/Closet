// Row + request/response schemas for wardrobe_items and parse_jobs (docs/06 §3).
// Row schemas mirror EXACTLY what the repo returns (timestamptz->::text, so
// Timestamptz strings; bigint phash comes back as text from node-pg). Request
// schemas are .strict() (reject unknown keys) and NEVER carry user_id.
import { z } from 'zod';
import {
  Uuid,
  Timestamptz,
  Json,
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
  source_photo_hash: z.string(),
  source_photo_path: z.string(),
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

// parse_jobs create request carries the per-photo idempotency key (source_photo_hash).
export const CreateParseJobRequest = z
  .object({
    source_photo_path: z.string(),
    source_photo_hash: z.string(),
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
