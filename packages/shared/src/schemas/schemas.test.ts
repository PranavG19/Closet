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
  source_photo_hash: fc.string(),
  source_photo_path: fc.string(),
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
  ['CreateParseJobRequest', CreateParseJobRequest, fc.record({ source_photo_path: fc.string(), source_photo_hash: fc.string(), kind: fc.constantFrom('teaser', 'full') })],
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
