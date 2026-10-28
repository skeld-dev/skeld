import { Type } from 'typebox';
import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';
import { check, conclude } from './support.ts';

const statement =
  'a JSON body with an own __proto__ key or an own constructor.prototype key answers 400 and does not run the handler';
const expectedStatus = 400;
const expectedCode = 'BAD_REQUEST';

const contract = defineContract({
  hello: {
    method: 'POST',
    path: '/hello',
    body: Type.Object({
      name: Type.String({ minLength: 1 }),
      language: Type.Union([Type.Literal('en'), Type.Literal('pt')]),
    }),
    responses: { 200: Type.Object({ message: Type.String() }) },
  },
});

let handlerRuns = 0;
const server = createServer();
server.routes(contract, {
  hello: ({ body }) => {
    handlerRuns++;
    return { status: 200, body: { message: `Hello, ${body.name}` } };
  },
});

const poisoned = [
  '{"__proto__":{"a":1},"name":"Ada","language":"en"}',
  '{"constructor":{"prototype":{}},"name":"Ada","language":"en"}',
];
const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
const post = (body: string) =>
  fetch(`http://127.0.0.1:${port}/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
try {
  const responses = await Promise.all(
    poisoned.map(async (body) => {
      const response = await post(body);
      return { body, status: response.status, text: await response.text() };
    }),
  );
  for (const response of responses) {
    check(problems, response.status === expectedStatus, `${response.body} answered ${response.status}`);
    check(problems, response.text.includes(`"code":"${expectedCode}"`), `${response.body} body was ${response.text}`);
  }
  check(problems, handlerRuns === 0, `handler ran ${handlerRuns} times for poisoned bodies`);
  const control = await post('{"name":"Ada","language":"en"}');
  check(problems, control.status === 200, `control body answered ${control.status}`);
  await control.text();
  check(problems, handlerRuns === 1, `handler ran ${handlerRuns} times after the control`);
} finally {
  await server.close();
}
conclude(statement, problems);
