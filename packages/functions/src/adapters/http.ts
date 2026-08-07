// Shared provider transport: a per-call timeout (AbortController) plus a bounded,
// jittered-backoff retry. This is the ONE place the timeout/retry policy lives so
// both paid-provider adapters (OpenAI vision, Photoroom cutout) behave identically.
//
// Retry policy is deliberately narrow: ONLY a 429 or a 5xx response is retried
// (transient, safe-to-repeat vendor faults). Any thrown error — including an
// AbortError from the per-call timeout — propagates immediately without a retry, so
// a hung vendor fails fast within the timeout budget rather than multiplying it.
// Every failure path throws; the caller (parse-photo) turns a throw into markFailed
// + a clean 502 (req-9), never untyped data into the domain.
import { envValue } from '../auth/env.js';

// A fetch shaped like the platform fetch, narrowed to what the adapters use. The
// transport is INJECTED so tests drive recorded payloads with no real network.
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

// Transport knobs, all injectable for deterministic tests (fake fetch, no-op sleep,
// fixed jitter). Production reads timeout/retries from env with documented defaults.
export interface TransportDeps {
  readonly fetchFn: FetchFn;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 250;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Build the production transport defaults, overlaying any injected test doubles.
export function resolveTransportDeps(overrides?: Partial<TransportDeps>): TransportDeps {
  const fetchFn: FetchFn =
    overrides?.fetchFn ??
    ((input, init) => (globalThis.fetch as unknown as FetchFn)(input, init));
  return {
    fetchFn,
    timeoutMs: overrides?.timeoutMs ?? parsePositiveInt(envValue('PROVIDER_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS),
    maxRetries: overrides?.maxRetries ?? parsePositiveInt(envValue('PROVIDER_MAX_RETRIES'), DEFAULT_MAX_RETRIES),
    sleep: overrides?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: overrides?.random ?? Math.random,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Full jitter: base * 2^attempt, then a random point in [0, that].
function backoffMs(attempt: number, random: () => number): number {
  const ceiling = BACKOFF_BASE_MS * 2 ** attempt;
  return Math.floor(random() * ceiling);
}

// A vendor fault that is NOT a boundary parse error — carries only the status code,
// never the vendor's response body (which could echo the image URL or key). The
// caller catches this and maps it to the fixed non-PII 502 reason.
export class ProviderRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
  }
}

// Execute one request with a hard timeout via AbortController. The timer is always
// cleared so a resolved call never leaks a pending abort.
async function fetchWithTimeout(url: string, init: RequestInit, deps: TransportDeps): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    return await deps.fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Request with bounded retry on transient (429/5xx) responses. Returns the first OK
// Response; throws ProviderRequestError once retries are exhausted or on a non-
// retryable non-OK status. Thrown transport errors (timeout/abort/network) are NOT
// retried and propagate to the caller.
export async function requestWithRetry(
  url: string,
  init: RequestInit,
  deps: TransportDeps,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchWithTimeout(url, init, deps);
    if (response.ok) return response;
    if (isRetryableStatus(response.status) && attempt < deps.maxRetries) {
      await deps.sleep(backoffMs(attempt, deps.random));
      continue;
    }
    throw new ProviderRequestError('provider request failed', response.status);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
