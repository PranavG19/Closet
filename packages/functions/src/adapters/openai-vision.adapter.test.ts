// Independent oracle for the OpenAI vision adapter. Pure/mocked: an INJECTED fake
// fetch returns recorded GPT-4o payloads; NO real network. Proves the happy path,
// parse-don't-cast (garbage → BoundaryParseError at the boundary, never coerced),
// the per-call timeout (AbortController fires), bounded retry on 429/5xx, and key
// handling (missing key throws a clear 'missing required env', key never logged).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BoundaryParseError, type AIVisionResult } from '@closet/shared';
import { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
import type { FetchFn } from './http.js';

const VALID_ATTRS: AIVisionResult = {
  category: 'top',
  primaryColor: '#1a2b3c',
  secondaryColors: ['#ffffff'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'all-season',
};

// A recorded GPT-4o chat-completions envelope with the attributes JSON as the
// message content (JSON-mode returns a JSON string in content).
function chatResponse(attrs: unknown, status = 200): Response {
  const body = { choices: [{ message: { content: JSON.stringify(attrs) } }] };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A no-op transport override set so retries don't actually wait and jitter is fixed.
const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openai-vision adapter — happy path', () => {
  it('returns a schema-valid AIVisionResult from a recorded GPT-4o payload', async () => {
    const fetchFn: FetchFn = vi.fn(async () => chatResponse(VALID_ATTRS));
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    const result = await adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });

    expect(result).toEqual(VALID_ATTRS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('lowercases an uppercase hex the model returned (only sanctioned color mutation)', async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      chatResponse({ ...VALID_ATTRS, primaryColor: '#AABBCC', secondaryColors: ['#FFFFFF'] }),
    );
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    const result = await adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });

    expect(result.primaryColor).toBe('#aabbcc');
    expect(result.secondaryColors).toEqual(['#ffffff']);
  });
});

describe('openai-vision adapter — LLM efficiency knobs', () => {
  // Pull the parsed JSON request body the adapter sent to the vendor.
  async function capturedBody(overrides: Parameters<typeof makeOpenAIVisionAdapter>[0]): Promise<Record<string, unknown>> {
    let sentBody: unknown;
    const fetchFn: FetchFn = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body as string);
      return chatResponse(VALID_ATTRS);
    });
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport, ...overrides });
    await adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });
    return sentBody as Record<string, unknown>;
  }

  it('sends a bounded max_tokens (caps runaway spend; generous vs the ~80-token JSON)', async () => {
    const body = await capturedBody({});
    expect(body['max_tokens']).toBe(400);
  });

  it('respects an injected max_tokens override', async () => {
    const body = await capturedBody({ maxTokens: 128 });
    expect(body['max_tokens']).toBe(128);
  });

  it('OMITS image detail by default — no silent quality change (stays on the model auto)', async () => {
    const body = await capturedBody({});
    const content = (body['messages'] as { content: unknown }[])[1]!.content as { type: string; image_url?: Record<string, unknown> }[];
    const imagePart = content.find((p) => p.type === 'image_url')!;
    expect(imagePart.image_url).toEqual({ url: 'https://s/x.jpg' });
    expect(imagePart.image_url).not.toHaveProperty('detail');
  });

  it('includes detail:low ONLY when explicitly opted in (the corpus-gated cost lever)', async () => {
    const body = await capturedBody({ imageDetail: 'low' });
    const content = (body['messages'] as { content: unknown }[])[1]!.content as { type: string; image_url?: Record<string, unknown> }[];
    const imagePart = content.find((p) => p.type === 'image_url')!;
    expect(imagePart.image_url).toEqual({ url: 'https://s/x.jpg', detail: 'low' });
  });

  it('still keeps JSON mode on (no wasted prose tokens, guaranteed-parseable output)', async () => {
    const body = await capturedBody({});
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });
});

describe('openai-vision adapter — parse-don\'t-cast (garbage never reaches the domain)', () => {
  it('throws BoundaryParseError on a bad enum', async () => {
    const fetchFn: FetchFn = vi.fn(async () => chatResponse({ ...VALID_ATTRS, category: 'hat' }));
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('throws BoundaryParseError on a missing field', async () => {
    const { material, ...withoutMaterial } = VALID_ATTRS;
    void material;
    const fetchFn: FetchFn = vi.fn(async () => chatResponse(withoutMaterial));
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('throws BoundaryParseError on a non-hex color name (NOT coerced to a hex)', async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      chatResponse({ ...VALID_ATTRS, primaryColor: 'navy' }),
    );
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('throws BoundaryParseError when the vendor content is not JSON', async () => {
    const notJson = new Response(
      JSON.stringify({ choices: [{ message: { content: 'sorry, I cannot help' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const fetchFn: FetchFn = vi.fn(async () => notJson);
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });
});

describe('openai-vision adapter — timeout', () => {
  it('rejects when the fetch never resolves and the AbortController fires', async () => {
    // A fetch that only settles when its abort signal fires — proves the adapter's
    // AbortController, not a resolved response, ends the call.
    const fetchFn: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const adapter = makeOpenAIVisionAdapter({
      apiKey: 'sk-test',
      fetchFn,
      timeoutMs: 5,
      ...fastTransport,
    });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
  });
});

describe('openai-vision adapter — bounded retry', () => {
  it('succeeds after a 429 then 200', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(chatResponse(VALID_ATTRS, 429))
      .mockResolvedValueOnce(chatResponse(VALID_ATTRS, 200));
    const adapter = makeOpenAIVisionAdapter({
      apiKey: 'sk-test',
      fetchFn,
      maxRetries: 2,
      ...fastTransport,
    });

    const result = await adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });

    expect(result).toEqual(VALID_ATTRS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting retries on persistent 5xx (1 + maxRetries calls)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => chatResponse(VALID_ATTRS, 503));
    const adapter = makeOpenAIVisionAdapter({
      apiKey: 'sk-test',
      fetchFn,
      maxRetries: 2,
      ...fastTransport,
    });

    await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('openai-vision adapter — key handling', () => {
  it('throws a clear "missing required env" when OPENAI_API_KEY is unset', async () => {
    const previous = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const fetchFn: FetchFn = vi.fn(async () => chatResponse(VALID_ATTRS));
      // No apiKey injected → adapter falls back to requireEnv('OPENAI_API_KEY').
      const adapter = makeOpenAIVisionAdapter({ fetchFn, ...fastTransport });

      await expect(adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' })).rejects.toThrow(
        /missing required env: OPENAI_API_KEY/,
      );
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env['OPENAI_API_KEY'] = previous;
    }
  });

  it('never puts the key in the request URL (it rides the Authorization header only)', async () => {
    const seenUrls: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (url) => {
      seenUrls.push(url);
      return chatResponse(VALID_ATTRS);
    });
    const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-secret-123', fetchFn, ...fastTransport });

    await adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });

    expect(seenUrls[0]).not.toContain('sk-secret-123');
  });
});
