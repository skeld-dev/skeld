// Does:  Checks request framing, splits the target, answers a CORS preflight and finds the route, before any hook runs.
// Holds: A framing fault is answered 400 and the connection is closed.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { count, destroyed, end, event, next, type Slot, start } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import { grantOf } from '../cors/grant.ts';
import type { RefusalEvent } from '../log/events.ts';
import type { RequestLog } from '../log/shapes.ts';
import { checkFraming } from '../request/framing.ts';
import { splitTarget } from '../request/target.ts';
import type { Exchange } from './exchange.ts';
import { pointRefused } from './points.ts';
import { answerPreflight } from './preflight.ts';
import type { EngineRuntime } from './types.ts';
import { writeErrorBody } from './wire.ts';

const FRAMING_MESSAGES = {
  'duplicate-host': 'Request has more than one Host header',
  'transfer-encoding': 'Transfer-Encoding must be chunked',
} as const;

// Does:  Fires the refusal's point, then writes its error body; the reason is the framing fault, else null.
function refuse(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  request: RequestLog,
  refusal: RefusalEvent,
  body: ErrorBody,
  reason: string | null,
  close: boolean,
): null {
  pointRefused(runtime.log, request, refusal, body.status, body.code, reason);
  writeErrorBody(runtime, res, request.id, method, body, close, null, null);
  return null;
}

// Does:  Returns the exchange for a routed request, or null once the refusal has been written.
export function preRoute(
  runtime: EngineRuntime,
  req: IncomingMessage,
  res: ServerResponse,
  diag: Slot,
  request: RequestLog,
): Exchange | null {
  let stage = start('req.preroute');
  const { method, url } = req;
  // Why: node:http types method and url as optional; without them there is nothing to route, so the socket goes.
  if (method === undefined || url === undefined) {
    end(stage);
    res.destroy();
    destroyed();
    return null;
  }
  const framing = start('req.preroute.framing');
  const fault = checkFraming(req.rawHeaders);
  end(framing);
  if (fault !== null) {
    event('refuse.framing', fault);
    end(stage);
    const body: ErrorBody = { status: 400, code: 'BAD_REQUEST', message: FRAMING_MESSAGES[fault] };
    return refuse(runtime, res, method, request, 'skeld.refuse.framing', body, fault, true);
  }
  const target = start('req.preroute.target');
  const { path, query } = splitTarget(url);
  end(target);
  if (runtime.preflight && method === 'OPTIONS' && answerPreflight(runtime, req, res, path, request)) {
    end(stage);
    return null;
  }
  stage = next(stage, 'req.route.find');
  // Why: HEAD is served by the GET route; the body is dropped where the response is written.
  const found = runtime.router.find(method === 'HEAD' ? 'GET' : method, path, runtime.maxParamLength);
  switch (found.kind) {
    case 'found':
      return {
        runtime,
        route: found.value,
        req,
        res,
        method,
        path,
        query,
        params: found.params,
        diag,
        cors: found.value.cors === null ? null : grantOf(found.value.cors, req.headers.origin),
        log: request,
        logger: null,
        stage,
        child: 0,
        state: 'running',
        closeConnection: false,
        lateSendError: null,
        failure: null,
        waiting: null,
        waitingBefore: null,
        waitingAfter: null,
        cancelRead: null,
        deadline: 0,
        abort: null,
        signal: null,
        clientAddress: request.address,
        cookieEntries: null,
        rawCookies: null,
        pendingCookies: null,
      };
    case 'not-found': {
      count('refuse.not_found', method);
      end(stage);
      const body: ErrorBody = { status: 404, code: 'NOT_FOUND', message: `Route ${method} ${path} not found` };
      return refuse(runtime, res, method, request, 'skeld.refuse.not_found', body, null, false);
    }
    case 'malformed-path': {
      event('refuse.path');
      end(stage);
      const body: ErrorBody = {
        status: 400,
        code: 'BAD_REQUEST',
        message: 'Malformed percent-encoding in request path',
      };
      return refuse(runtime, res, method, request, 'skeld.refuse.path', body, null, false);
    }
    case 'param-too-long': {
      event('refuse.param_too_long');
      end(stage);
      const body: ErrorBody = {
        status: 414,
        code: 'URI_TOO_LONG',
        message: `Path parameter exceeds ${runtime.maxParamLength} bytes`,
      };
      return refuse(runtime, res, method, request, 'skeld.refuse.param_too_long', body, null, false);
    }
  }
}
