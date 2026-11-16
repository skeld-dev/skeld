// Does:  Builds one server's logger: the engine's records, the author's loggers, the summaries, the stats and close.
// Holds: A record is tested against its threshold, then suppression, before anything of a thrown value is read.

import { end, logLine, start } from '#diag';
import { createLogger } from './author-logger.ts';
import { createDestination } from './destination.ts';
import { readError } from './error-reader.ts';
import { type Category, EVENTS, SEVERITY_NUMBER } from './events.ts';
import { encodeFields } from './fields.ts';
import { encodeRecord } from './line.ts';
import type { ErrorOptions, RecordParts, RequestLog, ResolvedLog, ServerLog } from './shapes.ts';
import { createSuppression } from './suppress.ts';
import type { LogStats, Logger, Severity } from './types.ts';

type EngineEvent = Exclude<keyof typeof EVENTS, 'skeld.log.suppressed' | 'skeld.app.message'>;

interface Spec {
  readonly category: Category;
  readonly severity: Severity;
}

const none = (): void => undefined;

function isEventName(event: string): event is keyof typeof EVENTS {
  return Object.hasOwn(EVENTS, event);
}

const SILENT: Logger = Object.freeze({ debug: none, info: none, warn: none, error: none, fatal: none });

// Why: Under `log: false` nothing is created, so every count is zero.
const DISABLED: ServerLog = Object.freeze({
  access: false,
  correlation: false,
  clientAddress: false,
  ready: none,
  listening: none,
  publicOriginHint: none,
  refused: none,
  failed: none,
  security: none,
  ended: none,
  logger: () => SILENT,
  stats: (): LogStats => ({
    created: 0,
    written: 0,
    queued: 0,
    queuedBytes: 0,
    inFlight: 0,
    inFlightBytes: 0,
    pendingMs: 0,
    suppressed: 0,
    dropped: { queue_full: 0, reserve: 0, write_failed: 0, sink_failed: 0, shutdown: 0 },
  }),
  close: () => Promise.resolve(),
});

// Does:  The totals a closed or dropped record carries, one key per count and one per drop reason.
function totals(stats: LogStats): (readonly [string, number])[] {
  return [
    ['skeld.log.created', stats.created],
    ['skeld.log.written', stats.written],
    ['skeld.log.queued', stats.queued],
    ['skeld.log.in_flight', stats.inFlight],
    ['skeld.log.suppressed', stats.suppressed],
    ...Object.entries(stats.dropped).map(([reason, dropped]) => [`skeld.log.dropped.${reason}`, dropped] as const),
  ];
}

function engineRecord(
  event: string,
  spec: Spec,
  request: RequestLog | null,
  status: number | null,
  extra: RecordParts['extra'],
): RecordParts {
  return {
    timeMs: Date.now(),
    severity: spec.severity,
    event,
    category: spec.category,
    message: null,
    request,
    engine: true,
    status,
    errorType: null,
    reason: null,
    error: null,
    extra,
    fields: null,
  };
}

