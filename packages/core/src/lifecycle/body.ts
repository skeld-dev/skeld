import { current, event, leave, resume } from '#diag';
import type { IncomingMessage } from 'node:http';
import { HttpError } from '../contract/http-error.ts';
import { readBody } from '../request/body.ts';
import { parseJsonBody } from '../request/json.ts';
import { parseMediaType } from '../request/media-type.ts';
import type { BodyReadResult } from '../request/types.ts';

export type BodyOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'refused'; readonly error: HttpError; readonly close: boolean }
  | { readonly kind: 'aborted' };

const JSON_TYPE = 'application/json';
const TEXT_TYPE = 'text/plain';
const ABSENT: BodyOutcome = { kind: 'value', value: undefined };

function refused(status: number, code: string, message: string): BodyOutcome {
  return { kind: 'refused', error: new HttpError(status, code, message), close: false };
}

function decode(result: BodyReadResult, type: string, limit: number): BodyOutcome {
  switch (result.kind) {
    case 'aborted':
      return { kind: 'aborted' };
    case 'too-large':
      return {
        kind: 'refused',
        error: new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds the limit of ${limit} bytes`),
        close: true,
      };
    case 'ok':
      break;
  }
  if (type === TEXT_TYPE) {
    return { kind: 'value', value: result.text };
  }
  const parsed = parseJsonBody(result.text);
  switch (parsed.kind) {
    case 'ok':
      return { kind: 'value', value: parsed.value };
    case 'invalid-json':
      event('refuse.body_json');
      return refused(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    case 'forbidden-key':
      event('refuse.forbidden_key', parsed.key);
      return refused(400, 'BAD_REQUEST', `Request body contains a forbidden key: ${parsed.key}`);
  }
}

export function readRouteBody(req: IncomingMessage, limit: number): BodyOutcome | Promise<BodyOutcome> {
  const declared = req.headers['content-length'];
  const contentLength = declared === undefined ? null : Number.parseInt(declared, 10);
  if ((contentLength === null && req.headers['transfer-encoding'] === undefined) || contentLength === 0) {
    return ABSENT;
  }
  const media = parseMediaType(req.headers['content-type']);
  switch (media.kind) {
    case 'missing':
      event('refuse.media_type');
      return refused(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request has a body but no Content-Type');
    case 'invalid':
      event('refuse.media_type');
      return refused(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type is not a valid media type');
    case 'ok':
      break;
  }
  const { type } = media;
  if (type !== JSON_TYPE && type !== TEXT_TYPE) {
    event('refuse.media_type');
    return refused(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Unsupported media type ${type}; send application/json or text/plain`,
    );
  }
  const slot = current();
  return readBody(req, limit, contentLength).then((result) => {
    resume(slot);
    const outcome = decode(result, type, limit);
    leave(slot);
    return outcome;
  });
}
