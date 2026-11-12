// Does:  Measures how long listen takes for a contract of 200 routes.
// Holds: It prints the figure and judges nothing; one request proves the server really served.

import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const routeCount = 200;

function route(index: number) {
  return {
    method: 'POST',
    path: `/r${index}`,
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: {
      201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    },
  } as const;
}

const names = Array.from({ length: routeCount }, (_, index) => `r${index}`);
const contract = defineContract(Object.fromEntries(names.map((name, index) => [name, route(index)])));

const server = createServer();
server.routes(
  contract,
  Object.fromEntries(names.map((name) => [name, ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } })])),
);

const started = performance.now();
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
const listenMs = performance.now() - started;
const probe = await fetch(`http://127.0.0.1:${port}/r${routeCount - 1}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ a: 'x', b: true }),
});
await server.close();
process.stdout.write(`${JSON.stringify({ listenMs })}\n`);
if (probe.status !== 201) {
  process.stderr.write(`the last of ${routeCount} routes answered ${probe.status}\n`);
  process.exitCode = 1;
}