// Holds: Only a server with a gate keeps a map of its loggers; without one, logger() adds nothing per call.
export function createServerLog(resolved: ResolvedLog, gated = false): ServerLog {
  if (!resolved.enabled) {
    return DISABLED;
  }
  let errorOptions: ErrorOptions = Object.freeze({
    identifiers: resolved.errorIdentifiers,
    text: resolved.errorText,
    frames: resolved.errorFrames,
    cwd: '',
  });
  let closing: Promise<void> | null = null;
  const securitySeverities = new Map<string, Severity>();
  const loggers = gated ? new WeakMap<object, RequestLog | null>() : null;
  const suppression = createSuppression((event, route, refused) => {
    const spec = summarySpec(event);
    if (spec === null) {
      return;
    }
    const { category, severity } = spec;
    // Why: The summary skips the threshold, which its event already passed to be admitted, and is never suppressed.
    offer(
      engineRecord('skeld.log.suppressed', { category, severity }, null, null, [
        ['skeld.suppressed.event_name', event],
        ['skeld.suppressed.count', refused],
        ...(route === null ? [] : [['http.route', route] as const]),
      ]),
    );
  });
  const destination = createDestination(resolved, () => {
    const spec = admitted('skeld.log.dropped');
    if (spec !== null) {
      offer(engineRecord('skeld.log.dropped', spec, null, null, totals(stats())));
    }
  });
  const outlet = { threshold: resolved.thresholds.app, errorOptions: () => errorOptions, offer };

  // Does:  Hands one finished record to the destination; every line the logger makes leaves through here.
  // Holds: Only a record at warn or above uses the queue's reserve, unless its caller grants it explicitly.
  function offer(parts: RecordParts, reserve = SEVERITY_NUMBER[parts.severity] >= SEVERITY_NUMBER.warn): void {
    const line = encodeRecord(parts);
    logLine(line, parts.event);
    destination.enqueue(line, reserve);
  }

  // Does:  The event's category and severity when it passes its category's threshold, else null.
  function admitted(event: EngineEvent): Spec | null {
    const { category, severity } = EVENTS[event];
    // Why: Every engine event has both in the table; only the summary and the author's record leave them open.
    if (category === null || severity === null) {
      return null;
    }
    // Why: The access record has no threshold: the access option alone turns it on.
    if (category !== 'access' && SEVERITY_NUMBER[severity] < resolved.thresholds[category]) {
      return null;
    }
    return { category, severity };
  }

  // Does:  The category and severity a suppression summary takes from the event it counts.
  function summarySpec(event: string): Spec | null {
    const security = securitySeverities.get(event);
    if (security !== undefined) {
      return { category: 'security', severity: security };
    }
    if (!isEventName(event)) {
      return null;
    }
    const { category, severity } = EVENTS[event];
    // Why: Every suppressed event has both in the table; only the summary's own entry leaves them to the caller.
    return category === null || severity === null ? null : { category, severity };
  }

  function stats(): LogStats {
    return { ...destination.counts(), suppressed: suppression.suppressed() };
  }

  return {
    access: resolved.access,
    correlation: resolved.correlation,
    clientAddress: resolved.clientAddress,
    ready(templates, cwd) {
      suppression.ready(templates);
      errorOptions = Object.freeze({ ...errorOptions, cwd });
    },
    listening(address, port) {
      const spec = admitted('skeld.server.listening');
      if (spec !== null) {
        offer(
          engineRecord('skeld.server.listening', spec, null, null, [
            ['server.address', address],
            ['server.port', port],
          ]),
        );
      }
    },
    publicOriginHint() {
      const spec = admitted('skeld.config.public_origin');
      if (spec !== null) {
        offer(engineRecord('skeld.config.public_origin', spec, null, null, null));
      }
    },
    refused(event, request, status, errorType, reason) {
      const spec = admitted(event);
      if (spec === null || !suppression.admit(event, request.route)) {
        return;
      }
      offer({ ...engineRecord(event, spec, request, status, null), errorType, reason });
    },
    // Holds: The value is read only after threshold and suppression passed, and only when read is true.
    failed(event, request, status, errorType, reason, read, value, detail) {
      const spec = admitted(event);
      if (spec === null || !suppression.admit(event, request === null ? null : request.route)) {
        return;
      }
      const span = start('log.record');
      const error = read ? readError(value, errorOptions) : null;
      offer({
        ...engineRecord(event, spec, request, status, detail === null ? null : [detail]),
        errorType,
        reason,
        error,
      });
      end(span);
    },
    ended(request, outcome, status, durationMs) {
      const spec = admitted('skeld.request.closed');
      if (spec !== null) {
        offer(
          engineRecord('skeld.request.closed', spec, request, status, [
            ['skeld.outcome', outcome],
            // Why: The duration is written in milliseconds with three decimals.
            ['skeld.duration_ms', Math.round(durationMs * 1000) / 1000],
          ]),
        );
      }
    },
    // Holds: Only a logger this server made writes, so a record can never claim another server's request.
    security(event, severity, logger, fields) {
      if (loggers === null || typeof logger !== 'object' || logger === null || !loggers.has(logger)) {
        return;
      }
      const request = loggers.get(logger) ?? null;
      securitySeverities.set(event, severity);
      if (SEVERITY_NUMBER[severity] < resolved.thresholds.security) {
        return;
      }
      if (!suppression.admit(event, request === null ? null : request.route)) {
        return;
      }
      offer({
        ...engineRecord(event, { category: 'security', severity }, request, null, null),
        fields: fields === undefined ? null : encodeFields(fields, errorOptions),
      });
    },
    logger(request) {
      const made = createLogger(outlet, request);
      loggers?.set(made, request);
      return made;
    },
    stats,
    close() {
      if (closing !== null) {
        return closing;
      }
      const spec = admitted('skeld.server.closed');
      if (spec !== null) {
        // Why: The closed record carries the drop totals, which matter most after an overload filled the queue.
        offer(engineRecord('skeld.server.closed', spec, null, null, totals(stats())), true);
      }
      suppression.flush();
      closing = destination.close(resolved.flushTimeoutMs);
      return closing;
    },
  };
}
