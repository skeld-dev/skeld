// Does:  Runs a route's gate steps for one request, identify before onRequest and authorize after validation.
// Holds: Only an outcome of kind admit advances a request; a throw, a malformed or late outcome runs no handler.

import { authorResult } from './author-result.ts';
import { end, event, leave, next, resume } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import type { GateInput, GateRefusal, GateRequest } from '../gate/types.ts';
import type { RefusalEvent } from '../log/events.ts';
import { hasUnreadBody } from './body.ts';
import { stageBodyRefusal } from './body-refusal.ts';
import { clientAddressOf } from './client-address.ts';
import { rawCookiesOf } from './cookies.ts';
import { settle, signalOf } from './deadline.ts';
import type { Exchange, Failure } from './exchange.ts';
import { holdGrant, releaseLateGrant } from './grant.ts';
import { loggerOf, pointErrorWritten, pointFailed, pointHookFailed, pointRefused } from './points.ts';
import type { RouteGateRuntime } from './types.ts';
import type { ValidatedParts } from './validate.ts';
import { INTERNAL_BODY, writeErrorBody, writeRefusal } from './wire.ts';

type Reason = GateRefusal['reason'];

interface Refusal {
  readonly event: RefusalEvent;
  readonly status: number;
  readonly code: string;
  readonly text: string;
}

function refusal(reason: Reason, body: ErrorBody): Refusal {
  return Object.freeze({
    event: `skeld.refuse.${reason}`,
    status: body.status,
    code: body.code,
    text: JSON.stringify(body),
  });
}

