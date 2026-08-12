// Tier-1 (docs/05): round-trip property tests over the row + request/response
// schemas, plus a red-first rejection suite and the invariant guards from task-05 §4.
//
// RED-FIRST NOTE: the rejection cases were first run against loosened stubs
// (e.g. WardrobeItemRow = z.object({}).passthrough(), request schemas without
// .strict()); each malformed/extra-key/user_id case FAILED to reject — proving
// the assertions discriminate a real schema from a permissive one. The real
// schemas then turn them green.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { parseBoundary, parseBoundarySafe, BoundaryParseError } from '../parse.js';
import {
  WardrobeItemRow,
  ParseJobRow,
  CreateWardrobeItemRequest,
  CreateParseJobRequest,
  UpdateAvailabilityRequest,
  WardrobeListResponse,
} from './wardrobe.js';
import {
  OutfitRow,
  OutfitSummary,
  OutfitItemRow,
  WearLogRow,
  CreateOutfitRequest,
  LogWearRequest,
  OutfitListResponse,
} from './outfits.js';
import { PaletteProfileRow, UpsertPaletteRequest } from './profile.js';
import { SubscriptionRow, WebhookEventRow, EntitlementResponse } from './billing.js';

// ---- reusable leaf arbitraries (structurally valid) ----
const arbUuid = fc.uuid();
const arbTs = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
  .map((d) => d.toISOString());
// Exclude the `__proto__` key: JSON.parse and Zod's z.record handle it
// differently (a JS footgun), which is orthogonal to schema-fidelity round-trip.
const arbJson: fc.Arbitrary<unknown> = fc
  .jsonValue()
  .filter((v) => !JSON.stringify(v).includes('__proto__'));

// A per-photo idempotency key: one opaque token, no separators (SourcePhotoHash).
const arbSourcePhotoHash = fc
  .stringMatching(/^[A-Za-z0-9_-]+$/)
  .filter((s) => s.length > 0 && s.length <= 128);
// A bucket-relative Storage KEY (StorageObjectKey): owner-first segments, no scheme,
// no traversal, no leading slash. Built from the real shape parse-photo derives —
// `{user_id}/{hash}/original` — so the property covers what production stores.
const arbStorageObjectKey = fc
  .tuple(arbUuid, arbSourcePhotoHash)
  .map(([owner, hash]) => `${owner}/${hash}/original`);

const arbWardrobeItemRow = fc.record({
  id: arbUuid,
  user_id: arbUuid,
  category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
  color: fc.option(fc.string(), { nil: null }),
  pattern: fc.option(fc.string(), { nil: null }),
  attributes: fc.option(arbJson, { nil: null }),
  availability: fc.constantFrom('clean', 'dirty', 'unavailable'),
  cutout_path: fc.option(fc.string(), { nil: null }),
  parse_job_id: fc.option(arbUuid, { nil: null }),
  phash: fc.option(fc.string(), { nil: null }),
  created_at: arbTs,
  updated_at: arbTs,
});

const arbParseJobRow = fc.record({
  id: arbUuid,
  user_id: arbUuid,
  source_photo_hash: arbSourcePhotoHash,
  source_photo_path: arbStorageObjectKey,
  kind: fc.constantFrom('teaser', 'full'),
  status: fc.constantFrom('pending', 'processing', 'done', 'failed'),
  claimed_at: fc.option(arbTs, { nil: null }),
  error_reason: fc.option(fc.string(), { nil: null }),
  created_at: arbTs,
  updated_at: arbTs,
});

const arbOutfitRow = fc.record({
  id: arbUuid,
  user_id: arbUuid,
  name: fc.option(fc.string(), { nil: null }),
  created_at: arbTs,
  updated_at: arbTs,
});

const arbOutfitSummary = fc.record({
  id: arbUuid,
  user_id: arbUuid,
  name: fc.option(fc.string(), { nil: null }),
  created_at: arbTs,
  updated_at: arbTs,
  item_count: fc.nat({ max: 50 }),
});

const arbOutfitItemRow = fc.record({
  id: arbUuid,
  outfit_id: arbUuid,
  user_id: arbUuid,
  item_id: arbUuid,
  slot: fc.option(fc.string(), { nil: null }),
  position: fc.option(fc.integer(), { nil: null }),
});

