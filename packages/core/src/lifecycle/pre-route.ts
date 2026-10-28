import type { IncomingMessage, ServerResponse } from 'node:http';
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

export function preRoute(runtime: EngineRuntime, req: IncomingMessage, res: ServerResponse): Exchange | null {
  const { method, url } = req;
  if (method === undefined || url === undefined) {
    res.destroy();
    return null;
  }
  const fault = checkFraming(req.rawHeaders);
  if (fault !== null) {
    return refuse(runtime, res, method, 400, 'BAD_REQUEST', FRAMING_MESSAGES[fault], true);
  }
  const { path, query } = splitTarget(url);
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
        state: 'running',
        closeConnection: false,
        lateSendError: null,
      };
    case 'not-found':
      return refuse(runtime, res, method, 404, 'NOT_FOUND', `Route ${method} ${path} not found`, false);
    case 'malformed-path':
      return refuse(runtime, res, method, 400, 'BAD_REQUEST', 'Malformed percent-encoding in request path', false);
    case 'param-too-long':
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
