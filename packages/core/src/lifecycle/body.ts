// Does:  Reads and decodes a route's request body (JSON or plain text).
// Holds: Size and media type are accepted before a single byte is parsed.

import { event } from '#diag';
import type { IncomingMessage } from 'node:http';
import { HttpError } from '../contract/http-error.ts';
import { readBody } from '../request/body.ts';
import { parseJsonBody } from '../request/json.ts';
import { parseMediaType } from '../request/media-type.ts';
import type { BodyReadResult } from '../request/types.ts';

export type BodyOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'refused'; readonly error: HttpError; readonly close: boolean }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed'; readonly error: unknown };

const JSON_TYPE = 'application/json';
const TEXT_TYPE = 'text/plain';
const ABSENT: BodyOutcome = { kind: 'value', value: undefined };

function refused(status: number, code: string, message: string): BodyOutcome {
  return { kind: 'refused', error: new HttpError(status, code, message), close: false };
}

// Does:  Turns a finished read into an outcome; only an oversized body asks for the connection to close.
function decode(result: BodyReadResult, type: string, limit: number): BodyOutcome {
  switch (result.kind) {
    case 'aborted':
      return { kind: 'aborted' };
    case 'too-large':
      return {
        kind: 'refused',
        error: new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds the limit of ${limit} bytes`),
        // Why: The rest of the body is unread, so the connection cannot carry another request.
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
    case 'too-deep':
      event('refuse.body_depth');
      return refused(400, 'BAD_REQUEST', 'Request body is nested too deeply');
    case 'forbidden-key':
      event('refuse.forbidden_key', parsed.key);
      return refused(400, 'BAD_REQUEST', `Request body contains a forbidden key: ${parsed.key}`);
  }
}

// Does:  Tells whether Content-Length alone already exceeds the limit, before any hook runs.
// Holds: A missing or unreadable length is false; the read itself still enforces the limit.
export function declaresOverLimit(req: IncomingMessage, limit: number): boolean {
  const declared = req.headers['content-length'];
  return declared !== undefined && Number.parseInt(declared, 10) > limit;
}

// Does:  Reads the body when there is one: returns the outcome now, or null and reports it later through done.
// Holds: Either an outcome is returned or done is called once, never both.
export function readRouteBody(
  req: IncomingMessage,
  limit: number,
  done: (outcome: BodyOutcome) => void,
): BodyOutcome | null {
  const declared = req.headers['content-length'];
  const contentLength = declared === undefined ? null : Number.parseInt(declared, 10);
  // Why: A request with neither Content-Length nor Transfer-Encoding has no body (RFC 9112 section 6).
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
  const early = readBody(req, limit, contentLength, (result) => {
    let outcome: BodyOutcome;
    // Why: This runs from a socket event, outside the caller's stack; a throw here would be uncaught.
    try {
      outcome = decode(result, type, limit);
    } catch (error) {
      outcome = { kind: 'failed', error };
    }
    done(outcome);
  });
  return early === null ? null : decode(early, type, limit);
}
