import type { IncomingMessage } from 'node:http';
import type { BodyReadResult } from './types.ts';

const decoder = new TextDecoder();

export function readBody(req: IncomingMessage, limit: number, contentLength: number | null): Promise<BodyReadResult> {
  if (contentLength !== null && contentLength > limit) {
    return Promise.resolve({ kind: 'too-large' });
  }
  if (req.destroyed) {
    return Promise.resolve({ kind: 'aborted' });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const finish = (result: BodyReadResult): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onAbort);
      req.off('close', onAbort);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > limit) {
        req.pause();
        finish({ kind: 'too-large' });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      finish({ kind: 'ok', text: decoder.decode(Buffer.concat(chunks, received)) });
    };
    const onAbort = (): void => {
      finish({ kind: 'aborted' });
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onAbort);
    req.on('close', onAbort);
  });
}
