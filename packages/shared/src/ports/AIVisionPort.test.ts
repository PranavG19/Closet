// Tier-0 (docs/05): spec-literal contract test for AIVisionPort. Two independent
// signals: (1) the TS compiler — a fake adapter typed AIVisionPort must typecheck
// (drift/vendor-leak → tsc fails); (2) differential valid/invalid parse.
//
// RED-FIRST NOTE: the invalid-fixture cases were confirmed to be RED if
// AIVisionResultSchema were loosened to z.any()/z.object({}).passthrough() —
// they would stop throwing. That is what makes the schema a real oracle.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AIVisionResultSchema,
  type AIVisionResult,
  type AIVisionPort,
} from './AIVisionPort.js';

const validFixture: AIVisionResult = {
  category: 'top',
  primaryColor: '#1a2b3c',
  secondaryColors: ['#ffffff'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'summer',
};

// Type-conformance: the compiler is the oracle. If a method signature drifts or a
// vendor type leaks in, this fake fails to typecheck under `tsc --build`.
const fakeVision: AIVisionPort = {
  extractAttributes: async () => AIVisionResultSchema.parse(validFixture),
};

// A second, distinct fake — the swap/A-B invariant: a generic caller runs both.
const fakeVisionB: AIVisionPort = {
  extractAttributes: async () =>
    AIVisionResultSchema.parse({ ...validFixture, category: 'dress', secondaryColors: [] }),
};

async function run(port: AIVisionPort): Promise<AIVisionResult> {
  return port.extractAttributes({ imageUrl: 'https://example/storage/a.png' });
}

describe('AIVisionPort contract', () => {
  it('parses a spec-shaped fixture and round-trips it', () => {
    expect(AIVisionResultSchema.parse(validFixture)).toEqual(validFixture);
  });

  it('accepts an empty secondaryColors array (present-and-empty, not undefined)', async () => {
    const out = await run(fakeVisionB);
    expect(out.secondaryColors).toEqual([]);
  });

  it('swap invariant — two distinct fakes both satisfy the port and run', async () => {
    expect((await run(fakeVision)).category).toBe('top');
    expect((await run(fakeVisionB)).category).toBe('dress');
  });

  it('rejects a missing required field (ZodError)', () => {
    const { material, ...missing } = validFixture;
    void material;
    expect(() => AIVisionResultSchema.parse(missing)).toThrow(z.ZodError);
  });

  it('rejects a wrong-type field (ZodError)', () => {
    expect(() => AIVisionResultSchema.parse({ ...validFixture, primaryColor: 123 })).toThrow(z.ZodError);
  });

  it('rejects a value one step outside the category enum, accepts the documented member', () => {
    expect(() => AIVisionResultSchema.parse({ ...validFixture, category: 'spaceship' })).toThrow(z.ZodError);
    expect(AIVisionResultSchema.parse({ ...validFixture, category: 'shoes' }).category).toBe('shoes');
  });

  it('rejects a non-hex primaryColor (no numeric/loose color leaks to the palette)', () => {
    expect(() => AIVisionResultSchema.parse({ ...validFixture, primaryColor: 'red' })).toThrow(z.ZodError);
  });
});
