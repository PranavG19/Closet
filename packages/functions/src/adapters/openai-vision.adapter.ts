// OpenAI GPT-4o vision adapter → AIVisionPort. Extracts the EXACT AIVisionResult
// garment attributes from an approved image and passes the vendor JSON through
// parseBoundary(AIVisionResultSchema) at the boundary. A garbage/partial vendor
// payload becomes a BoundaryParseError here — never untyped data into the domain —
// which parse-photo's try/catch turns into a clean 502 (req-9).
//
// Color vocabulary is handled defensively at the SOURCE: the prompt instructs the
// model to return colors as lowercase #rrggbb hex ONLY, and JSON-mode pins the
// shape. If the model returns a color name or an uppercase/short hex, the schema's
// HexColor regex rejects it at parseBoundary — we do NOT silently coerce a name to
// a hex (a wrong-but-plausible color is worse than a clean 502 + retry). The one
// normalization we DO apply is lowercasing, since #RRGGBB and #rrggbb denote the
// same color and the schema demands lowercase.
import { parseBoundary, AIVisionResultSchema, type AIVisionPort, type AIVisionResult, type AIVisionInput } from '@closet/shared';
import { requireEnv, envValue } from '../auth/env.js';
import {
  requestWithRetry,
  resolveTransportDeps,
  isRecord,
  type TransportDeps,
} from './http.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

// The model is told the exact vocabulary so its JSON matches AIVisionResultSchema
// field-for-field. Anything off-vocabulary is rejected at the boundary, not coerced.
const EXTRACTION_INSTRUCTION = [
  'You are a garment attribute extractor. Look at the single clothing item in the image and return ONLY a JSON object with exactly these keys:',
  '- category: one of "top","bottom","dress","outerwear","shoes","accessory"',
  '- primaryColor: the dominant color as a lowercase 6-digit hex string like "#1a2b3c" (NEVER a color name)',
  '- secondaryColors: an array (possibly empty) of additional colors, each a lowercase 6-digit hex string',
  '- material: a short lowercase material word, e.g. "cotton","denim","wool","leather"',
  '- pattern: one of "solid","striped","checked","floral","graphic","other"',
  '- formality: one of "casual","smart-casual","formal"',
  '- season: one of "spring","summer","autumn","winter","all-season"',
  'Return hex colors ONLY, never names. Do not add extra keys or prose.',
].join('\n');

export interface OpenAIVisionDeps extends Partial<TransportDeps> {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
}

// Lowercase any string value under the color-bearing keys so a #RRGGBB from the
// model still satisfies the lowercase-hex schema. This is the ONLY color mutation;
// non-hex garbage still fails the regex at parseBoundary.
function lowercaseColors(payload: Record<string, unknown>): Record<string, unknown> {
  const primaryColor = typeof payload['primaryColor'] === 'string' ? payload['primaryColor'].toLowerCase() : payload['primaryColor'];
  const secondaryColors = Array.isArray(payload['secondaryColors'])
    ? payload['secondaryColors'].map((c) => (typeof c === 'string' ? c.toLowerCase() : c))
    : payload['secondaryColors'];
  return { ...payload, primaryColor, secondaryColors };
}

// Pull the JSON object the model produced out of the chat-completions envelope.
// Returns unknown — it is validated at the boundary, never trusted structurally.
function extractContentJson(vendorBody: unknown): unknown {
  if (!isRecord(vendorBody)) return vendorBody;
  const choices = vendorBody['choices'];
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  if (!isRecord(firstChoice)) return undefined;
  const message = firstChoice['message'];
  if (!isRecord(message)) return undefined;
  const content = message['content'];
  if (typeof content !== 'string') return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function makeOpenAIVisionAdapter(deps?: OpenAIVisionDeps): AIVisionPort {
  const transport = resolveTransportDeps(deps);
  const baseUrl = deps?.baseUrl ?? envValue('OPENAI_BASE_URL') ?? DEFAULT_BASE_URL;
  const model = deps?.model ?? envValue('OPENAI_VISION_MODEL') ?? DEFAULT_MODEL;

  return {
    async extractAttributes(input: AIVisionInput): Promise<AIVisionResult> {
      const apiKey = deps?.apiKey ?? requireEnv('OPENAI_API_KEY');
      const requestBody = {
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACTION_INSTRUCTION },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the garment attributes as JSON.' },
              { type: 'image_url', image_url: { url: input.imageUrl } },
            ],
          },
        ],
      };

      const response = await requestWithRetry(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
        transport,
      );

      const vendorBody: unknown = await response.json();
      const contentJson = extractContentJson(vendorBody);
      const normalized = isRecord(contentJson) ? lowercaseColors(contentJson) : contentJson;
      // Boundary: garbage/partial vendor payload → BoundaryParseError, never coerced.
      return parseBoundary(AIVisionResultSchema, normalized, 'openai-vision.result');
    },
  };
}
