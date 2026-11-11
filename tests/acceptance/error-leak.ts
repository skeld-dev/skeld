// Does:  Proves that a thrown error with no status is answered with the fixed 500 body and nothing of its own.
// Holds: A random token in the thrown message must not appear anywhere in the response bytes.

import { randomUUID } from 'node:crypto';
import * as t from '@darkstart/core/schema';
import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';
import { check, conclude, rawExchange } from './support.ts';

const statement =
  'a handler that throws an error with no status answers 500 with the fixed INTERNAL body and neither the thrown message nor its stack appears in the response';
const expectedBody = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';

const contract = defineContract({
  leak: { method: 'GET', path: '/leak', responses: { 200: t.object({ ok: t.boolean() }) } },
});

const token = randomUUID();
const server = createServer();
server.routes(contract, {
  leak: () => {
    throw new Error(`secret-xyz-${token}`);
  },
});

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const response = await rawExchange(port, 'GET /leak HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  check(problems, response.status === 500, `GET /leak answered ${response.status}`);
  check(problems, response.body === expectedBody, `body was ${response.body}`);
  check(problems, !response.raw.includes(token), 'the random token appears in the response bytes');
  check(problems, !response.raw.includes('secret-xyz'), 'the thrown message prefix appears in the response bytes');
  check(problems, !/\n\s+at /.test(response.raw), 'a stack frame appears in the response bytes');
} finally {
  await server.close();
}
conclude(statement, problems);
