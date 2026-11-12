// Does:  Runs hook chains for a stage and builds the context records each kind of hook receives.
// Holds: After a hook's reply or a timeout no later hook or stage runs; only onResponse observers still see the end.

import { authorResult } from './author-result.ts';
import type { OutgoingHttpHeaders } from 'node:http';
import { contain, end, event, leave, resume, type Slot, track, wrote } from '#diag';
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
import { setAuthorHeader, setAuthorHeaders } from './author-header.ts';
import { clientAddressOf } from './client-address.ts';
import { settle, signalOf } from './deadline.ts';
import type { Exchange } from './exchange.ts';
import { describeThrown, writeStderrLine } from './stderr.ts';
import { addSecurityHeaders } from './wire.ts';

const ALREADY_SENT = 'Response already sent';

// Does:  Writes a reply a hook sends in place of the handler's; a second send throws and is reported once.
function sendReply(exchange: Exchange, reply: RawReply): void {
  const { res, method } = exchange;
  // Why: The timeout already answered; a hook that wakes later is not at fault for replying.
  if (exchange.state === 'timed-out') {
    return;
  }
  if (exchange.state !== 'running') {
    event('err.already_sent');
    const error = new Error(ALREADY_SENT);
    exchange.lateSendError = error;
    writeStderrLine(method, exchange.route.info.path, res.statusCode, exchange.route.info.name, ALREADY_SENT);
    throw error;
  }
  if (reply.headers !== undefined) {
    setAuthorHeaders(res, reply.headers);
  }
  end(exchange.stage);
  if (exchange.closeConnection || exchange.runtime.isClosing()) {
    res.setHeader('connection', 'close');
  }
  const { payload } = reply;
  if (payload !== undefined) {
    res.setHeader('content-length', Buffer.byteLength(payload));
  }
  const head: OutgoingHttpHeaders = {};
  if (exchange.runtime.securityHeaders) {
    addSecurityHeaders(res, head);
  }
  res.writeHead(reply.status, head);
  if (payload === undefined || method === 'HEAD') {
    res.end();
    wrote(reply.status, null, null);
  } else {
    res.end(payload);
    wrote(reply.status, null, payload);
  }
  settle(exchange, 'sent-by-hook');
}

export class ErrorContextRecord implements ErrorContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly #exchange: Exchange;

  constructor(exchange: Exchange) {
    this.route = exchange.route.info;
    this.method = exchange.method;
    this.path = exchange.path;
    this.headers = exchange.req.headers;
    this.#exchange = exchange;
  }

  get signal(): AbortSignal {
    return signalOf(this.#exchange);
  }

  get clientAddress(): string {
    return clientAddressOf(this.#exchange);
  }
}

export class RequestContextRecord extends ErrorContextRecord implements RequestContext {
  readonly setHeader: RequestContext['setHeader'];
  readonly send: RequestContext['send'];

  constructor(exchange: Exchange) {
    super(exchange);
    const { res } = exchange;
    this.setHeader = (name, value) => {
      setAuthorHeader(res, name, value);
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
      setAuthorHeader(res, name, value);
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
    if (exchange.state !== 'running') {
      return;
    }
    const hook = hooks[index];
    if (hook === undefined) {
      next();
      return;
    }
    authorResult<void>(
      () => call(hook),
      (_value, asynchronous) => {
        if (asynchronous) {
          resume(exchange.diag);
        }
        try {
          step(index + 1);
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
          fault(error);
        } finally {
          if (asynchronous) {
            leave(exchange.diag);
          }
        }
      },
      () => exchange.runtime.deadlines.wait(exchange),
    );
  };
  step(0);
}

// Does:  Calls every hook in order even when one throws, until stopped; each failure is reported and the rest run.
export function runObservers<H>(
  slot: Slot,
  hooks: readonly H[],
  call: (hook: H) => void | Promise<void>,
  report: (error: unknown) => void,
  waiting: () => void,
  stopped: () => boolean,
  done: () => void,
): void {
  const step = (index: number): void => {
    const hook = hooks[index];
    if (hook === undefined || stopped()) {
      done();
      return;
    }
    const advance = (asynchronous: boolean): void => {
      if (asynchronous) {
        resume(slot);
      }
      try {
        step(index + 1);
      } finally {
        if (asynchronous) {
          leave(slot);
        }
      }
    };
    authorResult<void>(
      () => call(hook),
      (_value, asynchronous) => advance(asynchronous),
      (error, asynchronous) => {
        report(error);
        advance(asynchronous);
      },
      waiting,
    );
  };
  step(0);
}

class CompletedContextRecord implements CompletedContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly completed: boolean;
  readonly #exchange: Exchange;

  constructor(exchange: Exchange, completed: boolean) {
    this.route = exchange.route.info;
    this.method = exchange.method;
    this.path = exchange.path;
    this.status = exchange.res.statusCode;
    this.completed = completed;
    this.#exchange = exchange;
  }

  get clientAddress(): string {
    return clientAddressOf(this.#exchange);
  }
}

const ignoreWait = (): void => undefined;
const neverStopped = (): boolean => false;

// Does:  Runs the onResponse hooks when the response closes, telling them whether it finished.
export function watchCompletion(exchange: Exchange, hooks: readonly OnResponseHook[]): void {
  const { res } = exchange;
  // Why: The hooks run after the socket may have closed, when its address can no longer be read unless cached now.
  void exchange.req.socket.remoteAddress;
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
    const context = new CompletedContextRecord(exchange, finished);
    contain('completed', context);
    const span = track('req.hook.on_response');
    runObservers(
      exchange.diag,
      hooks,
      (hook) => hook(context),
      (error) =>
        writeStderrLine(
          exchange.method,
          exchange.route.info.path,
          res.statusCode,
          exchange.route.info.name,
          `onResponse hook threw: ${describeThrown(error)}`,
        ),
      ignoreWait,
      neverStopped,
      () => {
        end(span);
      },
    );
    leave(exchange.diag);
  });
}
