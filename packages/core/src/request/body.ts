import { current, end, event, leave, limit, resume, start } from '#diag';
import type { IncomingMessage } from 'node:http';
import type { BodyReadResult } from './types.ts';

const TOO_LARGE: BodyReadResult = { kind: 'too-large' };
const ABORTED: BodyReadResult = { kind: 'aborted' };

// TextDecoder strips a leading UTF-8 BOM and Buffer#toString does not; both replace invalid bytes alike.
function decodeUtf8(bytes: Buffer): string {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.toString('utf8', 3)
    : bytes.toString('utf8');
}

export function readBody(
  req: IncomingMessage,
  bodyLimit: number,
  contentLength: number | null,
  done: (result: BodyReadResult) => void,
): BodyReadResult | null {
  if (contentLength !== null && contentLength > bodyLimit) {
    limit('limit.body_bytes', contentLength, bodyLimit);
    event('refuse.body_limit', 'declared');
    return TOO_LARGE;
  }
  if (req.destroyed) {
    return ABORTED;
  }
  const slot = current();
  const span = start('req.body.read');
  let first: Buffer | null = null;
  let rest: Buffer[] | null = null;
  let received = 0;

  const detach = (): void => {
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('close', onClose);
    end(span);
  };
  const onData = (chunk: Buffer): void => {
    resume(slot);
    received += chunk.length;
    if (received > bodyLimit) {
      limit('limit.body_bytes', received, bodyLimit);
      event('refuse.body_limit', 'streamed');
      req.pause();
      detach();
      done(TOO_LARGE);
    } else if (first === null) {
      first = chunk;
    } else if (rest === null) {
      rest = [first, chunk];
    } else {
      rest.push(chunk);
    }
    leave(slot);
  };
  const onEnd = (): void => {
    resume(slot);
    limit('limit.body_bytes', received, bodyLimit);
    detach();
    const bytes = rest === null ? first : Buffer.concat(rest, received);
    done({ kind: 'ok', text: bytes === null ? '' : decodeUtf8(bytes) });
    leave(slot);
  };
  // IncomingMessage emits 'error' only to existing listeners and always follows it with 'close' (_http_incoming.js onError).
  const onClose = (): void => {
    resume(slot);
    detach();
    done(ABORTED);
    leave(slot);
  };

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('close', onClose);
  return null;
}
