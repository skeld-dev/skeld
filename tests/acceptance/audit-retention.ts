// Does:  Proves real disconnected requests leave deadline queues and timer bounds reject overflow.
// Holds: Queue assertions measure framework reachability, not inferred garbage collection or heap exhaustion.

import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { defineContract } from '@skeld/core/contract';
import { createServer } from '@skeld/core/server';
import { handleRequest } from '../../packages/core/dist/lifecycle/handle-request.js';
import { createHttpServer } from '../../packages/core/dist/server/listen.js';
import { resolveServerOptions } from '../../packages/core/dist/server/options.js';
import { buildRuntime } from '../../packages/core/dist/server/runtime.js';
import { createScope, createScopeState } from '../../packages/core/dist/server/scope.js';

const contract = defineContract({ pending: { method: 'GET', path: '/pending', responses: { 204: null } } });

async function retention(stage: 'handler' | 'hook', disconnect: boolean): Promise<void> {
  const options = resolveServerOptions({ handlerTimeoutMs: 60_000, closeTimeoutMs: 10 });
  const root = createScopeState('root', null);
  const scope = createScope(root);
  const entered = Promise.withResolvers<AbortSignal>();
  const unblock = Promise.withResolvers<void>();
  if (stage === 'hook') {
    scope.addHook('preHandler', (context) => {
      entered.resolve(context.signal);
      return unblock.promise;
    });
  }
  scope.routes(contract, {
    pending: (context) => {
      entered.resolve(context.signal);
      return unblock.promise.then(() => ({ status: 204 }));
    },
  });
  const runtime = buildRuntime(root, options, null, () => false);
  const queue = runtime.deadlines.queue(options.handlerTimeoutMs);
  const transport = createHttpServer(options, (req, res) => handleRequest(runtime, req, res));
  const address = await transport.listen('127.0.0.1', 0, root.disposal.abort.signal);
  const client = request(`${address.url}/pending`);
  const clientClosed = Promise.withResolvers<void>();
  client.on('error', (error: NodeJS.ErrnoException) => assert.equal(error.code, 'ECONNRESET'));
  client.on('close', () => clientClosed.resolve());
  client.end();
  try {
    const signal = await entered.promise;
    assert.equal(queue.size, 1, `${stage}: pending request must actually be retained before close`);
    const exchange = queue.values().next().value;
    assert(exchange !== undefined);
    if (disconnect) {
      client.destroy();
      await clientClosed.promise;
      for (let attempt = 0; attempt < 50 && Number(queue.size) !== 0; attempt++) {
        // biome-ignore lint/performance/noAwaitInLoops: wait for the actual peer-close event, bounded at 500 ms
        await delay(10);
      }
      assert.equal(queue.size, 0, `${stage}: peer close must remove queue ownership`);
      assert.equal(signal.aborted, true);
    }
    runtime.deadlines.stop();
    assert.equal(queue.size, 0, `${stage}: stop must clear an actively populated queue`);
    assert.equal(exchange.waiting, null);
    runtime.deadlines.wait(exchange);
    assert.equal(queue.size, 0, `${stage}: late work must not restart a stopped manager`);
    unblock.resolve();
    await delay(20);
    assert.equal(queue.size, 0, `${stage}: settling author work must not restore queue ownership`);
  } finally {
    client.destroy();
    await transport.close(options.closeTimeoutMs);
    runtime.deadlines.stop();
  }
}

for (const stage of ['handler', 'hook'] as const) {
  for (const disconnect of [true, false]) {
    // biome-ignore lint/performance/noAwaitInLoops: each probe owns one transport and deadline manager
    await retention(stage, disconnect);
  }
}

const max = 2_147_483_647;
for (const value of [max, max + 1]) {
  const server = createServer();
  if (value === max) {
    server.routes(contract, { pending: () => ({ status: 204 }) }, { handlerTimeouts: { pending: value } });
  } else {
    assert.throws(
      () => server.routes(contract, { pending: () => ({ status: 204 }) }, { handlerTimeouts: { pending: value } }),
      { code: 'INVALID_OPTION' },
    );
  }
  // biome-ignore lint/performance/noAwaitInLoops: every option probe completes its own lifecycle
  await server.close();
}
process.stdout.write('audit real-request deadline retention and route timer boundaries passed\n');
