// Oracle for the request-body boundary on parse-photo — the one input class the
// integration suites structurally miss.
//
// security.integration.test.ts fuzzes bodies that are structurally WRONG but VALID
// JSON ({ items: 'nope' }), which reach parseBoundary and correctly 400. Nothing posts
// a body that is not JSON at all, and `await req.json()` throws SyntaxError for that,
// not BoundaryParseError — so an absent or truncated body (a mobile connection dropped
// mid-upload, the exact condition the chaos suite models elsewhere) came back as 500
// internal_error. That tells the client "the server is broken, retry with backoff" for
// a request that can never succeed, and buries client noise in the server error rate.
//
// No Postgres here on purpose: the assertion is that the handler refuses BEFORE it
// touches the DB, so the executor is a trap that fails the test if it is ever called.
import { describe, expect, it } from 'vitest';
import type { QueryExecutor } from '@closet/db';
import { makeParsePhoto, type ParsePorts } from './parse-photo.js';
import { unthrottledSpendLimiter } from './rate-limit.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Touching the DB on a malformed body would mean the boundary check came too late.
const trapExecutor: QueryExecutor = {
  query: () => {
    throw new Error('the executor must not be reached for a malformed body');
  },
};

// Likewise for the paid providers — a malformed body must cost nothing.
const trapPorts: ParsePorts = {
  vision: {
    extractAttributes: () => {
      throw new Error('the vision provider must not be reached for a malformed body');
    },
  },
  cutout: {
    removeBackground: () => {
      throw new Error('the cutout provider must not be reached for a malformed body');
    },
  },
  mintSourcePhotoUrl: () => {
    throw new Error('the url minter must not be reached for a malformed body');
  },
};

const handler = makeParsePhoto(() => trapPorts, unthrottledSpendLimiter);

// A REAL platform Request — the SyntaxError has to come from the runtime's own JSON
// parse, not from a hand-thrown stand-in, or the test proves the stand-in.
function call(body: string | undefined): Promise<Response> {
  const request = new Request('https://test.local/parse-photo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return handler(request, {
    userId: USER,
    exec: trapExecutor,
    correlationId: 'malformed-body-test',
    accessToken: 'token',
  });
}

describe('parse-photo — a body that is not JSON is the CALLER’s error, not a server fault', () => {
  it.each([
    ['absent', undefined],
    ['empty string', ''],
    ['truncated mid-object', '{"source_photo_hash":"H","kin'],
    ['form-encoded under a json content-type', 'source_photo_hash=H&kind=teaser'],
    ['bare garbage', '{oops'],
  ])('%s → 400 invalid_request', async (_label, body) => {
    const response = await call(body);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('invalid_request');
  });

  // The contrast case, so the 400 above is about JSON-ness and not about everything
  // being a 400: valid JSON that the schema rejects is ALSO 400 (parse-don't-cast),
  // and it gets there through parseBoundary rather than the SyntaxError branch.
  it('valid JSON that fails the schema is still 400', async () => {
    const response = await call(JSON.stringify({ kind: 'teaser' })); // no source_photo_hash
    expect(response.status).toBe(400);
  });
});
