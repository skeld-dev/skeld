import { current, end, event, leave, limit, resume, start } from '#diag';
import type { IncomingMessage } from 'node:http';
import type { BodyReadResult } from './types.ts';

const decoder = new TextDecoder();

export function readBody(
  req: IncomingMessage,
  bodyLimit: number,
  contentLength: number | null,
): Promise<BodyReadResult> {
  if (contentLength !== null && contentLength > bodyLimit) {
    limit('limit.body_bytes', contentLength, bodyLimit);
    event('refuse.body_limit', 'declared');
    return Promise.resolve({ kind: 'too-large' });
  }
  if (req.destroyed) {
    return Promise.resolve({ kind: 'aborted' });
  }
  const slot = current();
  const span = start('req.body.read');
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const finish = (result: BodyReadResult): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onAbort);
      req.off('close', onAbort);
      end(span);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      resume(slot);
      received += chunk.length;
      if (received > bodyLimit) {
        limit('limit.body_bytes', received, bodyLimit);
        event('refuse.body_limit', 'streamed');
        req.pause();
        finish({ kind: 'too-large' });
        leave(slot);
        return;
      }
      chunks.push(chunk);
      leave(slot);
    };
    const onEnd = (): void => {
      resume(slot);
      limit('limit.body_bytes', received, bodyLimit);
      finish({ kind: 'ok', text: decoder.decode(Buffer.concat(chunks, received)) });
      leave(slot);
    };
    const onAbort = (): void => {
      resume(slot);
      finish({ kind: 'aborted' });
      leave(slot);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onAbort);
    req.on('close', onAbort);
  });
}
