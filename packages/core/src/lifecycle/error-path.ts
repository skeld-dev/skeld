import { HttpError } from '../contract/http-error.ts';
import type { ErrorBody } from '../contract/types.ts';
import type { ErrorContext } from '../server/types.ts';
import type { Exchange } from './exchange.ts';
import { errorContext, runObservers } from './hooks.ts';
import { describeThrown, writeStderrLine } from './stderr.ts';
import { writeErrorBody } from './wire.ts';

const INTERNAL_BODY: ErrorBody = { status: 500, code: 'INTERNAL', message: 'Internal Server Error' };

function toErrorBody(value: unknown): ErrorBody {
  if (!(value instanceof HttpError) || value.status === null) {
    return INTERNAL_BODY;
  }
  const { status, code, message, details } = value;
  return details === null ? { status, code, message } : { status, code, message, details };
}

function report(exchange: Exchange, status: number, message: string): void {
  writeStderrLine(exchange.method, exchange.path, status, exchange.route.info.name, message);
}

interface Pending {
  readonly thrown: unknown[];
  readonly hookFailures: readonly string[];
}

function answer(exchange: Exchange, outcome: unknown, pending: Pending): void {
  if (exchange.state !== 'running') {
    for (const message of pending.hookFailures) {
      report(exchange, exchange.res.statusCode, message);
    }
    return;
  }
  const body = toErrorBody(outcome);
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
  writeErrorBody(exchange.runtime, exchange.res, exchange.method, body, exchange.closeConnection);
}

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
  let result: HttpError | Promise<HttpError>;
  try {
    result = handler(current, context);
  } catch (error) {
    rethrown(error);
    return;
  }
  if (result instanceof Promise) {
    result.then((value: HttpError) => answer(exchange, value, pending), rethrown);
  } else {
    answer(exchange, result, pending);
  }
}

function enterErrorPath(exchange: Exchange, error: unknown, thrown: boolean): void {
  const { res } = exchange;
  if (res.headersSent) {
    exchange.state = 'written';
    res.destroy();
    if (thrown && !exchange.route.hasOnError) {
      report(exchange, res.statusCode, describeThrown(error));
    }
    return;
  }
  const context = errorContext(exchange);
  const hookFailures: string[] = [];
  runObservers(
    exchange.route.hooks.onError,
    (hook) => hook(context, error),
    (hookError) => hookFailures.push(`onError hook threw: ${describeThrown(hookError)}`),
    () => classify(exchange, context, 0, error, { thrown: thrown ? [error] : [], hookFailures }),
  );
}

export function fail(exchange: Exchange, error: unknown, thrown: boolean): void {
  if (exchange.state === 'running') {
    enterErrorPath(exchange, error, thrown);
    return;
  }
  if (error !== exchange.lateSendError && thrown && !exchange.route.hasOnError) {
    report(exchange, exchange.res.statusCode, describeThrown(error));
  }
}
