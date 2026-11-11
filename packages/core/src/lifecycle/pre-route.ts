// Does:  Checks request framing, splits the target and finds the route, before any hook runs.
// Holds: A framing fault is answered 400 and the connection is closed.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { count, destroyed, end, event, next, type Slot, start } from '#diag';
import type { EngineErrorCode } from '../contract/types.ts';
import { checkFraming } from '../request/framing.ts';
import { splitTarget } from '../request/target.ts';
import type { Exchange } from './exchange.ts';
import type { EngineRuntime } from './types.ts';
import { writeErrorBody } from './wire.ts';

const FRAMING_MESSAGES = {
  'duplicate-host': 'Request has more than one Host header',
  'transfer-encoding': 'Transfer-Encoding must be chunked',
} as const;

function refuse(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  status: number,
  code: EngineErrorCode,
  message: string,
  close: boolean,
): null {
  writeErrorBody(runtime, res, method, { status, code, message }, close);
  return null;
}

// Does:  Returns the exchange for a routed request, or null once the refusal has been written.
export function preRoute(
  runtime: EngineRuntime,
  req: IncomingMessage,
  res: ServerResponse,
  diag: Slot,
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
    return refuse(runtime, res, method, 400, 'BAD_REQUEST', FRAMING_MESSAGES[fault], true);
  }
  const target = start('req.preroute.target');
  const { path, query } = splitTarget(url);
  end(target);
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
        stage,
        state: 'running',
        closeConnection: false,
        lateSendError: null,
      };
    case 'not-found':
      count('refuse.not_found', method);
      end(stage);
      return refuse(runtime, res, method, 404, 'NOT_FOUND', `Route ${method} ${path} not found`, false);
    case 'malformed-path':
      event('refuse.path');
      end(stage);
      return refuse(runtime, res, method, 400, 'BAD_REQUEST', 'Malformed percent-encoding in request path', false);
    case 'param-too-long':
      event('refuse.param_too_long');
      end(stage);
      return refuse(
        runtime,
        res,
        method,
        414,
        'URI_TOO_LONG',
        `Path parameter exceeds ${runtime.maxParamLength} bytes`,
        false,
      );
  }
}
