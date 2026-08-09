// Oracle for errorFromThrown's client-fault vs server-fault split.
//
// The gap this closes: every handler starts with `await req.json()`, and on an absent,
// truncated, or non-JSON body that throws a SyntaxError — which fell through to 500
// internal_error. So a client that dropped its connection mid-upload (or sent
// Content-Type: application/json with a form payload) was told the SERVER was broken,
// which is both wrong for the client's retry decision and noise in the error-rate
// signal. The security suite looks like it covers this but does not:
// security.integration.test.ts:398 posts structurally-wrong but VALID JSON, which
// reaches parseBoundary and correctly 400s.
//
// The SyntaxError here is thrown by the PLATFORM Request, not constructed by the test —
// asserting on a hand-made `new SyntaxError()` would only prove the instanceof branch,
// not that the body-parse path actually lands in it.
import { describe, expect, it } from 'vitest';
import { BoundaryParseError } from '@closet/shared';
import { errorFromThrown } from './respond.js';

// What a handler's own try/catch sees when it does `await req.json()` on `body`.
async function thrownByBodyParse(body: string | undefined): Promise<unknown> {
  const req = new Request('https://test.local/fn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  try {
    await req.json();
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

describe('errorFromThrown — a malformed body is the CALLER’s fault, not a server fault', () => {
  it.each([
    ['an absent body', undefined],
    ['an empty body', ''],
    ['a truncated body (connection dropped mid-upload)', '{"source_photo_hash":"H"'],
    ['a non-JSON body under a json content-type', 'source_photo_hash=H&kind=teaser'],
  ])('%s → 400 invalid_request', async (_label, body) => {
    const thrown = await thrownByBodyParse(body);
    const response = errorFromThrown(thrown);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('invalid_request');
    // The generic message only — never the parser's text, which can echo the body.
    expect(payload.error.message).toBe('Request failed validation.');
  });

  it('a boundary parse failure is still 400 (unchanged)', async () => {
    const response = errorFromThrown(new BoundaryParseError([], 'parse.request'));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('invalid_request');
  });

  // The other half of the split: widening the 400 must not swallow real server faults.
  it('a genuine server fault is still 500 with no detail on the wire', async () => {
    const response = errorFromThrown(new Error('connection terminated: password=hunter2'));
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('internal_error');
    expect(payload.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });
});
