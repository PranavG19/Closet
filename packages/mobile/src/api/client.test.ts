// Unit tests for the typed API client. The oracle is NOT the client's own output:
// each test asserts against an independently-constructed expected value and the
// actual bytes captured off a mocked fetch (request URL, headers, body). Covers:
//   - parse-don't-cast: a response missing/!matching its Zod schema THROWS
//     (BoundaryParseError), never returns a half-typed object;
//   - the session JWT is attached as the Bearer;
//   - client_id for a wear-log is passed THROUGH from the caller, never minted or
//     rewritten by the client (the idempotency invariant);
//   - a non-2xx becomes a typed ApiError with the server code.
import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError } from './client.js';
import { ErrorEnvelope } from '@closet/shared';
import type { AppConfig } from './config.js';

const CONFIG: AppConfig = {
  supabaseUrl: 'https://proj.supabase.co',
  supabaseAnonKey: 'anon',
  functionsBaseUrl: 'https://proj.supabase.co/functions/v1',
};

const USER = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ITEM = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const TS = '2026-08-06T12:00:00.000Z';

// A fetch stub returning a fixed JSON body + status, capturing the last call.
function stubFetch(body: unknown, status = 200): {
  fetchFn: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function makeClient(fetchFn: typeof fetch, token: string | null = 'jwt-123'): ApiClient {
  return new ApiClient({ fetchFn, getToken: async () => token, config: CONFIG });
}

const wearRow = {
  id: 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',
  user_id: USER,
  item_id: ITEM,
  outfit_id: null,
  worn_at: TS,
  client_id: 'tap-key-1',
};

describe('ApiClient — bearer + routing', () => {
  it('attaches the session JWT as the Authorization bearer', async () => {
    const { fetchFn, calls } = stubFetch({ outfits: [] });
    await makeClient(fetchFn, 'jwt-abc').listOutfits();
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-abc');
  });

  it('omits the Authorization header when signed out (token null)', async () => {
    const { fetchFn, calls } = stubFetch({ outfits: [] });
    await makeClient(fetchFn, null).listOutfits();
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('appends the route path and the list query string to the base URL', async () => {
    const { fetchFn, calls } = stubFetch({ items: [], next_cursor: null });
    await makeClient(fetchFn).listWardrobe({ availability: 'clean', limit: 20 });
    expect(calls[0]!.url).toBe(
      'https://proj.supabase.co/functions/v1/wardrobe-list?availability=clean&limit=20',
    );
    expect(calls[0]!.init!.method).toBe('GET');
  });
});

describe('ApiClient — wardrobe pagination is followed, not truncated', () => {
  // The server pages at DEFAULT_PAGE_SIZE = 50 and mints a next_cursor whenever a full
  // page comes back (packages/functions/src/wardrobe/list.ts). Before this, mobile
  // parsed next_cursor and then ignored it: a 120-garment closet showed exactly 50
  // items with no spinner, no "load more" and no error, and the other 70 were
  // unreachable anywhere in the app.
  //
  // A multi-page fetch stub. The oracle is the set of item ids the SERVER holds,
  // assembled here independently of what the client returns.
  function stubPagedFetch(pages: { items: unknown[]; next_cursor: string | null }[]): {
    fetchFn: typeof fetch;
    calls: { url: string }[];
  } {
    const calls: { url: string }[] = [];
    let next = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push({ url: String(url) });
      const page = pages[next++]!;
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
  }

  // A minimal real WardrobeItemRow — every field WardrobeItemRow requires, so the rows
  // survive parseBoundary rather than being waved through.
  const itemAt = (n: number): unknown => ({
    id: `b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2${String(n).padStart(2, '0')}`,
    user_id: USER,
    category: 'top',
    color: 'ivory',
    pattern: null,
    attributes: null,
    availability: 'clean',
    cutout_path: null,
    parse_job_id: null,
    phash: null,
    created_at: TS,
    updated_at: TS,
  });

  it('follows next_cursor until it is null and returns EVERY item, not just the first page', async () => {
    const first = [itemAt(1), itemAt(2)];
    const second = [itemAt(3)];
    const { fetchFn, calls } = stubPagedFetch([
      { items: first, next_cursor: 'cursor-page-2' },
      { items: second, next_cursor: null },
    ]);
    const result = await makeClient(fetchFn).listAllWardrobe();

    // Independent oracle: the ids the two server pages held, in server order.
    const idsOnTheWire = [...first, ...second].map((item) => (item as { id: string }).id);
    expect(result.items.map((item) => item.id)).toEqual(idsOnTheWire);
    // The second request must carry the cursor the first response minted.
    expect(new URL(calls[1]!.url).searchParams.get('cursor')).toBe('cursor-page-2');
  });

  it('preserves the caller filters on every page, not just the first', async () => {
    const { fetchFn, calls } = stubPagedFetch([
      { items: [itemAt(1)], next_cursor: 'c2' },
      { items: [itemAt(2)], next_cursor: null },
    ]);
    await makeClient(fetchFn).listAllWardrobe({ availability: 'dirty' });
    // A follow-up page that dropped the filter would silently mix clean items into the
    // Laundry list.
    for (const call of calls) {
      expect(new URL(call.url).searchParams.get('availability')).toBe('dirty');
    }
  });

  it('stops at one request when the first page is the last', async () => {
    const { fetchFn, calls } = stubPagedFetch([{ items: [itemAt(1)], next_cursor: null }]);
    const result = await makeClient(fetchFn).listAllWardrobe();
    expect(calls).toHaveLength(1);
    expect(result.items).toHaveLength(1);
  });
});

describe('ApiClient — parse-don\'t-cast on the response', () => {
  it('returns the typed value when the body matches the schema', async () => {
    const { fetchFn } = stubFetch(wearRow);
    const result = await makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'tap-key-1' });
    // Independent oracle: the row I put on the wire, field by field.
    expect(result).toEqual(wearRow);
  });

  it('THROWS on a response missing a required field (never a half-typed object)', async () => {
    // worn_at removed — WearLogRow requires it. parse-don't-cast must reject.
    const { worn_at, ...broken } = wearRow;
    void worn_at;
    const { fetchFn } = stubFetch(broken);
    await expect(makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'k' })).rejects.toThrow();
  });

  it('THROWS on a wrong-typed field (worn_at not a datetime)', async () => {
    const { fetchFn } = stubFetch({ ...wearRow, worn_at: 'not-a-timestamp' });
    await expect(makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'k' })).rejects.toThrow();
  });
});

