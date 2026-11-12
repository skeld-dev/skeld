// Does:  Turns anything thrown or refused into the one error shape via onError hooks and handlers; answers timeouts.
// Holds: A non-HttpError is answered with the fixed 500 body and no cookie; after a timeout nothing more is called.

import { isProxy } from 'node:util/types';
import { authorResult } from './author-result.ts';
import { contain, count, destroyed, end, event, leave, next, resume, start, type Token } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { CsrfReason } from '../csrf/check.ts';
import type { ErrorBody } from '../contract/types.ts';
import type { RefusalEvent } from '../log/events.ts';
import { CHAIN_MAX } from '../log/limits.ts';
import type { ErrorContext } from '../server/types.ts';
import { stageBodyRefusal } from './body-refusal.ts';
import { settle, timeoutReason } from './deadline.ts';
import { collectCookies } from './cookies.ts';
import { faultOf } from './engine-fault.ts';
import type { Exchange, Failure } from './exchange.ts';
import { ErrorContextRecord, runObservers } from './hooks.ts';
import { pointErrorWritten, pointFailed, pointHookFailed, pointRefused } from './points.ts';
import { CROSS_ORIGIN_BODY, INTERNAL_BODY, writeErrorBody } from './wire.ts';

const TIMEOUT_BODY: ErrorBody = { status: 503, code: 'TIMEOUT', message: 'Request timed out' };
const FIRST_SERVER_ERROR = 500;

// Does:  Tells whether a value is an instance of an engine class by comparing its prototypes, calling none of its code.
// Holds: No Proxy, the value or a prototype, is asked for its prototype, and at most CHAIN_MAX prototypes are read.
function isInstance<T>(value: unknown, type: { readonly prototype: T }): value is T {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let current: object = value;
  for (let seen = 0; seen < CHAIN_MAX; seen++) {
    if (isProxy(current)) {
      return false;
    }
    const prototype: object | null = Object.getPrototypeOf(current);
    if (prototype === null) {
      return false;
    }
    if (prototype === type.prototype) {
      return true;
    }
    current = prototype;
  }
  return false;
}

// Does:  Reads a thrown value into an error body: the fixed 500 for a non-HttpError, null when reading it throws.
function readThrown(value: unknown): ErrorBody | null {
  try {
    if (!isInstance(value, HttpError)) {
      return INTERNAL_BODY;
    }
    const { status, code, message, details } = value;
    if (status === null) {
      return INTERNAL_BODY;
    }
    return details === null ? { status, code, message } : { status, code, message, details };
  } catch {
    // Why: A thrown value's fields can be accessors or a proxy; one that throws must not escape the error path.
    return null;
  }
}

function toErrorBody(value: unknown): ErrorBody | null {
  const body = readThrown(value);
  if (body === null || body === INTERNAL_BODY) {
    event('err.internal');
    return body;
  }
  count('err.http_error', body.code);
  return body;
}

// Does:  Keeps a child span of the error stage on the exchange, so a timeout can close it in order.
function holdChild(exchange: Exchange, token: Token): Token {
  exchange.child = token;
  return token;
}

function closeChild(exchange: Exchange, token: Token): void {
  if (exchange.child === token) {
    end(token);
    exchange.child = 0;
  }
}

// Does:  Classifies a failure by the value that caused it: the engine's own fault, an HttpError, or anything else.
function failureOf(value: unknown): Failure {
  const fault = faultOf(value);
  if (fault !== undefined) {
    return { reason: fault.reason, value, location: fault.location };
  }
  return { reason: isInstance(value, HttpError) ? 'http_error' : 'thrown', value, location: null };
}

function mismatchOf(value: unknown): Failure {
  return { reason: 'response_mismatch', value, location: null };
}

// Does:  Collects the cookies an HttpError names for its response; throws when one of them is invalid.
function errorCookies(outcome: unknown): Map<string, string> | null {
  return isInstance(outcome, HttpError) && outcome.cookies !== null ? collectCookies(null, outcome.cookies) : null;
}

