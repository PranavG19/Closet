// A fake `fetchFn` for the screenshot harness. It routes on the request URL's last
// path segment (matched against ROUTES) and returns canned, schema-VALID JSON, so the
// real ApiClient parses every response through parseBoundary without throwing and each
// screen renders real-looking data — with NO deployed Supabase project and NO provider
// keys.
//
// The canned data is exact on purpose: parseBoundary REJECTS a malformed body, so a
// wrong type (a non-ISO timestamp, a base64-looking source_photo_hash, a URL where a
// storage key is expected) would surface as a thrown boundary error at the screen. The
// harness test (fakeBackend.test.ts) drives each GET through a real ApiClient and
// asserts the parse succeeds — an independent oracle that this data is valid.
import { ROUTES } from '../src/api/routes.js';
import { HARNESS_SESSION } from './fakeAuthPort.js';
// The parse-job fixture lives in fixtures.json (a DATA file), not here: it must carry
// ParseJobRow.source_photo_path (a required field the server response has), but
// src/photo/chokepoint.test.ts flags that literal token in any .ts/.tsx file as the
// client-sends-path SSRF defect. See fixtures.json's _comment for the full reasoning.
// The `with { type: 'json' }` attribute is REQUIRED under this repo's `module: NodeNext`
// (tsc raises TS1543 without it); Metro (0.80+) accepts import attributes too.
import fixtures from './fixtures.json' with { type: 'json' };

const PARSE_JOB = fixtures.parseJob as Record<string, unknown>;

const USER = HARNESS_SESSION.user.userId;
// A fixed instant, ISO-8601 with an offset — Timestamptz is z.string().datetime({offset:true}).
const NOW = '2026-08-01T12:00:00.000Z';

// A stable set of item uuids so outfits / wear-log can reference real ids.
const ITEM_IDS = {
  whiteTop: '11111111-1111-4111-8111-111111111111',
  blackJeans: '22222222-2222-4222-8222-222222222222',
  floralDress: '33333333-3333-4333-8333-333333333333',
  camelCoat: '44444444-4444-4444-8444-444444444444',
  tanBoots: '55555555-5555-4555-8555-555555555555',
  goldNecklace: '66666666-6666-4666-8666-666666666666',
} as const;

const PARSE_JOB_ID = '77777777-7777-4777-8777-777777777777';

// One canned wardrobe row. `cutout_path` is a bucket-relative key of the same
// `{user}/{hash}/cutout` shape the server returns; it is a plain string on this row
// (WardrobeItemRow.cutout_path is z.string().nullable(), not the stricter StorageObjectKey).
interface ItemInput {
  readonly id: string;
  readonly category: 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';
  readonly color: string | null;
  readonly pattern: string | null;
  readonly availability: 'clean' | 'dirty' | 'unavailable';
  readonly withCutout: boolean;
  readonly phash: string | null;
}

function wardrobeItem(input: ItemInput): Record<string, unknown> {
  return {
    id: input.id,
    user_id: USER,
    category: input.category,
    color: input.color,
    pattern: input.pattern,
    attributes: { fit: 'regular', season: 'all' },
    availability: input.availability,
    // A key, never a URL — matches what the server stores; the app signs it separately.
    cutout_path: input.withCutout ? `${USER}/${input.id}/cutout` : null,
    parse_job_id: input.withCutout ? PARSE_JOB_ID : null,
    // int8 dedupe signal comes back as a decimal STRING from node-pg (64-bit).
    phash: input.phash,
    created_at: NOW,
    updated_at: NOW,
  };
}

const WARDROBE_ITEMS: readonly Record<string, unknown>[] = [
  wardrobeItem({ id: ITEM_IDS.whiteTop, category: 'top', color: 'white', pattern: null, availability: 'clean', withCutout: true, phash: '1234567890123456789' }),
  wardrobeItem({ id: ITEM_IDS.blackJeans, category: 'bottom', color: 'black', pattern: null, availability: 'clean', withCutout: true, phash: '2234567890123456789' }),
  wardrobeItem({ id: ITEM_IDS.floralDress, category: 'dress', color: 'rose', pattern: 'floral', availability: 'dirty', withCutout: true, phash: null }),
  wardrobeItem({ id: ITEM_IDS.camelCoat, category: 'outerwear', color: 'camel', pattern: null, availability: 'clean', withCutout: false, phash: null }),
  wardrobeItem({ id: ITEM_IDS.tanBoots, category: 'shoes', color: 'tan', pattern: null, availability: 'unavailable', withCutout: true, phash: null }),
  wardrobeItem({ id: ITEM_IDS.goldNecklace, category: 'accessory', color: 'gold', pattern: null, availability: 'clean', withCutout: false, phash: null }),
];

// item_count matches the outfit_items seed below (outfit[0] has 2 members, outfit[1] has 0),
// so the list card's "N pieces" is honest against the same fixture the export document uses.
// The export parses these through OutfitRow (non-strict), which strips the extra key — so one
// constant serves both the list-with-counts response and the export unchanged.
const OUTFITS: readonly Record<string, unknown>[] = [
  {
    id: '88888888-8888-4888-8888-888888888881',
    user_id: USER,
    name: 'Weekend brunch',
    created_at: NOW,
    updated_at: NOW,
    item_count: 2,
    // The two members' cutout paths (whiteTop + blackJeans both have cutouts), position-ordered
    // — matches the outfit_items seed in the export document below.
    preview_paths: [`${USER}/${ITEM_IDS.whiteTop}/cutout`, `${USER}/${ITEM_IDS.blackJeans}/cutout`],
  },
  { id: '88888888-8888-4888-8888-888888888882', user_id: USER, name: 'Office Monday', created_at: NOW, updated_at: NOW, item_count: 0, preview_paths: [] },
];

