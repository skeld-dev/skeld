import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { end, start, wrote } from '#diag';
import type { ErrorBody } from '../contract/types.ts';
import type { EngineRuntime } from './types.ts';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

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

export function writeErrorBody(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  body: ErrorBody,
  close: boolean,
): void {
  const span = start('err.write');
  writeJson(res, method, body.status, runtime.errorSerializer(body), close || runtime.isClosing());
  end(span);
}
