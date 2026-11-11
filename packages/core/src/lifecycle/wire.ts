// Does:  Writes JSON bodies and the engine's own error bodies, and adds the security headers to the heads it writes.
// Holds: An engine-written error keeps no author header but CORS and vary; it carries the security headers when on.

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { end, start, wrote } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import type { EngineRuntime } from './types.ts';

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

// Why: OWASP's REST guidance; the two frame bans cover old and new browsers, no-store keeps replies out of caches.
const SECURITY_HEADERS = [
  ['x-content-type-options', 'nosniff'],
  ['content-security-policy', "frame-ancestors 'none'"],
  ['x-frame-options', 'DENY'],
  ['cache-control', 'no-store'],
] as const;

// Does:  Adds to the head about to be written each security header the response does not already carry.
export function addSecurityHeaders(res: ServerResponse, head: OutgoingHttpHeaders): void {
  for (const [name, value] of SECURITY_HEADERS) {
    if (!res.hasHeader(name)) {
      head[name] = value;
    }
  }
}

export function writeJson(
  res: ServerResponse,
  method: string,
  status: number,
  payload: string,
  close: boolean,
  secure: boolean,
): void {
  const headers: OutgoingHttpHeaders = {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
  };
  if (close) {
    headers.connection = 'close';
  }
  if (secure) {
    addSecurityHeaders(res, headers);
  }
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

// Does:  Writes an error body, falling back to the fixed 500 text; false means the body did not fit the schema.
export function writeErrorBody(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  body: ErrorBody,
  close: boolean,
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
    writeJson(res, method, INTERNAL_BODY.status, INTERNAL_TEXT, closing, runtime.securityHeaders);
  } else {
    writeJson(res, method, body.status, text, closing, runtime.securityHeaders);
  }
  end(span);
  return text !== null;
}
