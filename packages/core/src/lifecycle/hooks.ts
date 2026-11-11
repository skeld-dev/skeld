// Does:  Runs hook chains for a stage and builds the context records each kind of hook receives.
// Holds: After a hook sends a reply, no later hook of the stage and no later stage runs.

import type { IncomingMessage } from 'node:http';
import { contain, end, event, header, leave, resume, type Slot, track, wrote } from '#diag';
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

// Does:  Writes a reply a hook sends in place of the handler's; a second send throws and is reported once.
function sendReply(exchange: Exchange, reply: RawReply): void {
  const { res, method } = exchange;
  if (exchange.state !== 'running') {
    event('err.already_sent');
    const error = new Error(ALREADY_SENT);
    exchange.lateSendError = error;
    writeStderrLine(method, exchange.path, res.statusCode, exchange.route.info.name, ALREADY_SENT);
    throw error;
  }
  end(exchange.stage);
  if (reply.headers !== undefined) {
    for (const [name, value] of Object.entries(reply.headers)) {
      header(name, value);
      res.setHeader(name, value);
    }
  }
  if (exchange.closeConnection || exchange.runtime.isClosing()) {
    res.setHeader('connection', 'close');
  }
  const { payload } = reply;
  if (payload !== undefined) {
    res.setHeader('content-length', Buffer.byteLength(payload));
  }
  res.writeHead(reply.status);
  if (payload === undefined || method === 'HEAD') {
    res.end();
    wrote(reply.status, null, null);
  } else {
    res.end(payload);
    wrote(reply.status, null, payload);
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
      header(name, value);
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
      header(name, value);
      res.setHeader(name, value);
    };
  }
}

// Does:  Calls the hooks in order, awaiting each; the first throw or rejection goes to fault and ends the stage.
// Holds: next runs only when every hook returned and none sent a reply.
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
      result.then(
        () => {
          resume(exchange.diag);
          step(index + 1);
          leave(exchange.diag);
        },
        (error: unknown) => {
          resume(exchange.diag);
          fault(error);
          leave(exchange.diag);
        },
      );
    } else {
      step(index + 1);
    }
  };
  step(0);
}

// Does:  Calls every hook in order even when one throws; each failure is reported and the rest still run.
export function runObservers<H>(
  slot: Slot,
  hooks: readonly H[],
  call: (hook: H) => void | Promise<void>,
  report: (error: unknown) => void,
  done: () => void,
): void {
  const step = (index: number): void => {
    const hook = hooks[index];
    if (hook === undefined) {
      done();
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
        () => {
          resume(slot);
          step(index + 1);
          leave(slot);
        },
        (error: unknown) => {
          resume(slot);
          report(error);
          step(index + 1);
          leave(slot);
        },
      );
    } else {
      step(index + 1);
    }
  };
  step(0);
}

// Does:  Runs the onResponse hooks when the response closes, telling them whether it finished.
export function watchCompletion(exchange: Exchange, hooks: readonly OnResponseHook[]): void {
  const { res } = exchange;
  let finished = false;
  res.once('finish', () => {
    resume(exchange.diag);
    finished = true;
    leave(exchange.diag);
  });
  res.once('close', () => {
    resume(exchange.diag);
    if (exchange.state === 'sent-by-hook') {
      leave(exchange.diag);
      return;
    }
    const context: CompletedContext = {
      route: exchange.route.info,
      method: exchange.method,
      path: exchange.path,
      status: res.statusCode,
      completed: finished,
    };
    contain('completed', context);
    const span = track('req.hook.on_response');
    runObservers(
      exchange.diag,
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
      () => {
        end(span);
      },
    );
    leave(exchange.diag);
  });
}
