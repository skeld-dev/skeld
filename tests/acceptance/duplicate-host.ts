import * as t from '@darkstart/core/schema';
import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';
import { check, conclude, rawExchange } from './support.ts';

const statement =
  'a request with two Host header fields answers 400 with connection: close and runs no hook and no handler';
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
  const response = await rawExchange(port, 'GET /hello/world HTTP/1.1\r\nHost: a.example\r\nHost: b.example\r\n\r\n');
  check(problems, response.status === expectedStatus, `two Host fields answered ${response.status}`);
  check(problems, response.body.includes(`"code":"${expectedCode}"`), `body was ${response.body}`);
  check(
    problems,
    response.headers.get('connection') === 'close',
    `connection header was ${response.headers.get('connection')}`,
  );
  check(problems, counters.hook === 0 && counters.handler === 0, `counters: ${JSON.stringify(counters)}`);
  const control = await rawExchange(port, 'GET /hello/world HTTP/1.1\r\nHost: a.example\r\nConnection: close\r\n\r\n');
  check(problems, control.status === 200, `control with one Host answered ${control.status}`);
  check(problems, counters.hook === 1 && counters.handler === 1, `counters after control: ${JSON.stringify(counters)}`);
} finally {
  await server.close();
}
conclude(statement, problems);
