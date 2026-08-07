// The two account endpoints, driven through a mocked fetch. Same discipline as
// client.test.ts: the oracle is the bytes I put on the wire and an independently
// hand-written expected value — never the client's own output.
//
// These two are the highest-stakes calls in the app (one is irreversible, the other
// hands over every row she owns), so the tests are weighted toward what must NOT
// happen: no purge without the exact confirm literal, no malformed export accepted.
import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from './client.js';
import type { AppConfig } from './config.js';
import { summarizeExport, serializeExport } from '../account/exportDocument.js';

const CONFIG: AppConfig = {
  supabaseUrl: 'https://proj.supabase.co',
  supabaseAnonKey: 'anon',
  functionsBaseUrl: 'https://proj.supabase.co/functions/v1',
};

const USER = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ITEM = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
const OUTFIT = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
const TS = '2026-08-07T12:00:00.000Z';

function stubFetch(
  body: unknown,
  status = 200,
): { fetchFn: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
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

// A well-formed purge receipt whose counts are internally consistent.
const deleteResult = {
  deleted: {
    wear_log: 12,
    outfit_items: 6,
    outfits: 3,
    wardrobe_items: 9,
    parse_jobs: 4,
    palette_profile: 1,
    subscriptions: 1,
    total: 36,
  },
};

const wardrobeItem = {
  id: ITEM,
  user_id: USER,
  category: 'top',
  color: 'ecru',
  pattern: null,
  attributes: null,
  availability: 'clean',
  cutout_path: 'cutouts/a/b.png',
  parse_job_id: null,
  phash: '18446744073709551615',
  created_at: TS,
  updated_at: TS,
};

const exportDocument = {
  exported_at: TS,
  user_id: USER,
  wardrobe_items: [wardrobeItem],
  parse_jobs: [],
  outfits: [{ id: OUTFIT, user_id: USER, name: 'Friday', created_at: TS, updated_at: TS }],
  outfit_items: [
    { id: 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', outfit_id: OUTFIT, user_id: USER, item_id: ITEM, slot: 'top', position: 0 },
  ],
  wear_log: [
    { id: 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', user_id: USER, item_id: ITEM, outfit_id: null, worn_at: TS, client_id: 'tap-1' },
  ],
  palette_profile: null,
  subscription: null,
};

describe('deleteAccount — the irreversible endpoint', () => {
  it('POSTs to account-delete with exactly { confirm: "DELETE" }', async () => {
    const { fetchFn, calls } = stubFetch(deleteResult);
    await makeClient(fetchFn).deleteAccount('DELETE');
    expect(calls[0]!.url).toBe('https://proj.supabase.co/functions/v1/account-delete');
    expect(calls[0]!.init!.method).toBe('POST');
    // Oracle: the exact body the server's .strict() z.literal schema accepts.
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ confirm: 'DELETE' });
  });

  it('attaches the session bearer (identity is the verified sub, not a body field)', async () => {
    const { fetchFn, calls } = stubFetch(deleteResult);
    await makeClient(fetchFn, 'jwt-hers').deleteAccount('DELETE');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-hers');
    // No user id anywhere in the body — targeting another tenant is unrepresentable.
    expect(calls[0]!.init!.body as string).not.toContain(USER);
  });

  it('returns the parsed purge counts', async () => {
    const { fetchFn } = stubFetch(deleteResult);
    // Oracle: the receipt I put on the wire, field for field.
    await expect(makeClient(fetchFn).deleteAccount('DELETE')).resolves.toEqual(deleteResult);
  });

  it('THROWS BEFORE ANY NETWORK CALL on a wrong confirm value', () => {
    const { fetchFn, calls } = stubFetch(deleteResult);
    // @ts-expect-error — 'delete' is not the 'DELETE' literal; this is the runtime
    // half of the same guard, proving a bypassed type check still cannot fire a purge.
    expect(() => makeClient(fetchFn).deleteAccount('delete')).toThrow();
    // The critical assertion: nothing was sent.
    expect(calls.length).toBe(0);
  });

  it('THROWS BEFORE ANY NETWORK CALL on an empty/undefined confirm', () => {
    const { fetchFn, calls } = stubFetch(deleteResult);
    // @ts-expect-error — intentionally invalid confirm
    expect(() => makeClient(fetchFn).deleteAccount('')).toThrow();
    // @ts-expect-error — intentionally missing confirm
    expect(() => makeClient(fetchFn).deleteAccount(undefined)).toThrow();
    expect(calls.length).toBe(0);
  });

  it('parse-don\'t-cast: THROWS on a receipt missing a count (never a half-typed result)', async () => {
    const { total, ...missingTotal } = deleteResult.deleted;
    void total;
    const { fetchFn } = stubFetch({ deleted: missingTotal });
    await expect(makeClient(fetchFn).deleteAccount('DELETE')).rejects.toThrow();
  });

  it('parse-don\'t-cast: THROWS on a negative or fractional count', async () => {
    const negative = stubFetch({ deleted: { ...deleteResult.deleted, outfits: -1 } });
    await expect(makeClient(negative.fetchFn).deleteAccount('DELETE')).rejects.toThrow();
    const fractional = stubFetch({ deleted: { ...deleteResult.deleted, outfits: 1.5 } });
    await expect(makeClient(fractional.fetchFn).deleteAccount('DELETE')).rejects.toThrow();
  });

  it('parse-don\'t-cast: THROWS on a bare 200 with no body (a "probably worked" 200)', async () => {
    const { fetchFn } = stubFetch({});
    await expect(makeClient(fetchFn).deleteAccount('DELETE')).rejects.toThrow();
  });
});

describe('exportMyData — the subject-access document', () => {
  it('GETs account-export with the session bearer and no body', async () => {
    const { fetchFn, calls } = stubFetch(exportDocument);
    await makeClient(fetchFn, 'jwt-hers').exportMyData();
    expect(calls[0]!.url).toBe('https://proj.supabase.co/functions/v1/account-export');
    expect(calls[0]!.init!.method).toBe('GET');
    expect(calls[0]!.init!.body).toBeUndefined();
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-hers');
  });

  it('returns the parsed document', async () => {
    const { fetchFn } = stubFetch(exportDocument);
    await expect(makeClient(fetchFn).exportMyData()).resolves.toEqual(exportDocument);
  });

  it('parse-don\'t-cast: THROWS on a raw timestamptz (space instead of T)', async () => {
    // The exact projection-drift bug the egress parse exists to catch.
    const { fetchFn } = stubFetch({ ...exportDocument, exported_at: '2026-08-07 12:00:00+00' });
    await expect(makeClient(fetchFn).exportMyData()).rejects.toThrow();
  });

  it('parse-don\'t-cast: THROWS when a row array is missing a required field', async () => {
    const { availability, ...brokenItem } = wardrobeItem;
    void availability;
    const { fetchFn } = stubFetch({ ...exportDocument, wardrobe_items: [brokenItem] });
    await expect(makeClient(fetchFn).exportMyData()).rejects.toThrow();
  });

  it('parse-don\'t-cast: THROWS when a 1:1 table key is OMITTED rather than null', async () => {
    // Absent-as-null is the contract; an omitted key is a drifted response, and
    // accepting it would silently claim "no colour profile" for someone who has one.
    const { palette_profile, ...omitted } = exportDocument;
    void palette_profile;
    const { fetchFn } = stubFetch(omitted);
    await expect(makeClient(fetchFn).exportMyData()).rejects.toThrow();
  });

  it('parse-don\'t-cast: THROWS when phash comes back as a lossy number', async () => {
    // A 64-bit bigint widened to a JS number loses precision; the schema says string.
    const { fetchFn } = stubFetch({
      ...exportDocument,
      wardrobe_items: [{ ...wardrobeItem, phash: 18446744073709551615 }],
    });
    await expect(makeClient(fetchFn).exportMyData()).rejects.toThrow();
  });
});

describe('export presentation helpers', () => {
  it('summarizes the document with counts computed independently of the helper', async () => {
    const { fetchFn } = stubFetch(exportDocument);
    const document = await makeClient(fetchFn).exportMyData();
    // Oracle: the counts read off the fixture above by hand.
    expect(summarizeExport(document)).toEqual({
      wardrobeItems: 1,
      parseJobs: 0,
      outfits: 1,
      wearLogEntries: 1,
      hasPalette: false,
      hasSubscription: false,
    });
  });

  it('serializes to JSON that round-trips back to the same document', async () => {
    const { fetchFn } = stubFetch(exportDocument);
    const document = await makeClient(fetchFn).exportMyData();
    const text = serializeExport(document);
    expect(JSON.parse(text)).toEqual(exportDocument);
    // Pretty-printed: a subject-access response is meant to be read by a person.
    expect(text).toContain('\n  ');
  });
});
