// Does:  Runs one request through its stages in order: pre-route, onRequest, body, validation, preHandler, handler.
// Holds: A body declared over its route's limit condemns the connection before any onRequest hook runs.

import { authorResult } from './author-result.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { begin, contain, destroyed, end, event, leave, next, resume, routed, start } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { RouteInfo } from '../contract/types.ts';
import type { RawCookies } from '../server/types.ts';
import { type BodyOutcome, declaresOverLimit, readRouteBody } from './body.ts';
import { stageBodyRefusal, stopRefusedPipeline } from './body-refusal.ts';
import { clientAddressOf } from './client-address.ts';
import { rawCookiesOf } from './cookies.ts';
import { settle, signalOf } from './deadline.ts';
import { fail } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { RequestContextRecord, runStage, ValidatedContextRecord, watchCompletion } from './hooks.ts';
import { preRoute } from './pre-route.ts';
import { respond } from './respond.ts';
import type { EngineRuntime, RuntimeReply, RuntimeRequest } from './types.ts';
import { type ValidatedParts, validateRequest } from './validate.ts';

// Why: Prototype getters keep the signal, address and cookies lazy; a getter in a per-request literal costs a closure.
class HandlerRequest implements RuntimeRequest {
  readonly route: RouteInfo;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly cookies: unknown;
  readonly body: unknown;
  readonly #exchange: Exchange;

  constructor(exchange: Exchange, parts: ValidatedParts) {
    this.route = exchange.route.info;
    this.params = parts.params;
    this.query = parts.query;
    this.headers = parts.headers;
    this.cookies = parts.cookies;
    this.body = parts.body;
    this.#exchange = exchange;
  }

  get signal(): AbortSignal {
    return signalOf(this.#exchange);
  }

  get clientAddress(): string {
    return clientAddressOf(this.#exchange);
  }

  get rawCookies(): RawCookies {
    return rawCookiesOf(this.#exchange);
  }
}

function runHandler(exchange: Exchange, parts: ValidatedParts): void {
  if (exchange.state !== 'running') {
    return;
  }
  const { route } = exchange;
  exchange.stage = next(exchange.stage, 'req.handler');
  const arg = start('req.handler.arg');
  const argument = new HandlerRequest(exchange, parts);
  end(arg);
  contain('handler', argument);
  authorResult<RuntimeReply>(
    () => route.handler(argument),
    (value, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        respond(exchange, value);
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
        fail(exchange, error, true);
      } finally {
        if (asynchronous) {
          leave(exchange.diag);
        }
      }
    },
    () => exchange.runtime.deadlines.wait(exchange),
  );
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
  exchange.cancelRead = null;
  if (exchange.state !== 'running') {
    return;
  }
  switch (outcome.kind) {
    case 'value':
      validateStage(exchange, outcome.value);
      return;
    case 'refused':
      // Why: An oversized body is still arriving; its refusal needs the staged close for the response to be read.
      if (outcome.close && !exchange.closeConnection) {
        exchange.closeConnection = true;
        stageBodyRefusal(exchange.req);
      }
      fail(exchange, outcome.error, false);
      return;
    case 'aborted':
      // Why: The client went away mid-body, so there is no one left to answer.
      settle(exchange, 'written');
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
  if (typeof outcome === 'function') {
    exchange.cancelRead = outcome;
    exchange.runtime.deadlines.wait(exchange);
  } else {
    bodyRead(exchange, outcome);
  }
}

// Does:  Handles one request event from node:http, from the refused-socket check to the first stage.
export function handleRequest(runtime: EngineRuntime, req: IncomingMessage, res: ServerResponse): void {
  // Why: A request pipelined behind a refused one must never reach application code.
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
  const { route } = exchange;
  // Why: An asynchronous onRequest hook yields to Node, which would dispatch the next pipelined request meanwhile.
  if (route.readsBody && declaresOverLimit(req, route.bodyLimit)) {
    exchange.closeConnection = true;
    stageBodyRefusal(req);
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
