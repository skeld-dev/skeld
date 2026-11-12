// Does:  Proves that malformed percent-encoding in the request path is answered 400.
// Holds: No hook and no handler runs for the refused request.

import * as t from '@skeld/core/schema';
import { defineContract } from '@skeld/core/contract';
import { createServer } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';

const statement = 'a malformed percent-encoding in the request path answers 400 and runs no hook and no handler';
const expectedStatus = 400;
const expectedCode = 'BAD_REQUEST';

const contract = defineContract({
  hello: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({ name: t.string({ maxLength: 64 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

const counters = { hook: 0, handler: 0 };
const server = createServer();
server.addHook('onRequest', () => {
  counters.hook++;
});
server.routes(contract, {
  hello: () => {
    counters.handler++;
    return { status: 200, body: { ok: true } };
  },
});

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const paths = ['/hello/%world', '/hello/%', '/hello/%4', '/hello/a%zzb'];
  const responses = await Promise.all(
    paths.map((path) => rawExchange(port, `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)),
  );
  for (const [index, response] of responses.entries()) {
    check(problems, response.status === expectedStatus, `GET ${paths[index]} answered ${response.status}`);
    check(
      problems,
      response.body.includes(`"code":"${expectedCode}"`),
      `GET ${paths[index]} body was ${response.body}`,
    );
  }
  check(
    problems,
    counters.hook === 0 && counters.handler === 0,
    `counters after malformed paths: ${JSON.stringify(counters)}`,
  );
  const control = await rawExchange(port, 'GET /hello/world HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  check(problems, control.status === 200, `control GET /hello/world answered ${control.status}`);
  check(problems, counters.hook === 1 && counters.handler === 1, `counters after control: ${JSON.stringify(counters)}`);
} finally {
  await server.close();
}
conclude(statement, problems);
