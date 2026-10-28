import type { IncomingMessage } from 'node:http';
import type { RouteInfo } from '../contract/types.ts';
import type {
  CompletedContext,
  ErrorContext,
  OnResponseHook,
  RawHeaders,
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

export class ErrorContextRecord implements ErrorContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly #req: IncomingMessage;

  constructor(exchange: Exchange) {
    this.route = exchange.route.info;
    this.method = exchange.method;
    this.path = exchange.path;
    this.headers = exchange.req.headers;
    this.#req = exchange.req;
  }

  get signal(): AbortSignal {
    return this.#req.signal;
  }
}

export class RequestContextRecord extends ErrorContextRecord implements RequestContext {
  readonly setHeader: RequestContext['setHeader'];
  readonly send: RequestContext['send'];

  constructor(exchange: Exchange) {
    super(exchange);
    const { res } = exchange;
    this.setHeader = (name, value) => {
      res.setHeader(name, value);
    };
    this.send = (reply) => {
      sendReply(exchange, reply);
    };
  }
}

export class ValidatedContextRecord extends RequestContextRecord implements ValidatedContext {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;

  constructor(exchange: Exchange, params: unknown, query: unknown, body: unknown) {
    super(exchange);
    this.params = params;
    this.query = query;
    this.body = body;
  }
}

export class ResponseContextRecord extends ErrorContextRecord implements ResponseContext {
  readonly status: number;
  readonly setHeader: ResponseContext['setHeader'];

  constructor(exchange: Exchange, status: number) {
    super(exchange);
    const { res } = exchange;
    this.status = status;
    this.setHeader = (name, value) => {
      res.setHeader(name, value);
    };
  }
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
