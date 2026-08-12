// Mobile structured logger — a deliberate COPY of packages/functions/src/auth/logger.ts,
// not an import: mobile depends on `shared` only, never `functions` (the package boundary).
// This is the same accepted pattern config.ts already uses for its one-off warn line. Same
// contract as the server logger: one JSON line per event through the single sanctioned sink
// (globalThis.console via bracket access — `console.` member access is lint-banned), a fixed
// field vocabulary that CANNOT carry a raw Error or a request body, so there is no PII path.
//
// The `correlationId` here is read from the server's `x-correlation-id` response header
// (emitted by withAuth), so a client `api_error` line joins to the exact server `request`
// line — the thread that was missing while the client half was dark.

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  readonly event: string;
  readonly [key: string]: string | number | boolean | undefined;
}

interface ConsoleLike {
  log(line: string): void;
}

function sink(): ConsoleLike {
  return (globalThis as { console: ConsoleLike }).console;
}

function emit(level: LogLevel, fields: LogFields): void {
  sink().log(JSON.stringify({ level, ...fields }));
}

export const logger = {
  info(fields: LogFields): void {
    emit('info', fields);
  },
  warn(fields: LogFields): void {
    emit('warn', fields);
  },
  error(fields: LogFields): void {
    emit('error', fields);
  },
};
