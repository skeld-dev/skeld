import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { end, start, wrote } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import type { EngineRuntime } from './types.ts';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const INTERNAL_BODY: ErrorBody = { status: 500, code: 'INTERNAL', message: 'Internal Server Error' };

const INTERNAL_TEXT = JSON.stringify(INTERNAL_BODY);

const KEPT_ON_ERROR: ReadonlySet<string> = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'vary',
]);

export function writeJson(
  res: ServerResponse,
  method: string,
  status: number,
  payload: string | Uint8Array,
  close: boolean,
): void {
  const headers: OutgoingHttpHeaders = {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
  };
  if (close) {
    headers.connection = 'close';
  }
  res.writeHead(status, headers);
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
    // An HttpError's details come from the author; a throwing getter there must not leave the request unanswered.
    return null;
  }
}

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
  for (const name of res.getHeaderNames()) {
    if (!KEPT_ON_ERROR.has(name)) {
      res.removeHeader(name);
    }
  }
  // removeHeader('date') turns sendDate off, which would leave the error without Node's Date.
  res.sendDate = true;
  if (text === null) {
    writeJson(res, method, INTERNAL_BODY.status, INTERNAL_TEXT, closing);
  } else {
    writeJson(res, method, body.status, text, closing);
  }
  end(span);
  return text !== null;
}
