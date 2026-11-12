// Does:  Writes JSON bodies and the engine's own error bodies, completing each head through finishHead.
// Holds: An engine-written error keeps no author header but CORS and vary, and carries only the cookies it is given.

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { end, start, wrote } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import { finishHead } from './head.ts';
import type { EngineRuntime, RouteRuntime } from './types.ts';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const INTERNAL_BODY: ErrorBody = { status: 500, code: 'INTERNAL', message: 'Internal Server Error' };

// Why: Serialized once at load, so the last-resort body needs no serializer and cannot fail.
const INTERNAL_TEXT = JSON.stringify(INTERNAL_BODY);

// Why: Without its CORS headers a browser hides the error response from the page that made the call.
const KEPT_ON_ERROR: ReadonlySet<string> = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'vary',
]);

// Does:  Writes a JSON response; route is null for an engine-written error, and a refused redirect throws unwritten.
export function writeJson(
  res: ServerResponse,
  method: string,
  status: number,
  payload: string,
  close: boolean,
  secure: boolean,
  route: RouteRuntime | null,
  cookies: ReadonlyMap<string, string> | null,
): void {
  const headers: OutgoingHttpHeaders = {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
  };
  if (close) {
    headers.connection = 'close';
  }
  finishHead(res, status, headers, secure, route, cookies);
  res.writeHead(status, headers);
  // Why: A HEAD response declares the length of the body it does not send.
  if (method === 'HEAD') {
    res.end();
    wrote(status, headers, null);
  } else {
    res.end(payload);
    wrote(status, headers, payload);
  }
}

function errorText(runtime: EngineRuntime, body: ErrorBody): string | null {
  try {
    const written = runtime.errorSerializer.write(body);
    return typeof written === 'string' ? written : null;
  } catch {
    // Why: An HttpError's details come from the author; a throwing getter must not leave the request unanswered.
    return null;
  }
}

// Does:  Writes an error body with its cookies, or the fixed 500 text with none; false means the body did not fit.
export function writeErrorBody(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  body: ErrorBody,
  close: boolean,
  cookies: ReadonlyMap<string, string> | null,
): boolean {
  const span = start('err.write');
  const text = errorText(runtime, body);
  const closing = close || runtime.isClosing();
  // Why: A header set before the failure (a cookie, a cache directive) must not ride out on the error.
  for (const name of res.getHeaderNames()) {
    if (!KEPT_ON_ERROR.has(name)) {
      res.removeHeader(name);
    }
  }
  // Why: removeHeader('date') turns sendDate off, which would leave the error without Node's Date header.
  res.sendDate = true;
  if (text === null) {
    writeJson(res, method, INTERNAL_BODY.status, INTERNAL_TEXT, closing, runtime.securityHeaders, null, null);
  } else {
    writeJson(res, method, body.status, text, closing, runtime.securityHeaders, null, cookies);
  }
  end(span);
  return text !== null;
}
