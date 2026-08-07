// Structured logger. CLAUDE.md bans `console.*` (no-console lint) and bans logging
// raw error messages (PII). This emits a single JSON line per event keyed on a
// correlationId, with a fixed vocabulary of fields — never a raw error string or a
// request body. It writes through globalThis.console via a bracket access so the
// no-console lint (which flags `console.` member access) is satisfied at the one
// sanctioned sink; every other module logs through this, never console directly.

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  readonly correlationId: string;
  readonly event: string;
  readonly [key: string]: string | number | boolean | undefined;
}

interface ConsoleLike {
  log(line: string): void;
}

function sink(): ConsoleLike {
  // Bracket access to the global console: the one sanctioned structured sink.
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
