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

describe('ApiClient — error mapping', () => {
  it('maps a non-2xx to a typed ApiError carrying the server code + status', async () => {
    const { fetchFn } = stubFetch({ code: 'forbidden', message: 'nope' }, 403);
    const err = await makeClient(fetchFn)
      .resolveDedupe({ keep_id: ITEM, discard_id: USER })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe('forbidden');
  });
});
