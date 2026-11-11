import type { IncomingMessage, ServerResponse } from 'node:http';
import { begin, contain, destroyed, end, event, leave, next, resume, routed, start } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { RouteInfo } from '../contract/types.ts';
import { type BodyOutcome, readRouteBody } from './body.ts';
import { stageBodyRefusal, stopRefusedPipeline } from './body-refusal.ts';
import { fail } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { RequestContextRecord, runStage, ValidatedContextRecord, watchCompletion } from './hooks.ts';
import { preRoute } from './pre-route.ts';
import { respond } from './respond.ts';
import type { EngineRuntime, RuntimeReply, RuntimeRequest } from './types.ts';
import { type ValidatedParts, validateRequest } from './validate.ts';

// A prototype getter keeps req.signal lazy; a getter in a per-request object literal costs a closure and the literal fast path.
class HandlerRequest implements RuntimeRequest {
  readonly route: RouteInfo;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly body: unknown;
  readonly #req: IncomingMessage;

  constructor(route: RouteInfo, parts: ValidatedParts, req: IncomingMessage) {
    this.route = route;
    this.params = parts.params;
    this.query = parts.query;
    this.headers = parts.headers;
    this.body = parts.body;
    this.#req = req;
  }

  get signal(): AbortSignal {
    return this.#req.signal;
  }
}

function runHandler(exchange: Exchange, parts: ValidatedParts): void {
  if (exchange.state !== 'running') {
    return;
  }
  const { route, req } = exchange;
  exchange.stage = next(exchange.stage, 'req.handler');
  const arg = start('req.handler.arg');
  const argument = new HandlerRequest(route.info, parts, req);
  end(arg);
  contain('handler', argument);
  let reply: RuntimeReply | Promise<RuntimeReply>;
  try {
    reply = route.handler(argument);
  } catch (error) {
    fail(exchange, error, true);
    return;
  }
  if (reply instanceof Promise) {
    reply.then(
      (value: RuntimeReply) => {
        resume(exchange.diag);
        respond(exchange, value);
        leave(exchange.diag);
      },
      (error: unknown) => {
        resume(exchange.diag);
        fail(exchange, error, true);
        leave(exchange.diag);
      },
    );
  } else {
    respond(exchange, reply);
  }
}

function validateStage(exchange: Exchange, body: unknown): void {
  const parts = validateRequest(exchange, body);
  if (parts instanceof HttpError) {
    fail(exchange, parts, false);
    return;
  }
  const hooks = exchange.route.hooks.preHandler;
  if (hooks.length === 0) {
    runHandler(exchange, parts);
    return;
  }
  exchange.stage = next(exchange.stage, 'req.hook.pre_handler');
  const context = new ValidatedContextRecord(exchange, parts.params, parts.query, parts.body);
  contain('validated', context);
  runStage(
    exchange,
    hooks,
    (hook) => hook(context),
    () => runHandler(exchange, parts),
    (error) => fail(exchange, error, true),
  );
}

function bodyRead(exchange: Exchange, outcome: BodyOutcome): void {
  if (exchange.state !== 'running') {
    return;
  }
  switch (outcome.kind) {
    case 'value':
      validateStage(exchange, outcome.value);
      return;
    case 'refused':
      exchange.closeConnection = outcome.close;
      if (outcome.close) {
        stageBodyRefusal(exchange.req);
      }
      fail(exchange, outcome.error, false);
      return;
    case 'aborted':
      exchange.state = 'written';
      end(exchange.stage);
      event('refuse.body_aborted');
      exchange.res.destroy();
      destroyed();
      return;
    case 'failed':
      fail(exchange, outcome.error, false);
      return;
  }
}

function readStage(exchange: Exchange): void {
  const { route, req } = exchange;
  if (exchange.state !== 'running') {
    return;
  }
  if (!route.readsBody) {
    validateStage(exchange, undefined);
    return;
  }
  exchange.stage = next(exchange.stage, 'req.body');
  const outcome = readRouteBody(req, route.bodyLimit, (value: BodyOutcome) => bodyRead(exchange, value));
  if (outcome !== null) {
    bodyRead(exchange, outcome);
  }
}

export function handleRequest(runtime: EngineRuntime, req: IncomingMessage, res: ServerResponse): void {
  if (stopRefusedPipeline(req)) {
    return;
  }
  const diag = begin(req, res);
  const exchange = preRoute(runtime, req, res, diag);
  if (exchange === null) {
    leave(diag);
    return;
  }
  routed(exchange.route.info);
  const { hooks } = exchange.route;
  if (hooks.onResponse.length > 0) {
    watchCompletion(exchange, hooks.onResponse);
  }
  if (hooks.onRequest.length === 0) {
    readStage(exchange);
    leave(diag);
    return;
  }
  exchange.stage = next(exchange.stage, 'req.hook.on_request');
  const context = new RequestContextRecord(exchange);
  contain('request', context);
  runStage(
    exchange,
    hooks.onRequest,
    (hook) => hook(context),
    () => readStage(exchange),
    (error) => fail(exchange, error, true),
  );
  leave(diag);
}
