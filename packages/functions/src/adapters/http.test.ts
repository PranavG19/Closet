// Oracle for the shared provider transport. Two things the adapter suites cannot see,
// because both inject a fake fetch and both inject timeoutMs directly:
//
//   1. THE BODY READ. Every adapter test stalls the FETCH, which the AbortController
//      always covered. None stalls the BODY. A vendor that sends 200 + headers and then
//      stalls the chunked body used to hang the parse forever: the timer was cleared the
//      moment headers arrived, and the read happened after requestWithRetry had already
//      returned. That strands the parse_jobs row at status='processing' for the whole
//      10-minute claim lease, so the user's retries get 409 for a job nothing is working
//      on. Proving it needs a REAL fetch against a real socket, because an abort only
//      interrupts a body read that a real transport wired to the signal — a fake fetch
//      returning a stalled ReadableStream would prove the fake, not the code.
//
//   2. THE ENV PATH. resolveTransportDeps' parsing of PROVIDER_TIMEOUT_MS /
//      PROVIDER_MAX_RETRIES is what production actually uses, and nothing exercised it.
//
// So this suite uses a loopback node:http server and the platform fetch.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestWithRetry, resolveTransportDeps } from './http.js';

// Each route is one server behaviour, so a test names the vendor pathology it drives.
type Route = 'ok' | 'stall-body' | 'stall-headers';

let server: Server;
let baseUrl: string;
// Held open so the suite can end them in afterAll — an unended response keeps the
// server's close() callback pending forever.
const openResponses = new Set<ServerResponse>();

const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

const readJson = (response: Response): Promise<unknown> => response.json();

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = (req.url ?? '').slice(1).split('?')[0] as Route;
    if (route === 'stall-headers') {
      openResponses.add(res); // never respond at all
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (route === 'stall-body') {
      // Headers + a TRUNCATED body, then silence. The exact shape of a vendor whose
      // upstream died mid-stream, or a proxy that buffered the head and hung.
      res.write('{"partial":');
      openResponses.add(res);
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const res of openResponses) res.destroy();
  openResponses.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('requestWithRetry — the timeout covers the body read, not just the fetch', () => {
  it('reads the body of an OK response', async () => {
    const deps = resolveTransportDeps({ timeoutMs: 2_000, maxRetries: 0, ...fastTransport });
    await expect(requestWithRetry(`${baseUrl}/ok`, { method: 'GET' }, deps, readJson)).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects when the vendor sends headers then STALLS the body', async () => {
    const deps = resolveTransportDeps({ timeoutMs: 50, maxRetries: 0, ...fastTransport });
    await expect(
      requestWithRetry(`${baseUrl}/stall-body`, { method: 'GET' }, deps, readJson),
    ).rejects.toBeTruthy();
  });

  it('rejects when the vendor never sends headers at all', async () => {
    const deps = resolveTransportDeps({ timeoutMs: 50, maxRetries: 0, ...fastTransport });
    await expect(
      requestWithRetry(`${baseUrl}/stall-headers`, { method: 'GET' }, deps, readJson),
    ).rejects.toBeTruthy();
  });

  // The bound that makes the stall test meaningful: the rejection must come from the
  // timeout, not from the test runner giving up. 50ms budget, generous 3s ceiling.
  it('a stalled body rejects within the timeout budget, not after an unbounded wait', async () => {
    const deps = resolveTransportDeps({ timeoutMs: 50, maxRetries: 0, ...fastTransport });
    const startedAt = Date.now();
    await requestWithRetry(`${baseUrl}/stall-body`, { method: 'GET' }, deps, readJson).catch(
      () => undefined,
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});

// PROVIDER_TIMEOUT_MS='0' meant setTimeout(abort, 0) — an abort on the next tick, i.e.
// every provider call 502s. PROVIDER_TIMEOUT_MS='15s' parsed to 15 (ms), same outcome.
// A misconfigured knob must fall back to the conservative default, never to a value
// that disables or trivialises the guard — the rule rate-limit.ts already states.
describe('resolveTransportDeps — a misconfigured env falls back, never degrades', () => {
  const DEFAULT_TIMEOUT_MS = 15_000;
  const DEFAULT_MAX_RETRIES = 2;

  afterEach(() => {
    delete process.env['PROVIDER_TIMEOUT_MS'];
    delete process.env['PROVIDER_MAX_RETRIES'];
  });

  it.each([
    ['0', 'zero would abort on the next tick'],
    ['15s', 'parseInt would silently yield 15ms'],
    ['12.5', 'not an integer'],
    ['1e999', 'parseInt would silently yield 1ms'],
    ['-1', 'negative'],
    ['', 'empty'],
    ['  ', 'whitespace'],
    ['abc', 'garbage'],
  ])('PROVIDER_TIMEOUT_MS=%j falls back to the default (%s)', (raw) => {
    process.env['PROVIDER_TIMEOUT_MS'] = raw;
    expect(resolveTransportDeps().timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('a valid PROVIDER_TIMEOUT_MS is honoured', () => {
    process.env['PROVIDER_TIMEOUT_MS'] = '2500';
    expect(resolveTransportDeps().timeoutMs).toBe(2500);
  });

  // maxRetries differs from the timeout: 0 is LEGITIMATE (do not retry), so only
  // negatives and non-integers fall back.
  it('PROVIDER_MAX_RETRIES=0 is honoured — no-retry is a real choice', () => {
    process.env['PROVIDER_MAX_RETRIES'] = '0';
    expect(resolveTransportDeps().maxRetries).toBe(0);
  });

  it.each([['-1'], ['2.5'], ['3x'], ['abc'], ['']])(
    'PROVIDER_MAX_RETRIES=%j falls back to the default',
    (raw) => {
      process.env['PROVIDER_MAX_RETRIES'] = raw;
      expect(resolveTransportDeps().maxRetries).toBe(DEFAULT_MAX_RETRIES);
    },
  );
});
