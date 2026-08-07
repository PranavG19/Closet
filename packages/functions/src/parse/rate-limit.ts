// Provider-spend throttle for parse-photo — the per-user ceiling on how often one
// caller can reach the PAID vision/cutout providers. The teaser cap bounds LIFETIME
// spend for an unentitled user; this bounds the RATE for everyone (an entitled user
// with a stolen token, or a client retry loop, is otherwise unbounded).
//
// This file holds only the constants, the env config, the 429 shape, and the narrow
// seam the DB limiter must satisfy. The counting itself is a DB concern (one atomic
// statement / one plpgsql fn behind a repo) and is authored in @closet/db by the
// sibling task; nothing here writes SQL.
import { makeRateLimitRepo, type QueryExecutor } from '@closet/db';
import { errorResponse } from '../auth/respond.js';

// One named bucket so a future throttled endpoint gets its own budget instead of
// silently sharing this one.
export const PARSE_SPEND_BUCKET = 'parse_photo';

// Client-facing code (fixed, non-PII) and its human string.
export const RATE_LIMITED_CODE = 'parse_rate_limited';
const RATE_LIMITED_MESSAGE = 'Too many parse requests. Please try again shortly.';

// Defaults are the ENFORCED values, not a fallback to "off": a missing, empty, or
// garbage env yields these, so misconfiguration can never disable the limiter (it
// can only fail back to the conservative default). There is deliberately NO env
// value that means unlimited.
export const DEFAULT_PARSE_RATE_LIMIT = 20;
export const DEFAULT_PARSE_RATE_WINDOW_SECONDS = 60 * 60;

export const PARSE_RATE_LIMIT_ENV = 'PARSE_RATE_LIMIT_MAX';
export const PARSE_RATE_WINDOW_ENV = 'PARSE_RATE_LIMIT_WINDOW_SECONDS';

export interface RateLimitConfig {
  readonly limit: number;
  readonly windowSeconds: number;
}

// A configured value only wins if it is a positive integer. Anything else — unset,
// '', 'off', '0', '-1', '1e9', 'Infinity', '12.5' — falls back to the default.
function positiveIntOrDefault(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseRateLimitConfig(readEnv: (key: string) => string | undefined): RateLimitConfig {
  return {
    limit: positiveIntOrDefault(readEnv(PARSE_RATE_LIMIT_ENV), DEFAULT_PARSE_RATE_LIMIT),
    windowSeconds: positiveIntOrDefault(
      readEnv(PARSE_RATE_WINDOW_ENV),
      DEFAULT_PARSE_RATE_WINDOW_SECONDS,
    ),
  };
}

export interface ConsumeSpendTokenInput {
  // ALWAYS the verified JWT sub. There is no other identity input on this seam.
  readonly userId: string;
  readonly bucket: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  // Seconds until the caller's window frees a slot — the client retry hint.
  readonly retryAfterSeconds: number;
}

// The narrow seam parse-photo needs. The DB-backed implementation lives behind a
// repo in @closet/db (repos are the ONLY DB path); a test injects a fake.
export interface SpendLimiter {
  consume(input: ConsumeSpendTokenInput): Promise<RateLimitDecision>;
}

// Built per request from the caller's own tenant-scoped executor, so the token row
// is written under the caller's RLS context exactly like every other write.
export type ProvideSpendLimiter = (exec: QueryExecutor) => SpendLimiter;

// Fail-closed placeholder kept for tests that assert an unwired build refuses rather
// than serving an unthrottled paid endpoint. It THROWS: the outer handler catch turns
// that into a 500 with zero provider calls. The production binding uses
// dbSpendLimiter below, NOT this.
export const unwiredSpendLimiter: ProvideSpendLimiter = () => ({
  async consume(): Promise<RateLimitDecision> {
    throw new Error('parse spend limiter is not wired');
  },
});

// The REAL limiter: the @closet/db repo over the caller's own tenant-scoped executor,
// so the counter row is written under the caller's RLS context like every other write
// (migration 0015's policies bind auth.uid(), and a mismatched user_id raises 42501).
// This bridges two deliberately different shapes: the repo speaks Postgres
// (positional args, an `interval` string, an { admitted } row) while the handler
// speaks HTTP (windowSeconds, a retry hint). Converting here keeps SQL vocabulary out
// of the handler and HTTP vocabulary out of the repo.
export const dbSpendLimiter: ProvideSpendLimiter = (exec) => ({
  async consume({ userId, bucket, limit, windowSeconds }): Promise<RateLimitDecision> {
    // The repo fails CLOSED on a missing/NULL answer, so `admitted` is always a real
    // boolean decision — never a "maybe" on a spend path.
    const { admitted } = await makeRateLimitRepo(exec).consume(
      userId,
      bucket,
      limit,
      `${windowSeconds} seconds`,
    );
    // A fixed window gives no per-caller "slot frees at T" answer without reading the
    // row back, so the hint is the window length: the honest upper bound on the wait.
    return { allowed: admitted, retryAfterSeconds: admitted ? 0 : windowSeconds };
  },
});

// Test-support default for handlers built without a limiter (the pre-existing
// parse-photo oracles). NEVER used by the production binding below.
export const unthrottledSpendLimiter: ProvideSpendLimiter = () => ({
  async consume(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

// 429 + a standard Retry-After hint. The body keeps the fixed { error: { code,
// message } } envelope (no counts, no identifiers — nothing a caller can mine).
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  const response = errorResponse(429, RATE_LIMITED_CODE, RATE_LIMITED_MESSAGE);
  response.headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return response;
}