const arbWearLogRow = fc.record({
  id: arbUuid,
  user_id: arbUuid,
  item_id: arbUuid,
  outfit_id: fc.option(arbUuid, { nil: null }),
  worn_at: arbTs,
  client_id: fc.string(),
});

const arbPaletteProfileRow = fc.record({ user_id: arbUuid, hues: arbJson });

const arbSubscriptionRow = fc.record({
  user_id: arbUuid,
  rc_app_user_id: fc.option(fc.string(), { nil: null }),
  entitlement_active: fc.boolean(),
  event_ts: fc.option(arbTs, { nil: null }),
  expires_at: fc.option(arbTs, { nil: null }),
  updated_at: arbTs,
});

const arbWebhookEventRow = fc.record({ event_id: fc.string(), received_at: arbTs });

// (schema, arbitrary) pairs — the round-trip property runs over each.
const ROW_CASES: ReadonlyArray<[string, z.ZodType, fc.Arbitrary<unknown>]> = [
  ['WardrobeItemRow', WardrobeItemRow, arbWardrobeItemRow],
  ['ParseJobRow', ParseJobRow, arbParseJobRow],
  ['OutfitRow', OutfitRow, arbOutfitRow],
  ['OutfitSummary', OutfitSummary, arbOutfitSummary],
  ['OutfitItemRow', OutfitItemRow, arbOutfitItemRow],
  ['WearLogRow', WearLogRow, arbWearLogRow],
  ['PaletteProfileRow', PaletteProfileRow, arbPaletteProfileRow],
  ['SubscriptionRow', SubscriptionRow, arbSubscriptionRow],
  ['WebhookEventRow', WebhookEventRow, arbWebhookEventRow],
];

describe('row schemas — round-trip property (parse(x) deep-equals x)', () => {
  for (const [name, schema, arb] of ROW_CASES) {
    it(`${name} round-trips over 1000 generated rows`, () => {
      fc.assert(
        fc.property(arb, (x) => {
          // parse(serialize(x)) === serialize(x): a real boundary receives the
          // JSON-deserialized form, so canonicalize both sides (JSON collapses -0→0).
          const canonical = JSON.parse(JSON.stringify(x));
          expect(parseBoundary(schema, canonical)).toEqual(canonical);
        }),
        { numRuns: 1000 },
      );
    });
  }
});

// ---- request schema round-trip ----
const arbCreateWardrobeItem = fc.record(
  {
    category: fc.constantFrom('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'),
    color: fc.option(fc.string(), { nil: null }),
    pattern: fc.option(fc.string(), { nil: null }),
    attributes: arbJson,
    cutout_path: fc.option(fc.string(), { nil: null }),
    parse_job_id: fc.option(arbUuid, { nil: null }),
  },
  { requiredKeys: ['category'] },
);

const arbCreateOutfit = fc.record(
  {
    name: fc.option(fc.string(), { nil: null }),
    items: fc.array(
      fc.record(
        { item_id: arbUuid, slot: fc.option(fc.string(), { nil: null }), position: fc.option(fc.integer(), { nil: null }) },
        { requiredKeys: ['item_id'] },
      ),
    ),
  },
  { requiredKeys: ['items'] },
);

const arbLogWear = fc.record(
  { item_id: arbUuid, outfit_id: fc.option(arbUuid, { nil: null }), client_id: fc.string() },
  { requiredKeys: ['item_id', 'client_id'] },
);

const REQUEST_CASES: ReadonlyArray<[string, z.ZodType, fc.Arbitrary<unknown>]> = [
  ['CreateWardrobeItemRequest', CreateWardrobeItemRequest, arbCreateWardrobeItem],
  ['CreateParseJobRequest', CreateParseJobRequest, fc.record({ source_photo_hash: arbSourcePhotoHash, kind: fc.constantFrom('teaser', 'full') })],
  ['CreateOutfitRequest', CreateOutfitRequest, arbCreateOutfit],
  ['LogWearRequest', LogWearRequest, arbLogWear],
  ['UpdateAvailabilityRequest', UpdateAvailabilityRequest, fc.record({ item_id: arbUuid, availability: fc.constantFrom('clean', 'dirty', 'unavailable') })],
  ['UpsertPaletteRequest', UpsertPaletteRequest, fc.record({ hues: arbJson })],
];

