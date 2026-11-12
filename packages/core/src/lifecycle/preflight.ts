// Does:  Answers a CORS preflight for a route under a policy: 204 with the route's fixed grant, or 403 CROSS_ORIGIN.
// Holds: No hook or handler runs, and the answer never repeats a header name the request asked for.

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { count, event, wrote } from '#diag';
import { grantOf } from '../cors/grant.ts';
import { finishHead } from './head.ts';
import type { EngineRuntime } from './types.ts';
import { CROSS_ORIGIN_BODY, writeErrorBody } from './wire.ts';

const NO_CONTENT = 204;

// Does:  Answers an OPTIONS request that is a preflight for a route with a policy; false leaves it to routing.
export function answerPreflight(
  runtime: EngineRuntime,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  const { headers } = req;
  const requested = headers['access-control-request-method'];
  // Why: A CORS-preflight request is OPTIONS with Origin and Access-Control-Request-Method (Fetch Standard).
  if (headers.origin === undefined || typeof requested !== 'string') {
    return false;
  }
  const found = runtime.router.find(requested === 'HEAD' ? 'GET' : requested, path, runtime.maxParamLength);
  if (found.kind !== 'found' || found.value.cors === null) {
    return false;
  }
  const { info, cors } = found.value;
  const grant = grantOf(cors, headers.origin);
  if (grant.allowOrigin === null) {
    event('refuse.preflight', info.name);
    writeErrorBody(runtime, res, 'OPTIONS', CROSS_ORIGIN_BODY, false, null, grant);
    return true;
  }
  count('cors.preflight', info.name);
  const head: OutgoingHttpHeaders = {
    'access-control-allow-methods': requested,
    'access-control-max-age': cors.maxAge,
  };
  if (cors.allowHeaders !== null) {
    head['access-control-allow-headers'] = cors.allowHeaders;
  }
  if (runtime.isClosing()) {
    head.connection = 'close';
  }
  finishHead(res, NO_CONTENT, head, runtime.securityHeaders, null, null, grant);
  res.writeHead(NO_CONTENT, head);
  res.end();
  wrote(NO_CONTENT, head, null);
  return true;
}
