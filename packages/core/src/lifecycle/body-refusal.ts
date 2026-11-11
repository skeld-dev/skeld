// Does:  Delivers a refused body's response through a bounded half-close, then stops the connection.
// Holds: A refused socket dispatches no later request; its grace ends on a deadline, a byte cap or the peer's EOF.

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { end, event, limit, track } from '#diag';

// Why: The response gets a bounded grace to be read, even when the sender never stops sending.
const GRACE_MS = 500;
const DISCARD_BYTES = 256 * 1024;
const MAX_GRACES = 256;
const refused = new WeakMap<Socket, () => void>();
let graces = 0;

// Does:  Stops a request that arrived on a socket already refused; true means the caller must not handle it.
export function stopRefusedPipeline(req: IncomingMessage): boolean {
  const stop = refused.get(req.socket);
  if (stop === undefined) {
    return false;
  }
  stop();
  event('refuse.close', 'pipeline');
  return true;
}

// Does:  Arms the socket so that ending the response half-closes it and drains input within the bounds.
// Holds: Idempotent per socket; the socket's own destroySoon is restored when it closes.
export function stageBodyRefusal(req: IncomingMessage): void {
  const { socket } = req;
  if (refused.has(socket)) {
    return;
  }
  const original = socket.destroySoon;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let span: ReturnType<typeof track> | null = null;
  let received = 0;
  let paused = false;
  const stop = (): void => {
    paused = true;
    req.pause();
    socket.pause();
  };
  const onResume = (): void => {
    if (paused) {
      socket.pause();
    }
  };
  const onData = (chunk: Buffer): void => {
    received += chunk.length;
    limit('limit.refusal_bytes', received, DISCARD_BYTES);
    if (received >= DISCARD_BYTES) {
      stop();
      event('refuse.close', 'bytes');
    }
  };
  const onEnd = (): void => {
    // Why: The peer's EOF permits a full close, but outstanding writes must still be flushed first.
    original.call(socket);
  };
  const onClose = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      graces--;
      limit('limit.refusal_connections', graces, MAX_GRACES);
    }
    if (span !== null) {
      end(span);
    }
    socket.off('data', onData);
    socket.off('resume', onResume);
    socket.off('end', onEnd);
    refused.delete(socket);
    socket.destroySoon = original;
  };
  refused.set(socket, stop);
  socket.once('close', onClose);
  socket.on('resume', onResume);
  // Why: Node calls destroySoon after the response finishes, so only this refused socket's teardown changes.
  socket.destroySoon = (): void => {
    if (timer !== null) {
      return;
    }
    if (graces >= MAX_GRACES || socket.destroyed) {
      event('refuse.close', 'capacity');
      original.call(socket);
      return;
    }
    graces++;
    limit('limit.refusal_connections', graces, MAX_GRACES);
    span = track('refuse.teardown');
    timer = setTimeout(() => {
      event('refuse.close', 'deadline');
      socket.destroy();
    }, GRACE_MS);
    timer.unref();
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.end();
    if (!paused) {
      req.resume();
    }
  };
}
