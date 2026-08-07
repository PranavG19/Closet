// Tier-0 (docs/05): spec-literal contract test for CutoutPort. Compiler + parse
// signals. RED-FIRST: invalid cases would stop throwing if the schema were
// loosened to z.any()/passthrough — the throw is the oracle's teeth.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CutoutResultSchema, type CutoutResult, type CutoutPort } from './CutoutPort.js';

const validFixture: CutoutResult = {
  imageUrl: 'https://example/storage/cutout.png',
  hasAlpha: true,
  width: 1024,
  height: 1024,
};

const fakeCutout: CutoutPort = {
  removeBackground: async () => CutoutResultSchema.parse(validFixture),
};

const fakeCutoutB: CutoutPort = {
  removeBackground: async () => CutoutResultSchema.parse({ ...validFixture, width: 512, height: 768 }),
};

async function run(port: CutoutPort): Promise<CutoutResult> {
  return port.removeBackground({ imageUrl: 'https://example/storage/orig.png' });
}

describe('CutoutPort contract', () => {
  it('parses a spec-shaped fixture and round-trips it', () => {
    expect(CutoutResultSchema.parse(validFixture)).toEqual(validFixture);
  });

  it('swap invariant — two distinct fakes both satisfy the port and run', async () => {
    expect((await run(fakeCutout)).width).toBe(1024);
    expect((await run(fakeCutoutB)).width).toBe(512);
  });

  it('rejects a missing required field (ZodError)', () => {
    const { imageUrl, ...missing } = validFixture;
    void imageUrl;
    expect(() => CutoutResultSchema.parse(missing)).toThrow(z.ZodError);
  });

  it('rejects a wrong-type field (ZodError)', () => {
    expect(() => CutoutResultSchema.parse({ ...validFixture, hasAlpha: 'yes' })).toThrow(z.ZodError);
  });

  it('rejects a non-positive dimension', () => {
    expect(() => CutoutResultSchema.parse({ ...validFixture, width: 0 })).toThrow(z.ZodError);
  });
});
