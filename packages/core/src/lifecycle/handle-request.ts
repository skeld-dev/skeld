// Does:  Runs one request through its stages: pre-route, cross-site check, gate, onRequest, body, validation, handler.
// Holds: A body declared over its route's limit condemns the connection before any gate step or onRequest hook runs.

import { authorResult } from './author-result.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { begin, contain, destroyed, end, event, leave, next, resume, routed, start } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { RouteInfo } from '../contract/types.ts';
import { checkCrossOrigin } from '../csrf/check.ts';
import { makeClassified } from '../log/classified.ts';
import type { PartSchemas } from '../log/shapes.ts';
import type { Classified, Logger, RequestPart } from '../log/types.ts';
import type { RawCookies } from '../server/types.ts';
import { type BodyOutcome, declaresOverLimit, readRouteBody } from './body.ts';
import { stageBodyRefusal, stopRefusedPipeline } from './body-refusal.ts';
import { clientAddressOf } from './client-address.ts';
import { rawCookiesOf } from './cookies.ts';
import { settle, signalOf } from './deadline.ts';
import { fail, refuse, refuseCrossSite } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { authorizeStage, identifyStage } from './gate.ts';
import { releaseGrant } from './grant.ts';
import { RequestContextRecord, runStage, ValidatedContextRecord, watchCompletion } from './hooks.ts';
import { loggerOf, pointHookFailed, pointRouted, pointStart } from './points.ts';
import { preRoute } from './pre-route.ts';
import { respond } from './respond.ts';
import type { EngineRuntime, RuntimeReply, RuntimeRequest } from './types.ts';
import { type ValidatedParts, validateRequest } from './validate.ts';

// Does:  Pairs a validated request part, or one declared key of it, with the route's schema; anything else has none.
function classifyPart(schema: PartSchemas[RequestPart], value: unknown, key: string | undefined): Classified {
  if (key === undefined) {
    return makeClassified(schema === null ? null : schema.whole, value);
  }
  const member = schema?.keys?.get(key);
  if (member === undefined || typeof value !== 'object' || value === null) {
    return makeClassified(null, undefined);
  }
  return makeClassified(member, Object.getOwnPropertyDescriptor(value, key)?.value);
}

// Why: Prototype getters keep the signal, address, cookies and logger lazy; a getter in a literal costs a closure.
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

  get log(): Logger {
    return loggerOf(this.#exchange);
  }

  get requestId(): string {
    return this.#exchange.log.id;
  }

  get classified(): (part: RequestPart, key?: string) => Classified {
    const schemas = this.#exchange.route.partSchemas;
    // Why: An untyped caller can name any part; one outside the five pairs with no schema and no value, never a throw.
    return (part, key) =>
      typeof part === 'string' && Object.hasOwn(schemas, part)
        ? classifyPart(schemas[part], this[part], key)
        : makeClassified(null, undefined);
  }
}

// Why: On a server with a gate every handler request has both members, undefined on a public route, never absent.
class GatedHandlerRequest extends HandlerRequest {
  readonly principal: unknown;
  readonly grant: unknown;

  constructor(exchange: Exchange, parts: ValidatedParts) {
    super(exchange, parts);
    this.principal = exchange.principal;
    this.grant = exchange.grant;
  }
}

function runHandler(exchange: Exchange, parts: ValidatedParts): void {
  if (exchange.state !== 'running') {
    return;
  }
  const { route } = exchange;
  exchange.stage = next(exchange.stage, 'req.handler');
  const arg = start('req.handler.arg');
  const argument = route.gated ? new GatedHandlerRequest(exchange, parts) : new HandlerRequest(exchange, parts);
  end(arg);
  contain('handler', argument);
  authorResult<RuntimeReply>(
    () => route.handler(argument),
    (value, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        releaseGrant(exchange);
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
        fail(exchange, error);
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

function validateStage(exchange: Exchange, body: unknown): void {
  const parts = validateRequest(exchange, body);
  if (parts instanceof HttpError) {
    refuse(exchange, 'skeld.refuse.validation', parts);
    return;
  }
  const authorize = exchange.route.gate?.authorize ?? null;
  if (authorize === null) {
    preHandlerStage(exchange, parts);
    return;
  }
  authorizeStage(exchange, authorize, parts, () => preHandlerStage(exchange, parts));
}

function preHandlerStage(exchange: Exchange, parts: ValidatedParts): void {
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
    (error) => fail(exchange, error),
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
      refuse(exchange, outcome.refusal, outcome.error);
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
      fail(exchange, outcome.error);
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
  // Why: The request clock opens before pointStart so the id, log record and close listener are inside req.total.
  const diag = begin(req, res);
  const setup = start('req.start');
  const request = pointStart(runtime, req, res);
  end(setup);
  const exchange = preRoute(runtime, req, res, diag, request);
  if (exchange === null) {
    leave(diag);
    return;
  }
  routed(exchange.route.info);
  pointRouted(request, exchange.route);
  const { csrf, hooks } = exchange.route;
  // Why: A refused request must reach no application code, so the check runs before onResponse observers attach.
  if (csrf !== null) {
    const { headers } = req;
    const refused = checkCrossOrigin(headers.origin, headers['sec-fetch-site'], csrf);
    if (refused !== null) {
      refuseCrossSite(exchange, refused);
      leave(diag);
      return;
    }
  }
  if (hooks.onResponse.length > 0) {
    watchCompletion(exchange, hooks.onResponse);
  }
  const { route } = exchange;
  const { gate } = route;
  // Why: An asynchronous gate step or onRequest hook yields to Node, which would dispatch the next pipelined request.
  if ((gate !== null || hooks.onRequest.length > 0) && route.readsBody && declaresOverLimit(req, route.bodyLimit)) {
    exchange.closeConnection = true;
    stageBodyRefusal(req);
  }
  if (gate === null) {
    requestStage(exchange);
  } else {
    identifyStage(exchange, gate, () => requestStage(exchange));
  }
  leave(diag);
}

function requestStage(exchange: Exchange): void {
  const hooks = exchange.route.hooks.onRequest;
  if (hooks.length === 0) {
    readStage(exchange);
    return;
  }
  exchange.stage = next(exchange.stage, 'req.hook.on_request');
  const context = new RequestContextRecord(exchange);
  contain('request', context);
  runStage(
    exchange,
    hooks,
    (hook) => hook(context),
    () => readStage(exchange),
    (error) => fail(exchange, error),
  );
}