// Does:  Writes the error response once; offers the error record when a failure is answered with a 5xx.
// Holds: The reason is the failure held since it happened, unless the value left cannot be written as its own body.
function answer(exchange: Exchange, outcome: unknown, returned: boolean): void {
  if (exchange.state !== 'running') {
    return;
  }
  const read = toErrorBody(outcome);
  // Why: An error handler must return an HttpError; anything else it returns is answered as the fixed 500.
  let override = read === null || (returned && failureOf(outcome).reason !== 'http_error') ? mismatchOf(outcome) : null;
  let cookies: Map<string, string> | null = null;
  if (override === null && read !== null && read !== INTERNAL_BODY) {
    try {
      cookies = errorCookies(outcome);
    } catch (error) {
      // Why: An error that names an invalid cookie is answered as the fixed 500, which carries no cookie at all.
      override = failureOf(error);
    }
  }
  const body = override !== null || read === null ? INTERNAL_BODY : read;
  // Why: After a refusal nothing is held; a 5xx body made from an error handler's HttpError is that handler's failure.
  const chosen = override ?? exchange.failure ?? failureOf(outcome);
  settle(exchange, 'written');
  end(exchange.stage);
  const matched = writeErrorBody(
    exchange.runtime,
    exchange.res,
    exchange.method,
    body,
    exchange.closeConnection,
    cookies,
    exchange.cors,
  );
  const written = matched ? body : INTERNAL_BODY;
  const failure = matched ? chosen : mismatchOf(outcome);
  if (written.status < FIRST_SERVER_ERROR) {
    return;
  }
  if (exchange.failure === null) {
    pointFailed(exchange, failure);
  }
  pointErrorWritten(exchange, failure, written.status, written.code);
}

// Does:  Passes the error through the error handlers in order; a handler that throws hands its error to the next.
function classify(exchange: Exchange, context: ErrorContext, index: number, current: unknown): void {
  const handler = exchange.route.errorHandlers[index];
  if (handler === undefined || exchange.state !== 'running') {
    answer(exchange, current, false);
    return;
  }
  const rethrown = (error: unknown): void => {
    // Why: After a refusal, an error handler's throw is the request's first failure.
    if (exchange.failure === null) {
      pointFailed(exchange, failureOf(error));
    }
    classify(exchange, context, index + 1, error);
  };
  const span = holdChild(exchange, start('err.handler', index));
  authorResult<HttpError>(
    () => handler(current, context),
    (value, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        closeChild(exchange, span);
        answer(exchange, value, true);
      } finally {
        if (asynchronous) {
          leave(exchange.diag);
        }
      }
    },
    (error, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        closeChild(exchange, span);
        rethrown(error);
      } finally {
        if (asynchronous) {
          leave(exchange.diag);
        }
      }
    },
    () => exchange.runtime.deadlines.wait(exchange),
    (failure) => pointHookFailed(exchange, 'internal', failure),
  );
}

// Does:  Runs the onError hooks and the error handlers for a running request; failed is false for a refusal.
function enterErrorPath(exchange: Exchange, error: unknown, failed: boolean): void {
  exchange.stage = next(exchange.stage, 'err.path');
  const { res } = exchange;
  // Why: Headers are already on the wire, so no error body can follow; the socket is destroyed instead.
  if (res.headersSent) {
    const failure: Failure = { reason: 'headers_sent', value: error, location: null };
    pointFailed(exchange, failure);
    settle(exchange, 'written');
    event('err.headers_sent');
    end(exchange.stage);
    res.destroy();
    destroyed();
    pointErrorWritten(exchange, failure, res.statusCode, null);
    return;
  }
  if (failed) {
    pointFailed(exchange, failureOf(error));
  }
  const context = new ErrorContextRecord(exchange);
  contain('error', context);
  const observers = holdChild(exchange, start('err.hook.on_error'));
  runObservers(
    exchange,
    exchange.route.hooks.onError,
    (hook) => hook(context, error),
    (hookError) => pointHookFailed(exchange, 'on_error', hookError),
    () => exchange.runtime.deadlines.wait(exchange),
    () => exchange.state !== 'running',
    () => {
      closeChild(exchange, observers);
      classify(exchange, context, 0, error);
    },
  );
}