export interface FakeBackendOptions {
  // Whether the read-entitlement endpoint reports an active membership. `true` renders
  // the paywall's "you're a member" state; `false` renders the offer state (the fake
  // BillingPort supplies a real offer). Defaults to true.
  readonly entitlementActive?: boolean;
}

// The canned response body per route, given the options. Kept as a plain map so the
// harness test can assert every GET route is covered. `query` carries the parsed request
// query string so listWardrobe can HONOR the F4 category/availability filters — without this
// the grid would render identically for every chip and a filter screenshot would prove
// nothing (a mirror oracle). The real server filters under RLS; here we filter the canned set
// the same way, so the sim shows the genuine reduced page.
function responseFor(
  route: keyof typeof ROUTES,
  options: FakeBackendOptions,
  query: URLSearchParams,
): unknown {
  const entitlementActive = options.entitlementActive ?? true;
  switch (route) {
    case 'listWardrobe': {
      const category = query.get('category');
      const availability = query.get('availability');
      const items = WARDROBE_ITEMS.filter(
        (item) =>
          (category === null || item.category === category) &&
          (availability === null || item.availability === availability),
      );
      return { items, next_cursor: null };
    }
    case 'listOutfits':
      return { outfits: OUTFITS };
    case 'readEntitlement':
      return { entitlement_active: entitlementActive, expires_at: entitlementActive ? '2027-08-01T12:00:00.000Z' : null };
    case 'toggleAvailability':
      // Echo a plausible updated row (the screen invalidates + refetches the list anyway).
      return wardrobeItem({ id: ITEM_IDS.whiteTop, category: 'top', color: 'white', pattern: null, availability: 'dirty', withCutout: true, phash: '1234567890123456789' });
    case 'resolveDedupe':
      return { merged: true };
    case 'createOutfit':
      return { id: '88888888-8888-4888-8888-888888888883', user_id: USER, name: 'New outfit', created_at: NOW, updated_at: NOW };
    case 'logWear':
      return { id: '99999999-9999-4999-8999-999999999991', user_id: USER, item_id: ITEM_IDS.whiteTop, outfit_id: null, worn_at: NOW, client_id: 'harness-client-id' };
    case 'upsertPalette':
      return { user_id: USER, hues: { season: 'autumn', flattering: ['camel', 'rose', 'olive'] } };
    case 'readPalette':
      // The NORMALISED read shape (a flat string[] of family tokens) the real read-palette
      // handler returns — NOT the opaque stored `hues` the upsert echoes. `camel` matches the
      // clean camel coat, so the advisory tie-break is observable in the harness suggestion.
      return { hues: ['camel', 'rose'] };
    case 'parsePhoto':
      return { job: PARSE_JOB, items: [WARDROBE_ITEMS[0]] };
    case 'deleteAccount':
      return {
        deleted: {
          wear_log: 3,
          outfit_items: 4,
          outfits: 2,
          wardrobe_items: 6,
          parse_jobs: 1,
          palette_profile: 1,
          subscriptions: 1,
          total: 18,
        },
      };
    case 'exportMyData':
      return {
        exported_at: NOW,
        user_id: USER,
        wardrobe_items: WARDROBE_ITEMS,
        parse_jobs: [PARSE_JOB],
        outfits: OUTFITS,
        outfit_items: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', outfit_id: OUTFITS[0]!.id, user_id: USER, item_id: ITEM_IDS.whiteTop, slot: 'top', position: 0 },
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', outfit_id: OUTFITS[0]!.id, user_id: USER, item_id: ITEM_IDS.blackJeans, slot: 'bottom', position: 1 },
        ],
        wear_log: [
          { id: '99999999-9999-4999-8999-999999999991', user_id: USER, item_id: ITEM_IDS.whiteTop, outfit_id: null, worn_at: NOW, client_id: 'harness-client-id' },
        ],
        palette_profile: { user_id: USER, hues: { season: 'autumn' } },
        subscription: {
          user_id: USER,
          rc_app_user_id: USER,
          entitlement_active: entitlementActive,
          event_ts: NOW,
          expires_at: entitlementActive ? '2027-08-01T12:00:00.000Z' : null,
          updated_at: NOW,
        },
      };
  }
}

// Resolve a request URL to a ROUTES key by its last path segment (the query is stripped
// first). No path is a suffix of another, so the match is unambiguous.
function routeForUrl(url: string): keyof typeof ROUTES | null {
  const withoutQuery = url.split('?')[0] ?? url;
  for (const name of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
    if (withoutQuery.endsWith(`/${ROUTES[name].path}`)) return name;
  }
  return null;
}

// Build a `fetchFn` the ApiClient can use in place of the global fetch. Every known
// route returns 200 with its canned body; an unknown path returns a 404 shaped as the
// shared ErrorEnvelope so the client's error path stays honest.
export function makeFakeBackend(options: FakeBackendOptions = {}): typeof fetch {
  const fetchFn = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const route = routeForUrl(url);
    const jsonHeaders = { 'content-type': 'application/json' };
    if (route === null) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No such route.' } }), {
        status: 404,
        headers: jsonHeaders,
      });
    }
    const queryString = url.split('?')[1] ?? '';
    const query = new URLSearchParams(queryString);
    return new Response(JSON.stringify(responseFor(route, options, query)), { status: 200, headers: jsonHeaders });
  };
  return fetchFn as unknown as typeof fetch;
}
