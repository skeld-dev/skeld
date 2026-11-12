// Does:  Exercises disposal ordering, rollback, shutdown races and timer limits through public server APIs.
// Holds: Every registered disposer runs once, failures remain observable and close settles pending startup.

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '@skeld/core/server';

const events: string[] = [];
const server = createServer();
server.onClose(() => {
  events.push('root');
});
server.register((scope) => {
  scope.onClose(() => {
    events.push('parent');
  });
  scope.register((child) => {
    child.onClose(() => {
      events.push('child');
    });
  });
});
await server.listen({ port: 0 });
const closing = server.close();
assert.equal(server.close(), closing);
await closing;
assert.deepEqual(events, ['child', 'parent', 'root']);
assert.equal(server.signal.aborted, true);

const rollback: string[] = [];
const failed = createServer();
failed.register((scope) => {
  scope.onClose(() => {
    rollback.push('first');
  });
});
failed.register(() => {
  throw new Error('boot failure');
});
await assert.rejects(failed.listen({ port: 0 }), { code: 'PLUGIN_FAILED' });
assert.deepEqual(rollback, ['first']);
await failed.close();
assert.deepEqual(rollback, ['first']);

const disposal = createServer({ pluginCloseTimeoutMs: 20 });
const attempted: string[] = [];
disposal.onClose(() => {
  attempted.push('last');
});
disposal.onClose(() => {
  attempted.push('throw');
  throw new Error('cleanup');
});
disposal.onClose(() => {
  attempted.push('timeout');
  return new Promise(() => undefined);
});
await disposal.listen({ port: 0 });
await assert.rejects(disposal.close(), AggregateError);
assert.deepEqual(attempted, ['timeout', 'throw', 'last']);

const race = createServer();
let entered: (() => void) | undefined;
const started = new Promise<void>((resolve) => {
  entered = resolve;
});
let disposed = 0;
race.register(async (scope) => {
  scope.onClose(() => {
    disposed++;
  });
  entered?.();
  await new Promise<void>((resolve) => scope.signal.addEventListener('abort', () => resolve(), { once: true }));
});
const listening = race.listen({ port: 0 });
const refused = assert.rejects(listening, { code: 'SERVER_CLOSED' });
await started;
await race.close();
await refused;
assert.equal(disposed, 1);

const idle = createServer();
await idle.close();
await assert.rejects(idle.listen({ port: 0 }));

const max = 2_147_483_647;
// biome-ignore lint/security/noSecrets: public timer option names, not credentials
for (const name of ['pluginTimeoutMs', 'pluginCloseTimeoutMs', 'closeTimeoutMs', 'handlerTimeoutMs'] as const) {
  assert.throws(() => createServer({ [name]: max + 1 }), { code: 'INVALID_OPTION' });
  const valid = createServer({ [name]: max });
  // biome-ignore lint/performance/noAwaitInLoops: each lifecycle owns its cleanup completion
  await valid.close();
}
await delay(25);
process.stdout.write('audit lifecycle and timer boundaries passed\n');
