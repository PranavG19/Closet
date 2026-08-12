// Structural oracle for request logging (docs/research/metrics-logging-audit.md §5a/§6).
//
// The claim "every handler is logged" is made UNREPRESENTABLE-by-construction: the request
// line is emitted inside withAuth, the single wrapper every user-JWT handler passes through,
// so a handler physically cannot opt out. This test proves that wrapper contract without a
// database — it drives withAuth with an injected verifier + a no-op executor and spies the
// one sanctioned log sink (globalThis.console.log, the same sink logger.ts writes through).
//
// The oracle is the SINK, not the handler's own return: we read the JSON line the logger
// emitted (a signal the handler does not produce) and assert exactly one `request` line per
// invocation, the right route/status/level, and the correlation-id echo header.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryExecutor } from '@closet/db';
import { withAuth, type AuthedHandler, type WithAuthDeps } from './withAuth.js';
import { jsonResponse, errorResponse } from './respond.js';

const VALID_SUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// A no-op executor: these tests never touch a DB (the request-log behaviour is pure).
const noopExec = { query: async () => ({ rows: [] }) } as unknown as QueryExecutor;

const deps: WithAuthDeps = {
  verifier: { verify: async (token: string) => ({ sub: token }) },
  makeExecutor: () => noopExec,
  newCorrelationId: () => 'corr-123',
};

// Capture every line the logger writes (it goes through globalThis.console.log).
let lines: Array<Record<string, unknown>>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = vi
    .spyOn((globalThis as { console: { log: (s: string) => void } }).console, 'log')
    .mockImplementation((line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    });
});

afterEach(() => {
  logSpy.mockRestore();
});

function req(token: string | null, url = 'https://proj.functions.supabase.co/wardrobe-list'): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  return new Request(url, { method: 'POST', headers });
}

const okHandler: AuthedHandler = async () => jsonResponse(200, { ok: true });

function requestLines(): Array<Record<string, unknown>> {
  return lines.filter((l) => l['event'] === 'request');
}

describe('withAuth request logging — coverage is structural (the wrapper, not the handler)', () => {
  it('emits EXACTLY ONE request line per invocation, with route + status + durationMs', async () => {
    const res = await withAuth(okHandler, deps)(req(VALID_SUB));
    expect(res.status).toBe(200);
    const reqs = requestLines();
    expect(reqs).toHaveLength(1);
    const line = reqs[0]!;
    // Route is derived from the URL's last path segment (the deployed function name) — no
    // per-shim route argument. wardrobe-list here.
    expect(line['route']).toBe('wardrobe-list');
    expect(line['status']).toBe(200);
    expect(line['correlationId']).toBe('corr-123');
    expect(typeof line['durationMs']).toBe('number');
    expect(line['level']).toBe('info');
  });

  it('echoes the correlation id as the x-correlation-id response header (client↔server join)', async () => {
    const res = await withAuth(okHandler, deps)(req(VALID_SUB));
    expect(res.headers.get('x-correlation-id')).toBe('corr-123');
  });

  it('derives a distinct route per deployed function name', async () => {
    await withAuth(okHandler, deps)(req(VALID_SUB, 'https://p.supabase.co/palette-read'));
    expect(requestLines()[0]!['route']).toBe('palette-read');
  });

  it('a 401 (no token) is still logged once, at warn, with the header', async () => {
    const res = await withAuth(okHandler, deps)(req(null));
    expect(res.status).toBe(401);
    expect(res.headers.get('x-correlation-id')).toBe('corr-123');
    const reqs = requestLines();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!['status']).toBe(401);
    expect(reqs[0]!['level']).toBe('warn'); // 4xx → warn
  });

  it('a handler-returned 4xx logs at warn, a 5xx at error (status class → level)', async () => {
    const bad: AuthedHandler = async () => errorResponse(400, 'invalid_request', 'nope');
    await withAuth(bad, deps)(req(VALID_SUB));
    expect(requestLines()[0]!['level']).toBe('warn');

    lines = [];
    const boom: AuthedHandler = async () => errorResponse(500, 'internal_error', 'x');
    await withAuth(boom, deps)(req(VALID_SUB));
    expect(requestLines()[0]!['level']).toBe('error');
  });

  it('a handler that THROWS is not an invisible 500 — it logs request_error and returns a safe 500', async () => {
    const thrower: AuthedHandler = async () => {
      throw new Error('boom with a secret in it');
    };
    const res = await withAuth(thrower, deps)(req(VALID_SUB));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-correlation-id')).toBe('corr-123');
    const errs = lines.filter((l) => l['event'] === 'request_error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!['route']).toBe('wardrobe-list');
    // PII guard: the thrown message never reaches any log line.
    expect(JSON.stringify(lines)).not.toContain('secret');
  });
});
