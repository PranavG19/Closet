// Oracle for the client-transport instrumentation (docs/research/metrics-logging-audit.md
// §5b). The client half was entirely dark — no request timing, no join to the server log.
// This asserts the ONE transport choke (ApiClient.request) now emits a structured line per
// call, that the line carries the server's correlationId (read from the x-correlation-id
// header withAuth sets), and that the server's raw error MESSAGE never reaches the log — the
// same PII guard the server logger has. The oracle is the SINK (console.log), not the
// client's return value: we read the JSON line the logger emitted, a signal the request
// path does not otherwise expose.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import type { AppConfig } from './config.js';

const CONFIG: AppConfig = {
  supabaseUrl: 'https://proj.supabase.co',
  supabaseAnonKey: 'anon',
  functionsBaseUrl: 'https://proj.supabase.co/functions/v1',
};

// The wardrobe-list success shape (the simplest GET the client parses).
const WARDROBE_OK = { items: [], next_cursor: null };

function fetchReturning(body: unknown, status: number, headers: Record<string, string>): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })) as unknown as typeof fetch;
}

let lines: Array<Record<string, unknown>>;
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lines = [];
  spy = vi
    .spyOn((globalThis as { console: { log: (s: string) => void } }).console, 'log')
    .mockImplementation((line: string) => {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* ignore non-JSON */
      }
    });
});

afterEach(() => {
  spy.mockRestore();
});

function makeClient(fetchFn: typeof fetch): ApiClient {
  return new ApiClient({ fetchFn, getToken: async () => 'jwt-123', config: CONFIG });
}

describe('ApiClient transport logging', () => {
  it('a successful call emits one `api` line with route, status, durationMs, and the server correlationId', async () => {
    const client = makeClient(fetchReturning(WARDROBE_OK, 200, { 'x-correlation-id': 'server-corr-1' }));
    await client.listWardrobe();
    const api = lines.filter((l) => l['event'] === 'api');
    expect(api).toHaveLength(1);
    expect(api[0]!['route']).toBe('listWardrobe');
    expect(api[0]!['status']).toBe(200);
    expect(api[0]!['correlationId']).toBe('server-corr-1');
    expect(typeof api[0]!['durationMs']).toBe('number');
  });

  it('a non-2xx emits one `api_error` line with the code + status, and NOT the server message', async () => {
    const envelope = { error: { code: 'invalid_request', message: 'a secret detail that must not be logged' } };
    const client = makeClient(fetchReturning(envelope, 400, { 'x-correlation-id': 'server-corr-2' }));
    await expect(client.listWardrobe()).rejects.toBeDefined();
    const errs = lines.filter((l) => l['event'] === 'api_error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!['status']).toBe(400);
    expect(errs[0]!['code']).toBe('invalid_request');
    expect(errs[0]!['correlationId']).toBe('server-corr-2');
    // PII guard: the server's human message never appears in any emitted line.
    expect(JSON.stringify(lines)).not.toContain('secret detail');
  });

  it('correlationId is undefined-safe when the header is absent (older server / proxy stripped it)', async () => {
    const client = makeClient(fetchReturning(WARDROBE_OK, 200, {}));
    await client.listWardrobe();
    const api = lines.filter((l) => l['event'] === 'api');
    expect(api).toHaveLength(1);
    // Absent header → the field is simply omitted (JSON.stringify drops undefined), never a crash.
    expect(api[0]!).not.toHaveProperty('correlationId');
  });
});
