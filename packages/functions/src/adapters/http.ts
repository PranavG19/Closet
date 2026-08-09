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

// A configured value only wins if it is a safe integer at or above `minimum`.
// Number, not parseInt: parseInt('15s') is 15, so PROVIDER_TIMEOUT_MS='15s' used to
// become a 15ms timeout that aborts every provider call, and '1e999' became 1ms. The
// timeout's minimum is 1 (0 aborts on the next tick — also 502-everything), while
// maxRetries legitimately allows 0. Same shape as rate-limit.ts's
// positiveIntOrDefault, for the same reason: a misconfigured knob must fall back to
// the conservative default, never to a value that disables the guard.
function intAtLeastOrDefault(raw: string | undefined, minimum: number, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) return fallback;
  return value;
}

// Build the production transport defaults, overlaying any injected test doubles.
export function resolveTransportDeps(overrides?: Partial<TransportDeps>): TransportDeps {
  const fetchFn: FetchFn =
    overrides?.fetchFn ??
    ((input, init) => (globalThis.fetch as unknown as FetchFn)(input, init));
  return {
    fetchFn,
    timeoutMs: overrides?.timeoutMs ?? intAtLeastOrDefault(envValue('PROVIDER_TIMEOUT_MS'), 1, DEFAULT_TIMEOUT_MS),
    maxRetries:
      overrides?.maxRetries ?? intAtLeastOrDefault(envValue('PROVIDER_MAX_RETRIES'), 0, DEFAULT_MAX_RETRIES),
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

// How a caller consumes an OK response. It runs INSIDE the timeout window — see the
// note on requestWithRetry.
export type ReadBody<T> = (response: Response) => Promise<T>;

type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number };

// Execute one request AND its body read under a single hard timeout. The abort must
// stay armed across the read: a Response resolves as soon as HEADERS arrive, so
// clearing the timer there left every body read unbounded.
async function attemptOnce<T>(
  url: string,
  init: RequestInit,
  deps: TransportDeps,
  readBody: ReadBody<T>,
): Promise<Attempt<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchFn(url, { ...init, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: await readBody(response) };
  } finally {
    clearTimeout(timer);
  }
}

// Request with bounded retry on transient (429/5xx) responses. Returns what `readBody`
// made of the first OK response; throws ProviderRequestError once retries are exhausted
// or on a non-retryable non-OK status. Thrown transport errors (timeout/abort/network)
// are NOT retried and propagate to the caller.
//
// WHY THE BODY READ IS A CALLBACK AND NOT THE CALLER'S BUSINESS. This used to return
// the Response, so every adapter's `response.json()` / `.arrayBuffer()` ran after the
// timer had already been cleared — outside any timeout. A vendor (or a proxy) that
// sends 200 + headers and then stalls the chunked body therefore hung the parse
// FOREVER, with parse_jobs still at status='processing': the row is unre-claimable for
// the whole claim lease, so the user's retries get 409 'already being parsed' for a job
// nothing is working on. Taking the reader as a callback is what makes the read
// impossible to perform outside the timeout window, rather than merely wrong to.
export async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  deps: TransportDeps,
  readBody: ReadBody<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const attempted = await attemptOnce(url, init, deps, readBody);
    if (attempted.ok) return attempted.value;
    if (isRetryableStatus(attempted.status) && attempt < deps.maxRetries) {
      await deps.sleep(backoffMs(attempt, deps.random));
      continue;
    }
    throw new ProviderRequestError('provider request failed', attempted.status);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
