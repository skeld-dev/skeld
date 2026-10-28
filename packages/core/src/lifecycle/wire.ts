import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
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
  } else {
    res.end(payload);
  }
}

export function writeErrorBody(
  runtime: EngineRuntime,
  res: ServerResponse,
  method: string,
  body: ErrorBody,
  close: boolean,
): void {
  writeJson(res, method, body.status, runtime.errorSerializer(body), close || runtime.isClosing());
}