describe('ApiClient — client_id passthrough (idempotency invariant)', () => {
  it('sends EXACTLY the caller-minted client_id in the request body, unchanged', async () => {
    const { fetchFn, calls } = stubFetch(wearRow);
    const callerMinted = 'caller-tap-uuid-xyz';
    await makeClient(fetchFn).logWear({ item_id: ITEM, client_id: callerMinted });
    const sentBody = JSON.parse(calls[0]!.init!.body as string) as { client_id: string };
    // The client neither mints nor rewrites the id — a retry would resend this same
    // value so the partial UNIQUE index dedups it.
    expect(sentBody.client_id).toBe(callerMinted);
  });

  it('does not inject a client_id when the caller omits it (request schema rejects)', () => {
    const { fetchFn } = stubFetch(wearRow);
    // LogWearRequest.client_id is required; passing an object without it must throw
    // at the request-parse boundary rather than the client silently minting one.
    // The request is validated synchronously in the method body, so this throws at
    // call time (not as a rejection) — which also proves no network call is made.
    expect(() =>
      // @ts-expect-error — intentionally omitting the required client_id
      makeClient(fetchFn).logWear({ item_id: ITEM }),
    ).toThrow();
  });
});

describe('ApiClient — the wear-log flip channel', () => {
  // The oracle is the SERVER's own reader, not this client's intent:
  // packages/functions/src/wear-log/log-wear.ts does
  // `url.searchParams.get('flip') === 'dirty'`. So the assertion is that the exact
  // string that predicate accepts appears on the wire — anything else is a wear that
  // silently never dirties the garment, which leaves Laundry empty forever and makes
  // Suggestions re-offer what she just told the app she wore.
  const flipIsSetOnWire = (url: string): boolean =>
    new URL(url).searchParams.get('flip') === 'dirty';

  it('sends ?flip=dirty when the caller asks for the flip', async () => {
    const { fetchFn, calls } = stubFetch(wearRow);
    await makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'k' }, { flipToDirty: true });
    expect(flipIsSetOnWire(calls[0]!.url)).toBe(true);
  });

  it('omits the flip by default — logging a PAST wear must not surprise-dirty an item', async () => {
    const { fetchFn, calls } = stubFetch(wearRow);
    await makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'k' });
    expect(new URL(calls[0]!.url).searchParams.has('flip')).toBe(false);
  });

  it('omits the flip when explicitly declined', async () => {
    const { fetchFn, calls } = stubFetch(wearRow);
    await makeClient(fetchFn).logWear({ item_id: ITEM, client_id: 'k' }, { flipToDirty: false });
    expect(new URL(calls[0]!.url).searchParams.has('flip')).toBe(false);
  });
});

describe('ApiClient — error mapping', () => {
  // The body here is built by ErrorEnvelope.parse, NOT hand-typed. That matters: the
  // previous version of this test stubbed a FLAT `{ code, message }` — a shape the
  // server has never sent — and passed, because the client parsed the same wrong shape.
  // Two mirrors agreeing is not a contract. Constructing the fixture through the shared
  // schema means a fixture that drifts from the real envelope cannot even be built.
  const serverErrorBody = (code: string, message: string): unknown =>
    ErrorEnvelope.parse({ error: { code, message } });

  it('maps a non-2xx to a typed ApiError carrying the server code + status', async () => {
    const { fetchFn } = stubFetch(serverErrorBody('forbidden', 'nope'), 403);
    const err = await makeClient(fetchFn)
      .resolveDedupe({ keep_id: ITEM, discard_id: USER })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe('forbidden');
    expect((err as ApiError).message).toBe('nope');
  });

  it('distinguishes the codes a screen needs to branch on', async () => {
    // The regression this whole change exists to prevent: these four all collapsed to
    // 'error' before, making a 402 "you need a subscription" indistinguishable from a
    // 429 "slow down" on device. Each must arrive intact and distinct.
    for (const [status, code] of [
      [402, 'entitlement_required'],
      [402, 'teaser_cap_reached'],
      [429, 'parse_rate_limited'],
      [403, 'forbidden'],
    ] as const) {
      const { fetchFn } = stubFetch(serverErrorBody(code, 'nope'), status);
      const err = await makeClient(fetchFn)
        .resolveDedupe({ keep_id: ITEM, discard_id: USER })
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe(code);
      expect((err as ApiError).status).toBe(status);
    }
  });

  it('falls back to a generic code when the envelope is malformed', async () => {
    // A body that is NOT the envelope must not throw out of the error path — the caller
    // needs the status even when the shape is unrecognisable. Deliberately raw, not
    // schema-built: this is the case where the server sent something unexpected.
    const { fetchFn } = stubFetch({ unexpected: 'shape' }, 500);
    const err = await makeClient(fetchFn)
      .resolveDedupe({ keep_id: ITEM, discard_id: USER })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).code).toBe('error');
    expect((err as ApiError).message).toBe('Request failed.');
  });
});