// Why: Status, code and message belong to core, so two refusals of one reason are byte-identical whatever the gate.
const REFUSALS: { readonly [R in Reason]: Refusal } = Object.freeze({
  credential_missing: refusal('credential_missing', {
    status: 401,
    code: 'CREDENTIAL_MISSING',
    message: 'Credential required',
  }),
  credential_invalid: refusal('credential_invalid', {
    status: 401,
    code: 'CREDENTIAL_INVALID',
    message: 'Credential not accepted',
  }),
  credential_conflict: refusal('credential_conflict', {
    status: 400,
    code: 'CREDENTIAL_CONFLICT',
    message: 'More than one credential',
  }),
  csrf_token: refusal('csrf_token', {
    status: 403,
    code: 'CSRF_TOKEN_INVALID',
    message: 'CSRF token missing or not accepted',
  }),
  rate_limited: refusal('rate_limited', { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' }),
  access_denied: refusal('access_denied', { status: 403, code: 'ACCESS_DENIED', message: 'Access denied' }),
  access_hidden: refusal('access_hidden', { status: 404, code: 'NOT_FOUND', message: 'Not found' }),
  resource_missing: refusal('resource_missing', { status: 404, code: 'NOT_FOUND', message: 'Not found' }),
  unavailable: refusal('unavailable', { status: 503, code: 'AUTH_UNAVAILABLE', message: 'Service unavailable' }),
});

const BEARER: readonly [string, string] = Object.freeze(['www-authenticate', 'Bearer']);
// Why: The contract bounds a retry-after to one day; a gate that answers outside it is faulty, never a refusal.
const MAX_RETRY_AFTER_SECONDS = 86_400;

type Verdict =
  | { readonly kind: 'admit'; readonly value: unknown }
  | { readonly kind: 'refuse'; readonly reason: Reason; readonly header: readonly [string, string] | null }
  | { readonly kind: 'fault' };

const FAULT: Verdict = Object.freeze({ kind: 'fault' });

function isReason(value: unknown): value is Reason {
  return typeof value === 'string' && Object.hasOwn(REFUSALS, value);
}

// Does:  Reads a gate step's outcome once into a verdict; any shape outside the closed union is a fault.
function readOutcome(outcome: unknown, member: 'principal' | 'grant'): Verdict {
  if (typeof outcome !== 'object' || outcome === null) {
    return FAULT;
  }
  const kind: unknown = Reflect.get(outcome, 'kind');
  if (kind === 'admit') {
    const value: unknown = Reflect.get(outcome, member);
    // Why: An admit names its principal or grant; a missing or undefined member is outside the union and never admits.
    return value === undefined ? FAULT : { kind: 'admit', value };
  }
  const reason: unknown = kind === 'refuse' ? Reflect.get(outcome, 'reason') : undefined;
  if (!isReason(reason)) {
    return FAULT;
  }
  if (reason === 'credential_missing' || reason === 'credential_invalid') {
    const challenge: unknown = Reflect.get(outcome, 'challenge');
    if (challenge !== 'bearer' && challenge !== null) {
      return FAULT;
    }
    return { kind: 'refuse', reason, header: challenge === 'bearer' ? BEARER : null };
  }
  if (reason === 'rate_limited') {
    const seconds: unknown = Reflect.get(outcome, 'retryAfterSeconds');
    if (!Number.isInteger(seconds) || Number(seconds) < 1 || Number(seconds) > MAX_RETRY_AFTER_SECONDS) {
      return FAULT;
    }
    return { kind: 'refuse', reason, header: ['retry-after', String(seconds)] };
  }
  return { kind: 'refuse', reason, header: null };
}

// Does:  Tells whether an outcome arriving now may still advance the request: it runs and its client is connected.
function live(exchange: Exchange): boolean {
  return exchange.state === 'running' && !exchange.req.socket.destroyed;
}

// Does:  Returns the one gate request of an exchange, built on first use from values that hold no transport object.
function gateRequestOf(exchange: Exchange): GateRequest {
  exchange.gateRequest ??= Object.freeze({
    route: exchange.route.info,
    method: exchange.method,
    headers: exchange.req.headers,
    rawCookies: rawCookiesOf(exchange),
    clientAddress: clientAddressOf(exchange),
    signal: signalOf(exchange),
    log: loggerOf(exchange),
    requestId: exchange.log.id,
  });
  return exchange.gateRequest;
}

// Why: Body bytes still unread would be parsed as the next request, so the connection closes after the response.
function closeIfUnread(exchange: Exchange): void {
  const { req, route } = exchange;
  if (route.readsBody && hasUnreadBody(req)) {
    exchange.closeConnection = true;
    stageBodyRefusal(req);
  }
}

// Does:  Answers a gate refusal from core's table: no hook, error handler or cookie; the CORS grant and record stay.
function refuse(exchange: Exchange, reason: Reason, header: readonly [string, string] | null): void {
  const { runtime, res } = exchange;
  const { event: name, status, code, text } = REFUSALS[reason];
  event('refuse.gate', reason);
  pointRefused(runtime.log, exchange.log, name, status, code, null);
  settle(exchange, 'written');
  end(exchange.stage);
  closeIfUnread(exchange);
  writeRefusal(
    runtime,
    res,
    exchange.log.id,
    exchange.method,
    status,
    text,
    exchange.closeConnection,
    exchange.cors,
    header,
  );
}

// Does:  Answers a failed gate step with the fixed 500; its record names the reason gate and reads nothing thrown.
function fault(exchange: Exchange): void {
  if (!live(exchange)) {
    return;
  }
  event('err.gate');
  const failure: Failure = { reason: 'gate', value: null, detail: null };
  pointFailed(exchange, failure);
  settle(exchange, 'written');
  end(exchange.stage);
  closeIfUnread(exchange);
  const { runtime, res } = exchange;
  writeErrorBody(
    runtime,
    res,
    exchange.log.id,
    exchange.method,
    INTERNAL_BODY,
    exchange.closeConnection,
    null,
    exchange.cors,
  );
  pointErrorWritten(exchange, failure, INTERNAL_BODY.status, INTERNAL_BODY.code);
}

// Does:  Runs one gate step under the request's deadline and hands its outcome, or its fault, to the caller.
function runStep(exchange: Exchange, call: () => unknown, outcome: (value: unknown) => void): void {
  authorResult<unknown>(
    call,
    (value, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        outcome(value);
      } finally {
        if (asynchronous) {
          leave(exchange.diag);
        }
      }
    },
    (_error, asynchronous) => {
      if (asynchronous) {
        resume(exchange.diag);
      }
      try {
        fault(exchange);
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

// Does:  Finds the request's principal before any onRequest hook; proceed runs only when identify admits.
export function identifyStage(exchange: Exchange, gate: RouteGateRuntime, proceed: () => void): void {
  exchange.stage = next(exchange.stage, 'req.gate.identify');
  const request = gateRequestOf(exchange);
  runStep(
    exchange,
    () => gate.identify(request),
    (outcome) => {
      if (!live(exchange)) {
        return;
      }
      const verdict = readOutcome(outcome, 'principal');
      // Why: A null principal admits only a request on an optional route; on a policy route it is a fault.
      if (verdict.kind === 'fault' || (verdict.kind === 'admit' && verdict.value === null && gate.authorize !== null)) {
        fault(exchange);
        return;
      }
      if (verdict.kind === 'refuse') {
        refuse(exchange, verdict.reason, verdict.header);
        return;
      }
      exchange.principal = verdict.value;
      proceed();
    },
  );
}

// Does:  Decides a policy route after validation and before any preHandler hook; proceed runs with the grant held.
export function authorizeStage(
  exchange: Exchange,
  authorize: NonNullable<RouteGateRuntime['authorize']>,
  parts: ValidatedParts,
  proceed: () => void,
): void {
  exchange.stage = next(exchange.stage, 'req.gate.authorize');
  const input: GateInput = Object.freeze({
    params: parts.params,
    query: parts.query,
    headers: parts.headers,
    cookies: parts.cookies,
    body: parts.body,
  });
  const request = gateRequestOf(exchange);
  runStep(
    exchange,
    () => authorize(exchange.principal, input, request),
    (outcome) => {
      const verdict = readOutcome(outcome, 'grant');
      if (!live(exchange)) {
        if (verdict.kind === 'admit') {
          releaseLateGrant(exchange, verdict.value);
        }
        return;
      }
      if (verdict.kind === 'fault') {
        fault(exchange);
        return;
      }
      if (verdict.kind === 'refuse') {
        refuse(exchange, verdict.reason, verdict.header);
        return;
      }
      holdGrant(exchange, verdict.value);
      proceed();
    },
  );
}
