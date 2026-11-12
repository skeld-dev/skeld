// Does:  Forces close during native binding and checks rollback with hostile and foreign promise results.
// Holds: Both startup and close settle, rollback preserves both failures, and cleanup runs exactly once.

import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import { createServer } from '@darkstart/core/server';

async function bindRace(port: number): Promise<void> {
  const original = net.Server.prototype.listen;
  const server = createServer();
  let closing: Promise<void> | undefined;
  let disposed = 0;
  server.onClose(() => {
    disposed += 1;
  });
  // Why: Force the same interleaving whether Node completes binding synchronously or schedules its result.
  Object.defineProperty(net.Server.prototype, 'listen', {
    configurable: true,
    writable: true,
    value(this: net.Server, ...args: unknown[]) {
      const result: net.Server = Reflect.apply(original, this, args);
      closing = server.close();
      return result;
    },
  });
  try {
    await assert.rejects(server.listen({ host: '127.0.0.1', port }), { code: 'SERVER_CLOSED' });
    assert(closing !== undefined);
    await closing;
    assert.equal(disposed, 1);
    await delay(20);
  } finally {
    Object.defineProperty(net.Server.prototype, 'listen', { configurable: true, writable: true, value: original });
    await server.close();
  }
}

await bindRace(0);
const occupied = net.createServer();
await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
try {
  const address = occupied.address();
  assert(address !== null && typeof address !== 'string');
  await bindRace(address.port);
} finally {
  await new Promise<void>((resolve) => occupied.close(() => resolve()));
}

const reentrant = createServer();
let nested: Promise<void> | undefined;
reentrant.signal.addEventListener('abort', () => {
  nested = reentrant.close();
});
const outer = reentrant.close();
assert.equal(nested, outer);
await outer;

const failure = createServer();
let disposed = 0;
failure.register((scope) => {
  scope.onClose(() => {
    disposed += 1;
    throw new Error('cleanup marker');
  });
  throw new Error('startup marker');
});
await assert.rejects(failure.listen({ port: 0 }), (error: unknown) => {
  assert(error instanceof Error);
  assert.equal(Reflect.get(error, 'code'), 'PLUGIN_FAILED');
  assert(error.cause instanceof AggregateError);
  assert.equal(error.cause.errors.length, 2);
  assert(error.cause.errors[1] instanceof AggregateError);
  return true;
});
await assert.rejects(failure.close(), AggregateError);
assert.equal(disposed, 1);

const foreign = createServer();
const cleanup: string[] = [];
foreign.register((scope) => {
  scope.onClose(() => {
    cleanup.push('last');
  });
  scope.onClose(() => vm.runInNewContext('Promise.reject(new Error("foreign cleanup"))'));
  return vm.runInNewContext('Promise.reject(new Error("foreign boot"))');
});
await assert.rejects(foreign.listen({ port: 0 }), { code: 'PLUGIN_FAILED' });
await assert.rejects(foreign.close(), AggregateError);
assert.deepEqual(cleanup, ['last']);

const hostile = createServer();
let released = false;
hostile.register((scope) => {
  scope.onClose(() => {
    released = true;
  });
  return Object.defineProperty(Promise.resolve(), 'then', {
    get() {
      throw new Error('subscription failed');
    },
  });
});
await assert.rejects(hostile.listen({ port: 0 }), { code: 'PLUGIN_FAILED' });
await hostile.close();
assert(released);
process.stdout.write('pass lifecycle bind races, reentrant close, aggregate rollback and foreign/hostile promises\n');
