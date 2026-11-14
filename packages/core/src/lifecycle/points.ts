// Does:  Fires a request's five lifecycle points and hands application code the request's one logger.
// Holds: Every point counts through #diag before it offers the logger anything; closed fires once per start.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { count } from '#diag';
import { readCorrelation } from '../log/correlation.ts';
import { type HookErrorReason, KNOWN_METHODS, type RefusalEvent } from '../log/events.ts';
import { OTHER } from '../log/limits.ts';
import type { Correlation, RequestLog, ServerLog } from '../log/shapes.ts';
import type { Logger } from '../log/types.ts';
import { resolveClient } from './client-address.ts';
import type { Exchange, Failure } from './exchange.ts';
import type { EngineRuntime, RouteRuntime } from './types.ts';

const NO_CORRELATION: Correlation = Object.freeze({ inboundId: null, traceId: null, traceFlags: null });

// Does:  Counts the response's close and offers the access record when the access option is on.
function pointClosed(log: ServerLog, request: RequestLog, res: ServerResponse): void {
  const outcome = res.writableFinished ? 'completed' : 'aborted';
  count('point.closed', outcome);
  if (log.access) {
    log.ended(request, outcome, res.headersSent ? res.statusCode : null, performance.now() - request.startedAt);
  }
}

// Does:  Starts a request: mints the id its response head will carry and watches the response's one close.
// Holds: The close listener is the only one this feature attaches, and Node emits a response's close at most once.
export function pointStart(runtime: EngineRuntime, req: IncomingMessage, res: ServerResponse): RequestLog {
  const startedAt = performance.now();
  const raw = req.method;
  const method = raw !== undefined && KNOWN_METHODS.has(raw) ? raw : OTHER;
  count('point.start', method);
  const { log } = runtime;
  const correlation = log.correlation ? readCorrelation(req.headers) : NO_CORRELATION;
  const request: RequestLog = {
    id: randomUUID(),
    startedAt,
    method,
    traceId: correlation.traceId,
    traceFlags: correlation.traceFlags,
    inboundId: correlation.inboundId,
    route: null,
    // Why: Read now, while the socket is open, so a record written after the client left still has the address.
    address: log.clientAddress ? resolveClient(req, runtime.trustProxy) : null,
  };
  res.once('close', () => pointClosed(log, request, res));
  return request;
}

export function pointRouted(request: RequestLog, route: RouteRuntime): void {
  count('point.routed', route.info.name);
  request.route = route.info.path;
}

// Does:  Counts a refusal the engine made and offers its record, before the refusal's response is written.
export function pointRefused(
  log: ServerLog,
  request: RequestLog,
  event: RefusalEvent,
  status: number,
  errorType: string,
  reason: string | null,
): void {
  count('point.refused', event);
  log.refused(event, request, status, errorType, reason);
}

// Does:  Counts a request's failure and holds the engine's classification of it until the error response is written.
export function pointFailed(exchange: Exchange, failure: Failure): void {
  count('point.failed', failure.reason);
  exchange.failure = failure;
}

// Does:  Offers the request's one error record once the engine wrote or destroyed its response.
// Holds: Only a thrown value or an HttpError is admitted to the error reader; any other reason reads nothing.
export function pointErrorWritten(
  exchange: Exchange,
  failure: Failure,
  status: number,
  errorType: string | null,
): void {
  const { reason, value, location } = failure;
  const read = reason === 'thrown' || reason === 'http_error';
  exchange.runtime.log.failed('skeld.request.error', exchange.log, status, errorType, reason, read, value, location);
}

// Does:  Counts an observer's failure and offers its record at once, since the response it observed is unchanged.
export function pointHookFailed(exchange: Exchange, reason: HookErrorReason, value: unknown): void {
  count('point.failed', reason);
  const { res } = exchange;
  const status = res.headersSent ? res.statusCode : null;
  const read = reason !== 'late_send';
  exchange.runtime.log.failed('skeld.hook.error', exchange.log, status, null, reason, read, value, null);
}

// Does:  Returns the request's logger, made on first read and shared by its hooks and its handler.
export function loggerOf(exchange: Exchange): Logger {
  if (exchange.logger === null) {
    exchange.logger = exchange.runtime.log.logger(exchange.log);
  }
  return exchange.logger;
}
