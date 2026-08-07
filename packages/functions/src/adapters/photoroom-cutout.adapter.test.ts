// Independent oracle for the Photoroom cutout adapter. Pure/mocked: an INJECTED
// fake fetch returns recorded cutout bytes and an INJECTED storage-writer reports
// the stored path/dimensions; NO real network, NO real Storage. Proves the happy
// path, parse-don't-cast (a bad stored result → BoundaryParseError at the boundary),
// the timeout, bounded retry on 429/5xx, and key handling.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BoundaryParseError } from '@closet/shared';
import { makePhotoroomCutoutAdapter, type StoredCutout } from './photoroom-cutout.adapter.js';
import type { FetchFn } from './http.js';

const GOOD_STORED: StoredCutout = {
  imageUrl: 'user-1/job-1/cutout.png',
  hasAlpha: true,
  width: 1024,
  height: 1536,
};

function pngResponse(status = 200, byteLength = 8): Response {
  return new Response(new Uint8Array(byteLength), {
    status,
    headers: { 'content-type': 'image/png' },
  });
}

const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('photoroom-cutout adapter — happy path', () => {
  it('returns a schema-valid CutoutResult from recorded bytes + injected storage-writer', async () => {
    const fetchFn: FetchFn = vi.fn(async () => pngResponse());
    const storeCutout = vi.fn(async () => GOOD_STORED);
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout,
      ...fastTransport,
    });

    const result = await adapter.removeBackground({ imageUrl: 'https://s/x.jpg' });

    expect(result).toEqual(GOOD_STORED);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(storeCutout).toHaveBeenCalledTimes(1);
    // The writer receives the vendor bytes + content-type, never a bucket URL.
    const [passed] = storeCutout.mock.calls[0]!;
    expect(passed.bytes.byteLength).toBeGreaterThan(0);
    expect(passed.contentType).toBe('image/png');
  });
});

describe('photoroom-cutout adapter — parse-don\'t-cast', () => {
  it('throws BoundaryParseError when the stored result has a non-positive dimension', async () => {
    const fetchFn: FetchFn = vi.fn(async () => pngResponse());
    const storeCutout = vi.fn(async () => ({ ...GOOD_STORED, width: 0 }));
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout,
      ...fastTransport,
    });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('throws BoundaryParseError when the stored result is missing hasAlpha', async () => {
    const fetchFn: FetchFn = vi.fn(async () => pngResponse());
    const { hasAlpha, ...withoutAlpha } = GOOD_STORED;
    void hasAlpha;
    const storeCutout = vi.fn(async () => withoutAlpha as unknown as StoredCutout);
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout,
      ...fastTransport,
    });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('throws when the vendor returns empty cutout bytes (before storage)', async () => {
    const fetchFn: FetchFn = vi.fn(async () => pngResponse(200, 0));
    const storeCutout = vi.fn(async () => GOOD_STORED);
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout,
      ...fastTransport,
    });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
    expect(storeCutout).not.toHaveBeenCalled();
  });
});

describe('photoroom-cutout adapter — timeout', () => {
  it('rejects when the fetch never resolves and the AbortController fires', async () => {
    const fetchFn: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout: async () => GOOD_STORED,
      timeoutMs: 5,
      ...fastTransport,
    });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
  });
});

describe('photoroom-cutout adapter — bounded retry', () => {
  it('succeeds after a 429 then 200', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(pngResponse(429))
      .mockResolvedValueOnce(pngResponse(200));
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout: async () => GOOD_STORED,
      maxRetries: 2,
      ...fastTransport,
    });

    const result = await adapter.removeBackground({ imageUrl: 'https://s/x.jpg' });

    expect(result).toEqual(GOOD_STORED);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting retries on persistent 5xx (1 + maxRetries calls)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => pngResponse(500));
    const adapter = makePhotoroomCutoutAdapter({
      apiKey: 'pr-test',
      fetchFn,
      storeCutout: async () => GOOD_STORED,
      maxRetries: 2,
      ...fastTransport,
    });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('photoroom-cutout adapter — key + storage-writer wiring', () => {
  it('throws a clear "missing required env" when PHOTOROOM_API_KEY is unset', async () => {
    const previous = process.env['PHOTOROOM_API_KEY'];
    delete process.env['PHOTOROOM_API_KEY'];
    try {
      const fetchFn: FetchFn = vi.fn(async () => pngResponse());
      const adapter = makePhotoroomCutoutAdapter({
        fetchFn,
        storeCutout: async () => GOOD_STORED,
        ...fastTransport,
      });

      await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toThrow(
        /missing required env: PHOTOROOM_API_KEY/,
      );
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env['PHOTOROOM_API_KEY'] = previous;
    }
  });

  it('the default (unwired) storage-writer throws → surfaces as a provider failure', async () => {
    const fetchFn: FetchFn = vi.fn(async () => pngResponse());
    // No storeCutout injected → the default unwired writer throws.
    const adapter = makePhotoroomCutoutAdapter({ apiKey: 'pr-test', fetchFn, ...fastTransport });

    await expect(adapter.removeBackground({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
  });
});