describe('request schemas — round-trip property', () => {
  for (const [name, schema, arb] of REQUEST_CASES) {
    it(`${name} accepts and round-trips valid bodies`, () => {
      fc.assert(
        fc.property(arb, (x) => {
          const canonical = JSON.parse(JSON.stringify(x));
          expect(parseBoundary(schema, canonical)).toEqual(canonical);
        }),
        { numRuns: 500 },
      );
    });
  }
});

describe('rejection property (red-first) — perturb one field into invalid', () => {
  it('a non-uuid id makes every id-bearing row reject', () => {
    fc.assert(
      fc.property(arbWardrobeItemRow, (x) => {
        const broken = { ...x, id: 'not-a-uuid' };
        expect(() => parseBoundary(WardrobeItemRow, broken)).toThrow(BoundaryParseError);
        expect(parseBoundarySafe(WardrobeItemRow, broken).ok).toBe(false);
      }),
    );
  });

  it('an out-of-set enum rejects', () => {
    fc.assert(
      fc.property(arbWardrobeItemRow, (x) => {
        const broken = { ...x, category: 'spaceship' };
        expect(parseBoundarySafe(WardrobeItemRow, broken).ok).toBe(false);
      }),
    );
  });

  it('a date without a time component rejects (timestamptz needs offset)', () => {
    fc.assert(
      fc.property(arbWardrobeItemRow, (x) => {
        const broken = { ...x, created_at: '2026-01-01' };
        expect(parseBoundarySafe(WardrobeItemRow, broken).ok).toBe(false);
      }),
    );
  });

  it('a missing required key rejects', () => {
    const { id, ...rest } = { id: '550e8400-e29b-41d4-a716-446655440000', kind: 'teaser', source_photo_hash: 'h', source_photo_path: 'p', user_id: '550e8400-e29b-41d4-a716-446655440000', status: 'pending', claimed_at: null, error_reason: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    void id;
    expect(parseBoundarySafe(ParseJobRow, rest).ok).toBe(false);
  });
});

// ---- task-05 §4 invariant guards ----
const REQUEST_SCHEMAS: ReadonlyArray<[string, z.ZodObject]> = [
  ['CreateWardrobeItemRequest', CreateWardrobeItemRequest],
  ['CreateParseJobRequest', CreateParseJobRequest],
  ['CreateOutfitRequest', CreateOutfitRequest],
  ['LogWearRequest', LogWearRequest],
  ['UpdateAvailabilityRequest', UpdateAvailabilityRequest],
  ['UpsertPaletteRequest', UpsertPaletteRequest],
];

describe('invariant — user_id never appears on a request schema', () => {
  for (const [name, schema] of REQUEST_SCHEMAS) {
    it(`${name} has no user_id key`, () => {
      expect(Object.keys(schema.shape)).not.toContain('user_id');
    });
  }
});

// ---- the source-photo path is not a client-nameable field --------------------
// parse-photo hands the ORIGINAL to GPT-4o / Photoroom as a URL their OWN servers
// fetch, so Storage RLS (migration 0013) does not govern that fetch at all: a
// client-named path is a cross-tenant photo read, an SSRF sink, and unbounded spend.
// The structural fix is that the field does not exist on the request, and that the
// row-level type refuses anything that is not a bucket-relative key.
describe('invariant — source_photo_path is server-derived, never client-named', () => {
  it('CreateParseJobRequest has NO source_photo_path key at all', () => {
    expect(Object.keys(CreateParseJobRequest.shape)).not.toContain('source_photo_path');
  });

  it('a smuggled source_photo_path is REJECTED, not ignored (.strict())', () => {
    const res = parseBoundarySafe(CreateParseJobRequest, {
      source_photo_hash: 'HASH1',
      kind: 'teaser',
      // Another tenant's prefix — the whole attack, in one key.
      source_photo_path: 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2/job/photo.jpg',
    });
    expect(res.ok).toBe(false);
  });

  // A hash is a path SEGMENT once derived, so a hash carrying a separator would let
  // the caller steer the derived key. Each of these must fail on the way IN.
  it.each([
    ['a slash (would add a path segment)', '../../b2b2b2b2/job'],
    ['a traversal', '..'],
    ['a scheme', 'https://evil/x.jpg'],
    ['a leading slash', '/etc/passwd'],
    ['a backslash', 'a\\b'],
    ['an empty string', ''],
    ['an over-long token', 'x'.repeat(129)],
  ])('CreateParseJobRequest rejects a source_photo_hash containing %s', (_label, hash) => {
    expect(parseBoundarySafe(CreateParseJobRequest, { source_photo_hash: hash, kind: 'teaser' }).ok).toBe(false);
  });

  // The row type is the second control: even if a row somehow held a URL-shaped
  // value, it must not survive the boundary and reach a vendor.
  const validRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    source_photo_hash: 'HASH1',
    source_photo_path: '550e8400-e29b-41d4-a716-446655440000/HASH1/original',
    kind: 'teaser',
    status: 'pending',
    claimed_at: null,
    error_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('the derived-shape row is accepted (the control — these rejections are not vacuous)', () => {
    expect(parseBoundarySafe(ParseJobRow, validRow).ok).toBe(true);
  });

  it.each([
    ['an http scheme', 'https://evil.example/x.jpg'],
    ['a bare scheme separator', 'a://b'],
    ['a traversal segment', 'a/../../b/original'],
    ['a leading slash', '/550e8400-e29b-41d4-a716-446655440000/HASH1/original'],
    ['a backslash', 'a\\b\\original'],
    ['a metadata-endpoint url', 'http://169.254.169.254/latest/meta-data/'],
    ['an over-long key', `${'a'.repeat(513)}/original`],
  ])('ParseJobRow.source_photo_path rejects %s', (_label, path) => {
    expect(parseBoundarySafe(ParseJobRow, { ...validRow, source_photo_path: path }).ok).toBe(false);
  });
});

describe('invariant — idempotency-key placement', () => {
  it('CreateWardrobeItemRequest has no source_photo_hash idempotency key', () => {
    expect(Object.keys(CreateWardrobeItemRequest.shape)).not.toContain('source_photo_hash');
  });
  it('CreateParseJobRequest carries the per-photo source_photo_hash', () => {
    expect(Object.keys(CreateParseJobRequest.shape)).toContain('source_photo_hash');
  });
});

describe('invariant — strict requests reject unknown keys', () => {
  it('CreateOutfitRequest rejects an extra key', () => {
    const res = parseBoundarySafe(CreateOutfitRequest, { items: [], surprise: 1 });
    expect(res.ok).toBe(false);
  });
  it('CreateOutfitRequest rejects a smuggled user_id', () => {
    const res = parseBoundarySafe(CreateOutfitRequest, { items: [], user_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(res.ok).toBe(false);
  });
});

describe('empty is valid, not an error', () => {
  it('WardrobeListResponse accepts items: []', () => {
    expect(parseBoundary(WardrobeListResponse, { items: [] })).toEqual({ items: [] });
  });
  it('OutfitListResponse accepts outfits: []', () => {
    expect(parseBoundary(OutfitListResponse, { outfits: [] })).toEqual({ outfits: [] });
  });
  it('CreateOutfitRequest accepts items: []', () => {
    expect(parseBoundary(CreateOutfitRequest, { items: [] })).toEqual({ items: [] });
  });
});

describe('response schemas round-trip', () => {
  it('EntitlementResponse round-trips', () => {
    fc.assert(
      fc.property(
        fc.record({ entitlement_active: fc.boolean(), expires_at: fc.option(arbTs, { nil: null }) }),
        (x) => {
          expect(parseBoundary(EntitlementResponse, x)).toEqual(x);
        },
      ),
    );
  });
  it('WardrobeListResponse round-trips with generated items', () => {
    fc.assert(
      fc.property(fc.array(arbWardrobeItemRow), (items) => {
        const canonical = JSON.parse(JSON.stringify({ items }));
        expect(parseBoundary(WardrobeListResponse, canonical)).toEqual(canonical);
      }),
      { numRuns: 200 },
    );
  });
});
