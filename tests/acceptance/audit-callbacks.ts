// Does:  Exercises foreign promises and hostile author results through real HTTP requests.
// Holds: Rejected authorization never invokes a handler and malformed results cannot escape the process.

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer, type HookName } from '@skeld/core/server';

function foreign(source: string): never {
  const value: unknown = runInNewContext(source);
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: hostile foreign values deliberately cross the public author boundary
  return value as never;
}

const contract = defineContract({ test: { method: 'GET', path: '/test', responses: { 200: t.boolean() } } });
const failures: unknown[] = [];
process.on('unhandledRejection', (error) => failures.push(error));
process.on('uncaughtExceptionMonitor', (error) => failures.push(error));

for (const stage of ['onRequest', 'preHandler', 'onSend'] as const) {
  const server = createServer();
  let invoked = 0;
  const denied = () => foreign('Promise.reject(new Error("denied"))');
  if (stage === 'onRequest') {
    server.addHook(stage, denied);
  } else if (stage === 'preHandler') {
    server.addHook(stage, denied);
  } else {
    server.addHook(stage, denied);
  }
  server.routes(contract, {
    test: () => {
      invoked++;
      return { status: 200, body: true };
    },
  });
  // biome-ignore lint/performance/noAwaitInLoops: each server must close before the next containment probe
  const address = await server.listen({ port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/test`);
    assert.equal(response.status, 500, stage);
    await response.text();
    assert.equal(invoked, stage === 'onSend' ? 1 : 0, stage);
  } finally {
    await server.close();
  }
}

for (const source of [
  'Promise.resolve({status: 200, body: true})',
  '({then(resolve) { resolve({status: 200, body: true}); resolve({status: 201}); throw Error("late"); }})',
  '({get then() { throw Error("getter"); }})',
  'new Proxy({}, {getPrototypeOf() { throw Error("prototype"); }, get() { throw Error("get"); }})',
]) {
  const server = createServer();
  server.routes(contract, { test: () => foreign(source) });
  // biome-ignore lint/performance/noAwaitInLoops: each server must close before the next containment probe
  const address = await server.listen({ port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/test`);
    assert.equal(response.status, source.startsWith('Promise') || source.startsWith('({then') ? 200 : 500);
    await response.text();
  } finally {
    await server.close();
  }
}

const observers: readonly HookName[] = ['onResponse', 'onError'];
for (const stage of observers) {
  const server = createServer();
  let observed = 0;
  if (stage === 'onResponse') {
    server.addHook(stage, () => foreign('Promise.reject(new Error("observer"))'));
    server.addHook(stage, () => {
      observed++;
    });
  } else {
    server.addHook('onError', () => foreign('Promise.reject(new Error("observer"))'));
    server.addHook('onError', () => {
      observed++;
    });
  }
  server.routes(contract, {
    test: () => {
      if (stage === 'onError') {
        throw foreign('Object.defineProperty(new Error(), "message", {get() { throw Error("message"); }})');
      }
      return { status: 200, body: true };
    },
  });
  // biome-ignore lint/performance/noAwaitInLoops: each server must close before the next containment probe
  const address = await server.listen({ port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/test`);
    assert.equal(response.status, stage === 'onError' ? 500 : 200);
    await response.text();
    await delay(20);
    assert.equal(observed, 1);
  } finally {
    await server.close();
  }
}
await delay(20);
assert.deepEqual(failures, []);
process.stdout.write('audit callback containment passed\n');
