// Does:  Turns anything thrown or refused into the one error shape, through the onError hooks and error handlers.
// Holds: A value that is not an HttpError with a status is answered with the fixed 500 body, never its own text.

import { contain, count, destroyed, end, event, leave, next, resume, start } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { ErrorBody } from '../contract/types.ts';
import type { ErrorContext } from '../server/types.ts';
import type { Exchange } from './exchange.ts';
import { ErrorContextRecord, runObservers } from './hooks.ts';
import { describeThrown, writeStderrLine } from './stderr.ts';
import { INTERNAL_BODY, writeErrorBody } from './wire.ts';

const ERROR_BODY_MISMATCH = 'error body does not match the error schema; the fixed 500 body was written';

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

function report(exchange: Exchange, status: number, message: string): void {
  writeStderrLine(exchange.method, exchange.path, status, exchange.route.info.name, message);
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
  const body = read ?? INTERNAL_BODY;
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
  exchange.state = 'written';
  end(exchange.stage);
  const matched = writeErrorBody(exchange.runtime, exchange.res, exchange.method, body, exchange.closeConnection);
  if (read === null || !matched) {
    report(exchange, INTERNAL_BODY.status, ERROR_BODY_MISMATCH);
  }
}

// Does:  Passes the error through the error handlers in order; a handler that throws hands its error to the next.
function classify(exchange: Exchange, context: ErrorContext, index: number, current: unknown, pending: Pending): void {
  const handler = exchange.route.errorHandlers[index];
  if (handler === undefined) {
    answer(exchange, current, pending);
    return;
  }
  const rethrown = (error: unknown): void => {
    pending.thrown.push(error);
    classify(exchange, context, index + 1, error, pending);
  };
  const span = start('err.handler', index);
  let settled: HttpError | null;
  let later: Promise<HttpError> | null;
  try {
    const result = handler(current, context);
    later = result instanceof Promise ? result : null;
    settled = result instanceof Promise ? null : result;
  } catch (error) {
    end(span);
    rethrown(error);
    return;
  }
  if (later !== null) {
    later.then(
      (value: HttpError) => {
        resume(exchange.diag);
        end(span);
        answer(exchange, value, pending);
        leave(exchange.diag);
      },
      (error: unknown) => {
        resume(exchange.diag);
        end(span);
        rethrown(error);
        leave(exchange.diag);
      },
    );
  } else {
    end(span);
    answer(exchange, settled, pending);
  }
}

function enterErrorPath(exchange: Exchange, error: unknown, thrown: boolean): void {
  const { res } = exchange;
  // Why: Headers are already on the wire, so no error body can follow; the socket is destroyed instead.
  if (res.headersSent) {
    exchange.state = 'written';
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
  const observers = start('err.hook.on_error');
  runObservers(
    exchange.diag,
    exchange.route.hooks.onError,
    (hook) => hook(context, error),
    (hookError) => hookFailures.push(`onError hook threw: ${describeThrown(hookError)}`),
    () => {
      end(observers);
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
