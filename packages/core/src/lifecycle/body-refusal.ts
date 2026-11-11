import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { end, event, limit, track } from '#diag';

// Response delivery gets a bounded grace, even if the sender does not stop.
const GRACE_MS = 500;
const DISCARD_BYTES = 256 * 1024;
const MAX_GRACES = 256;
const refused = new WeakMap<Socket, () => void>();
let graces = 0;

export function stopRefusedPipeline(req: IncomingMessage): boolean {
  const stop = refused.get(req.socket);
  if (stop === undefined) {
    return false;
  }
  stop();
  event('refuse.close', 'pipeline');
  return true;
}

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
    // Peer EOF permits full close, but still finish any outstanding writes.
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
  // Node calls this after response finish; only the refused socket changes.
  // res.end and its finish/close hooks retain their normal semantics.
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