// Does:  Enters the error path for a request still running; after a response it only records the late throw.
export function fail(exchange: Exchange, error: unknown): void {
  if (exchange.state === 'running') {
    enterErrorPath(exchange, error, true);
    return;
  }
  // Why: A late send already offered its own record; recording its throw again would duplicate it.
  if (error !== exchange.lateSendError) {
    pointHookFailed(exchange, 'after_response', error);
  }
}

// Does:  Records a refusal the engine made after routing, then answers it through the error path as a non-failure.
// Holds: Called only for a running request; the refusal record carries the engine's status and code, not a handler's.
export function refuse(exchange: Exchange, refusal: RefusalEvent, error: HttpError): void {
  // Why: An HttpError with a null status is written as the fixed 500 (contract/http-error.ts), so its record is too.
  const decided = error.status === null ? INTERNAL_BODY : { status: error.status, code: error.code };
  pointRefused(exchange.runtime.log, exchange.log, refusal, decided.status, decided.code, null);
  enterErrorPath(exchange, error, false);
}

// Does:  Answers a request past its time limit with 503 and closes the connection; no onError hook or handler runs.
// Holds: Called only for a running request; afterwards its signal is aborted and any later reply is dropped.
export function expire(exchange: Exchange): void {
  const { req, res, route } = exchange;
  resume(exchange.diag);
  exchange.state = 'timed-out';
  exchange.abort?.abort(timeoutReason());
  event('refuse.handler_timeout', route.info.name);
  const { cancelRead } = exchange;
  if (cancelRead !== null) {
    exchange.cancelRead = null;
    cancelRead();
  }
  end(exchange.child);
  exchange.child = 0;
  end(exchange.stage);
  const failure: Failure = { reason: 'timeout', value: null, location: null };
  pointFailed(exchange, failure);
  if (res.headersSent) {
    res.destroy();
    destroyed();
    pointErrorWritten(exchange, failure, res.statusCode, null);
  } else {
    // Why: A body still arriving would reset the connection under the response unless its close is staged.
    if (route.readsBody && !req.complete) {
      stageBodyRefusal(req);
    }
    exchange.closeConnection = true;
    const matched = writeErrorBody(exchange.runtime, res, exchange.method, TIMEOUT_BODY, true, null, exchange.cors);
    const written = matched ? TIMEOUT_BODY : INTERNAL_BODY;
    pointErrorWritten(exchange, failure, written.status, written.code);
  }
  leave(exchange.diag);
}

// Does:  Answers a request the cross-site check refused with the fixed 403; no hook, error handler or handler runs.
// Holds: Called before any hook of a running request; the connection closes because the body is unread.
export function refuseCrossSite(exchange: Exchange, reason: CsrfReason): void {
  const { req, res, route, runtime } = exchange;
  event('refuse.csrf', reason);
  const { status, code } = CROSS_ORIGIN_BODY;
  pointRefused(runtime.log, exchange.log, 'skeld.refuse.csrf', status, code, reason);
  // Why: Once per server, so refused requests cannot flood the log; each refusal still has its own record.
  if (reason === 'unverifiable' && !runtime.notices.publicOrigin) {
    runtime.notices.publicOrigin = true;
    runtime.log.publicOriginHint();
  }
  settle(exchange, 'written');
  end(exchange.stage);
  if (route.readsBody && !req.complete) {
    stageBodyRefusal(req);
  }
  exchange.closeConnection = true;
  writeErrorBody(runtime, res, exchange.method, CROSS_ORIGIN_BODY, true, null, exchange.cors);
}
