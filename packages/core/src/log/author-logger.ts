// Does:  Builds the author's logger: five methods that turn a message and its fields into one app record.
// Holds: The app threshold is tested before the message or any field is read, and no method throws for any argument.

import { SEVERITY_NUMBER } from './events.ts';
import { encodeFields } from './fields.ts';
import { INVALID_MARKER } from './limits.ts';
import type { ErrorOptions, RecordParts, RequestLog } from './shapes.ts';
import type { LogFields, Logger, Severity } from './types.ts';

// Does:  What an author's logger needs of its server's logger, and nothing of a request but its RequestLog.
export interface AuthorOutlet {
  readonly threshold: number;
  errorOptions(): ErrorOptions;
  offer(parts: RecordParts): void;
}

// Holds: The logger holds the outlet and the RequestLog only, never a request, a response or a socket.
export function createLogger(outlet: AuthorOutlet, request: RequestLog | null): Logger {
  const method =
    (severity: Severity) =>
    (message: string, fields?: LogFields): void => {
      if (SEVERITY_NUMBER[severity] < outlet.threshold) {
        return;
      }
      outlet.offer({
        timeMs: Date.now(),
        severity,
        event: 'skeld.app.message',
        category: 'app',
        // Why: The type declares a string, but a caller outside the compiler can pass anything; it is not read.
        message: typeof message === 'string' ? message : INVALID_MARKER,
        request,
        engine: false,
        status: null,
        errorType: null,
        reason: null,
        error: null,
        extra: null,
        fields: fields === undefined ? null : encodeFields(fields, outlet.errorOptions()),
      });
    };
  return Object.freeze({
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
    fatal: method('fatal'),
  });
}
