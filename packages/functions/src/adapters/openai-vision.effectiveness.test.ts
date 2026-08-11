// Test C (docs/research/llm-efficiency-audit.md §"Proposed guard tests") — the
// response-contract / effectiveness FLOOR. A small recorded corpus of plausible
// GPT-4o chat-completions envelopes is fed through the REAL adapter via an INJECTED
// fake fetch (NO network, NO live key). This locks the prompt→schema contract from
// the response side: a prompt edit that changed the requested shape, or a loosened
// AIVisionResultSchema, is caught here as an effectiveness regression.
//
// The oracle is EXACT: valid envelopes must parse to a byte-for-byte AIVisionResult
// (with the only sanctioned mutation — hex lowercasing — applied), and every
// malformed envelope must throw BoundaryParseError, NEVER a coerced/partial garment.
// The corpus is deliberately independent of the payload-shape guards in
// openai-vision.adapter.test.ts: this file asserts the RESULT contract, not the
// request wire shape.
import { describe, it, expect, vi } from 'vitest';
import { BoundaryParseError, type AIVisionResult } from '@closet/shared';
import { makeOpenAIVisionAdapter } from './openai-vision.adapter.js';
import type { FetchFn } from './http.js';

// Wrap an attributes object (or a raw content string) as a JSON-mode chat-completions
// envelope: JSON mode returns the model's JSON as a STRING in message.content.
function envelope(content: unknown): Response {
  const contentString = typeof content === 'string' ? content : JSON.stringify(content);
  const body = { choices: [{ message: { content: contentString } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const fastTransport = { sleep: async () => {}, random: () => 0 } as const;

async function runAdapter(response: Response): Promise<AIVisionResult> {
  const fetchFn: FetchFn = vi.fn(async () => response);
  const adapter = makeOpenAIVisionAdapter({ apiKey: 'sk-test', fetchFn, ...fastTransport });
  return adapter.extractAttributes({ imageUrl: 'https://s/x.jpg' });
}

// ---- the recorded corpus -------------------------------------------------------
// Two "valid" envelopes that must round-trip to an EXACT AIVisionResult, and four
// "malformed" envelopes that must each throw at the boundary.
const CLEAN_TOP = {
  category: 'top',
  primaryColor: '#1a2b3c',
  secondaryColors: ['#ffffff'],
  material: 'cotton',
  pattern: 'solid',
  formality: 'casual',
  season: 'all-season',
} as const;

const FLORAL_DRESS = {
  category: 'dress',
  primaryColor: '#c71585',
  secondaryColors: ['#ffd700', '#228b22'],
  material: 'silk',
  pattern: 'floral',
  formality: 'formal',
  season: 'summer',
} as const;

describe('openai-vision effectiveness — valid corpus round-trips to an EXACT AIVisionResult', () => {
  it('a clean top parses byte-for-byte to the expected result', async () => {
    expect(await runAdapter(envelope(CLEAN_TOP))).toEqual(CLEAN_TOP);
  });

  it('a floral dress (multi secondary colors) parses byte-for-byte to the expected result', async () => {
    expect(await runAdapter(envelope(FLORAL_DRESS))).toEqual(FLORAL_DRESS);
  });

  it('an UPPERCASE-hex response is lowercased (the ONLY sanctioned color mutation)', async () => {
    const upper = { ...CLEAN_TOP, primaryColor: '#1A2B3C', secondaryColors: ['#FFFFFF'] };
    const result = await runAdapter(envelope(upper));
    // Lowercased to satisfy the #rrggbb schema — and nothing else changed.
    expect(result).toEqual(CLEAN_TOP);
  });
});

describe('openai-vision effectiveness — malformed corpus NEVER yields a coerced garment', () => {
  // A color NAME instead of hex: the prompt demands hex, the schema rejects the name.
  // This must NOT be silently coerced into some hex — a wrong-but-plausible color is
  // worse than a clean boundary failure.
  it('a color-NAME response throws BoundaryParseError (never coerced to a hex)', async () => {
    const named = { ...CLEAN_TOP, primaryColor: 'hotpink' };
    await expect(runAdapter(envelope(named))).rejects.toBeInstanceOf(BoundaryParseError);
  });

  it('a missing-field response (no material) throws BoundaryParseError', async () => {
    const { material, ...withoutMaterial } = CLEAN_TOP;
    void material;
    await expect(runAdapter(envelope(withoutMaterial))).rejects.toBeInstanceOf(BoundaryParseError);
  });

  it('a non-JSON refusal ("I cannot help") throws BoundaryParseError', async () => {
    await expect(runAdapter(envelope('I cannot help with that image.'))).rejects.toBeInstanceOf(
      BoundaryParseError,
    );
  });

  it('an out-of-vocabulary category throws BoundaryParseError', async () => {
    const badEnum = { ...CLEAN_TOP, category: 'hat' };
    await expect(runAdapter(envelope(badEnum))).rejects.toBeInstanceOf(BoundaryParseError);
  });
});
