// Does:  Turns anything thrown or refused into the one error shape via onError hooks and handlers; answers timeouts.
// Holds: A non-HttpError is answered with the fixed 500 body and no cookie; after a timeout nothing more is called.

import { authorResult } from './author-result.ts';
import { contain, count, destroyed, end, event, leave, next, resume, start, type Token } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { CsrfReason } from '../csrf/check.ts';
import type { ErrorBody } from '../contract/types.ts';
import type { ErrorContext } from '../server/types.ts';
import { stageBodyRefusal } from './body-refusal.ts';
import { settle, timeoutReason } from './deadline.ts';
import { collectCookies } from './cookies.ts';
import type { Exchange } from './exchange.ts';
import { ErrorContextRecord, runObservers } from './hooks.ts';
import { describeThrown, writeStderrLine } from './stderr.ts';
import { CROSS_ORIGIN_BODY, INTERNAL_BODY, writeErrorBody } from './wire.ts';

const ERROR_BODY_MISMATCH = 'error body does not match the error schema; the fixed 500 body was written';
const TIMEOUT_BODY: ErrorBody = { status: 503, code: 'TIMEOUT', message: 'Request timed out' };
const PUBLIC_ORIGIN_HINT =
  'cross-site check refused a request with Origin and no Sec-Fetch-Site; origin verification needs the publicOrigin option';

// Does:  Reads a thrown value into an error body: the fixed 500 for a non-HttpError, null when reading it throws.
function readThrown(value: unknown): ErrorBody | null {
  try {
    if (!(value instanceof HttpError)) {
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

function report(exchange: Exchange, status: number, message: string): void {
  writeStderrLine(exchange.method, exchange.route.info.path, status, exchange.route.info.name, message);
}

// Does:  Collects the cookies an HttpError names for its response; throws when one of them is invalid.
function errorCookies(outcome: unknown): Map<string, string> | null {
  return outcome instanceof HttpError && outcome.cookies !== null ? collectCookies(null, outcome.cookies) : null;
}

interface Pending {
  readonly thrown: unknown[];
  readonly hookFailures: readonly string[];
}

// Does:  Writes the error response once, and puts on stderr what the wire never carries.
// Holds: Nothing is written when a response was already sent; only the hook failures are reported.
function answer(exchange: Exchange, outcome: unknown, pending: Pending): void {
  if (exchange.state !== 'running') {
    for (const message of pending.hookFailures) {
      report(exchange, exchange.res.statusCode, message);
    }
    return;
  }
  const read = toErrorBody(outcome);
  let cookies: Map<string, string> | null = null;
  let cookieFailure: string | null = null;
  if (read !== null && read !== INTERNAL_BODY) {
    try {
      cookies = errorCookies(outcome);
    } catch (error) {
      // Why: An error that names an invalid cookie is answered as the fixed 500, which carries no cookie at all.
      cookieFailure = describeThrown(error);
    }
  }
  const body = read === null || cookieFailure !== null ? INTERNAL_BODY : read;
  if (cookieFailure !== null) {
    report(exchange, body.status, cookieFailure);
  }
  for (const message of pending.hookFailures) {
    report(exchange, body.status, message);
  }
  if (!exchange.route.hasOnError) {
    for (const value of pending.thrown) {
      report(exchange, body.status, describeThrown(value));
    }
    if (pending.thrown.length === 0 && body.status >= 500) {
      report(exchange, body.status, describeThrown(outcome));
    }
  }
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
  if (read === null || !matched) {
    report(exchange, INTERNAL_BODY.status, ERROR_BODY_MISMATCH);
  }
}

// Does:  Passes the error through the error handlers in order; a handler that throws hands its error to the next.
function classify(exchange: Exchange, context: ErrorContext, index: number, current: unknown, pending: Pending): void {
  const handler = exchange.route.errorHandlers[index];
  if (handler === undefined || exchange.state !== 'running') {
    answer(exchange, current, pending);
    return;
  }
  const rethrown = (error: unknown): void => {
    pending.thrown.push(error);
    classify(exchange, context, index + 1, error, pending);
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
        answer(exchange, value, pending);
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
  );
}

function enterErrorPath(exchange: Exchange, error: unknown, thrown: boolean): void {
  const { res } = exchange;
  // Why: Headers are already on the wire, so no error body can follow; the socket is destroyed instead.
  if (res.headersSent) {
    settle(exchange, 'written');
    event('err.headers_sent');
    end(exchange.stage);
    res.destroy();
    destroyed();
    if (thrown && !exchange.route.hasOnError) {
      report(exchange, res.statusCode, describeThrown(error));
    }
    return;
  }
  const context = new ErrorContextRecord(exchange);
  contain('error', context);
  const hookFailures: string[] = [];
  const observers = holdChild(exchange, start('err.hook.on_error'));
  runObservers(
    exchange.diag,
    exchange.route.hooks.onError,
    (hook) => hook(context, error),
    (hookError) => hookFailures.push(`onError hook threw: ${describeThrown(hookError)}`),
    () => exchange.runtime.deadlines.wait(exchange),
    () => exchange.state !== 'running',
    () => {
      closeChild(exchange, observers);
      classify(exchange, context, 0, error, { thrown: thrown ? [error] : [], hookFailures });
    },
  );
}

// Does:  Enters the error path for a request still running; after a response it only reports the late throw.
export function fail(exchange: Exchange, error: unknown, thrown: boolean): void {
  if (exchange.state === 'running') {
    exchange.stage = next(exchange.stage, 'err.path');
    enterErrorPath(exchange, error, thrown);
    return;
  }
  // Why: A late send already wrote its own stderr line; reporting the same error again would duplicate it.
  if (error !== exchange.lateSendError && thrown && !exchange.route.hasOnError) {
    report(exchange, exchange.res.statusCode, describeThrown(error));
  }
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
  report(exchange, TIMEOUT_BODY.status, `request timed out after ${route.timeoutMs} ms`);
  if (res.headersSent) {
    res.destroy();
    destroyed();
  } else {
    // Why: A body still arriving would reset the connection under the response unless its close is staged.
    if (route.readsBody && !req.complete) {
      stageBodyRefusal(req);
    }
    exchange.closeConnection = true;
    writeErrorBody(exchange.runtime, res, exchange.method, TIMEOUT_BODY, true, null, exchange.cors);
  }
  leave(exchange.diag);
}

// Does:  Answers a request the cross-site check refused with the fixed 403; no hook, error handler or handler runs.
// Holds: Called before any hook of a running request; the connection closes because the body is unread.
export function refuseCrossSite(exchange: Exchange, reason: CsrfReason): void {
  const { req, res, route, runtime } = exchange;
  event('refuse.csrf', reason);
  // Why: Once per server, so refused requests cannot flood stderr; the diag event counts every one.
  if (reason === 'unverifiable' && !runtime.notices.publicOrigin) {
    runtime.notices.publicOrigin = true;
    report(exchange, CROSS_ORIGIN_BODY.status, PUBLIC_ORIGIN_HINT);
  }
  settle(exchange, 'written');
  end(exchange.stage);
  if (route.readsBody && !req.complete) {
    stageBodyRefusal(req);
  }
  exchange.closeConnection = true;
  writeErrorBody(runtime, res, exchange.method, CROSS_ORIGIN_BODY, true, null, exchange.cors);
}
