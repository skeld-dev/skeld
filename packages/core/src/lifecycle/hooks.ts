import type {
  CompletedContext,
  ErrorContext,
  OnResponseHook,
  RawReply,
  RequestContext,
  ResponseContext,
  ValidatedContext,
} from '../server/types.ts';
import type { Exchange } from './exchange.ts';
import { describeThrown, writeStderrLine } from './stderr.ts';

const ALREADY_SENT = 'Response already sent';

function sendReply(exchange: Exchange, reply: RawReply): void {
  const { res, method } = exchange;
  if (exchange.state !== 'running') {
    const error = new Error(ALREADY_SENT);
    exchange.lateSendError = error;
    writeStderrLine(method, exchange.path, res.statusCode, exchange.route.info.name, ALREADY_SENT);
    throw error;
  }
  if (reply.headers !== undefined) {
    for (const [name, value] of Object.entries(reply.headers)) {
      res.setHeader(name, value);
    }
  }
  if (exchange.runtime.isClosing()) {
    res.setHeader('connection', 'close');
  }
  const { payload } = reply;
  if (payload !== undefined) {
    res.setHeader('content-length', Buffer.byteLength(payload));
  }
  res.writeHead(reply.status);
  if (payload === undefined || method === 'HEAD') {
    res.end();
  } else {
    res.end(payload);
  }
  exchange.state = 'sent-by-hook';
}

export function requestContext(exchange: Exchange): RequestContext {
  const { req, res } = exchange;
  return {
    route: exchange.route.info,
    method: exchange.method,
    path: exchange.path,
    headers: req.headers,
    get signal() {
      return req.signal;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    send(reply) {
      sendReply(exchange, reply);
    },
  };
}

export function validatedContext(exchange: Exchange, params: unknown, query: unknown, body: unknown): ValidatedContext {
  const { req, res } = exchange;
  return {
    route: exchange.route.info,
    method: exchange.method,
    path: exchange.path,
    headers: req.headers,
    get signal() {
      return req.signal;
    },
    params,
    query,
    body,
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    send(reply) {
      sendReply(exchange, reply);
    },
  };
}

export function responseContext(exchange: Exchange, status: number): ResponseContext {
  const { req, res } = exchange;
  return {
    route: exchange.route.info,
    method: exchange.method,
    path: exchange.path,
    headers: req.headers,
    get signal() {
      return req.signal;
    },
    status,
    setHeader(name, value) {
      res.setHeader(name, value);
    },
  };
}

export function errorContext(exchange: Exchange): ErrorContext {
  const { req } = exchange;
  return {
    route: exchange.route.info,
    method: exchange.method,
    path: exchange.path,
    headers: req.headers,
    get signal() {
      return req.signal;
    },
  };
}

export function runStage<H>(
  exchange: Exchange,
  hooks: readonly H[],
  call: (hook: H) => void | Promise<void>,
  next: () => void,
  fault: (error: unknown) => void,
): void {
  const step = (index: number): void => {
    if (exchange.state === 'sent-by-hook') {
      return;
    }
    const hook = hooks[index];
    if (hook === undefined) {
      next();
      return;
    }
    let result: void | Promise<void>;
    try {
      result = call(hook);
    } catch (error) {
      fault(error);
      return;
    }
    if (result instanceof Promise) {
      result.then(() => step(index + 1), fault);
    } else {
      step(index + 1);
    }
  };
  step(0);
}

export function runObservers<H>(
  hooks: readonly H[],
  call: (hook: H) => void | Promise<void>,
  report: (error: unknown) => void,
  done: (() => void) | null,
): void {
  const step = (index: number): void => {
    const hook = hooks[index];
    if (hook === undefined) {
      if (done !== null) {
        done();
      }
      return;
    }
    let result: void | Promise<void>;
    try {
      result = call(hook);
    } catch (error) {
      report(error);
      step(index + 1);
      return;
    }
    if (result instanceof Promise) {
      result.then(
        () => step(index + 1),
        (error: unknown) => {
          report(error);
          step(index + 1);
        },
      );
    } else {
      step(index + 1);
    }
  };
  step(0);
}

export function watchCompletion(exchange: Exchange, hooks: readonly OnResponseHook[]): void {
  const { res } = exchange;
  let finished = false;
  res.once('finish', () => {
    finished = true;
  });
  res.once('close', () => {
    if (exchange.state === 'sent-by-hook') {
      return;
    }
    const context: CompletedContext = {
      route: exchange.route.info,
      method: exchange.method,
      path: exchange.path,
      status: res.statusCode,
      completed: finished,
    };
    runObservers(
      hooks,
      (hook) => hook(context),
      (error) =>
        writeStderrLine(
          exchange.method,
          exchange.path,
          res.statusCode,
          exchange.route.info.name,
          `onResponse hook threw: ${describeThrown(error)}`,
        ),
      null,
    );
  });
}
