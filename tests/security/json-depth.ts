// Does:  Proves that a body nested past 64 levels is a 400 BAD_REQUEST and a schema nested past 64 fails listen.
// Holds: Brackets inside a string never count as nesting, and the boundary is tried on both sides at 64 and 65.

import { defineContract } from '@skeld/core/contract';
import { BootError } from '@skeld/core/boot-error';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';

const statement =
  'a JSON body nested 65 deep is answered 400 BAD_REQUEST and its handler does not run, a body nested 64 deep on a route whose schema allows 64 is accepted, brackets inside a string are not nesting, and listen rejects with BootError NESTED_TOO_DEEP for a body schema and for a response schema nested 65 deep';
const allowed = 64;

function nestedArrays(levels: number): t.Schema {
  let schema: t.Schema = t.integer({ minimum: 0, maximum: 9 });
  for (let level = 0; level < levels; level++) {
    schema = t.array(schema, { maxItems: 1 });
  }
  return schema;
}

function nestedObjects(levels: number): t.Schema {
  let schema: t.Schema = t.object({ v: t.integer({ minimum: 0, maximum: 9 }) });
  for (let level = 1; level < levels; level++) {
    schema = t.object({ a: schema });
  }
  return schema;
}

function arrayText(levels: number): string {
  return `${'['.repeat(levels)}${']'.repeat(levels)}`;
}

function objectText(levels: number): string {
  return `${'{"a":'.repeat(levels - 1)}{"v":1}${'}'.repeat(levels - 1)}`;
}

function post(path: string, body: string): string {
  return `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
}

function errorCode(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && 'code' in parsed ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

async function rejection(start: () => Promise<unknown>): Promise<unknown> {
  try {
    await start();
    return null;
  } catch (error) {
    return error;
  }
}

const hundredsOfBrackets = `${'['.repeat(300)}${'{'.repeat(300)}"${'['.repeat(200)}\\${'{'.repeat(200)}`;
const runs = { arrays: 0, objects: 0, text: 0 };
let seenText: unknown = null;

const contract = defineContract({
  arrays: {
    method: 'POST',
    path: '/arrays',
    body: nestedArrays(allowed),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  objects: {
    method: 'POST',
    path: '/objects',
    body: nestedObjects(allowed),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  text: {
    method: 'POST',
    path: '/text',
    body: t.object({ s: t.string({ maxLength: 2000 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

const server = createServer();
server.routes(contract, {
  arrays: () => {
    runs.arrays++;
    return { status: 200, body: { ok: true } };
  },
  objects: () => {
    runs.objects++;
    return { status: 200, body: { ok: true } };
  },
  text: ({ body }) => {
    runs.text++;
    seenText = body.s;
    return { status: 200, body: { ok: true } };
  },
});

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const arrays65 = await rawExchange(port, post('/arrays', arrayText(allowed + 1)));
  check(problems, arrays65.status === 400, `array body 65 deep answered ${arrays65.status}`);
  check(
    problems,
    errorCode(arrays65.body) === 'BAD_REQUEST',
    `array body 65 deep code was ${errorCode(arrays65.body)}`,
  );
  check(problems, runs.arrays === 0, `handler ran ${runs.arrays} times for the 65-deep array body`);

  const objects65 = await rawExchange(port, post('/objects', objectText(allowed + 1)));
  check(problems, objects65.status === 400, `object body 65 deep answered ${objects65.status}`);
  check(
    problems,
    errorCode(objects65.body) === 'BAD_REQUEST',
    `object body 65 deep code was ${errorCode(objects65.body)}`,
  );
  check(problems, runs.objects === 0, `handler ran ${runs.objects} times for the 65-deep object body`);

  const arrays64 = await rawExchange(port, post('/arrays', arrayText(allowed)));
  check(problems, arrays64.status === 200, `array body 64 deep answered ${arrays64.status}: ${arrays64.body}`);
  check(problems, runs.arrays === 1, `handler ran ${runs.arrays} times for the 64-deep array body`);

  const objects64 = await rawExchange(port, post('/objects', objectText(allowed)));
  check(problems, objects64.status === 200, `object body 64 deep answered ${objects64.status}: ${objects64.body}`);
  check(problems, runs.objects === 1, `handler ran ${runs.objects} times for the 64-deep object body`);

  const text = await rawExchange(port, post('/text', JSON.stringify({ s: hundredsOfBrackets })));
  check(problems, text.status === 200, `string of 1,002 brackets answered ${text.status}: ${text.body}`);
  check(problems, runs.text === 1, `handler ran ${runs.text} times for the bracket string`);
  check(problems, seenText === hundredsOfBrackets, 'the handler did not receive the bracket string unchanged');
} finally {
  await server.close();
}

const bodyServer = createServer();
bodyServer.routes(
  defineContract({
    deep: {
      method: 'POST',
      path: '/deep',
      body: nestedArrays(allowed + 1),
      responses: { 200: t.object({ ok: t.boolean() }) },
    },
  }),
  { deep: () => ({ status: 200, body: { ok: true } }) },
);
const bodyError = await rejection(() => bodyServer.listen({ port: 0, host: '127.0.0.1' }));
await bodyServer.close();
check(problems, bodyError instanceof BootError, `listen for a 65-deep body schema ended with ${String(bodyError)}`);
check(
  problems,
  bodyError instanceof BootError && bodyError.code === 'NESTED_TOO_DEEP',
  `listen for a 65-deep body schema rejected with code ${bodyError instanceof BootError ? bodyError.code : 'none'}`,
);

const responseServer = createServer();
responseServer.routes(
  defineContract({
    deep: { method: 'GET', path: '/deep', responses: { 200: nestedObjects(allowed + 1) } },
  }),
  {
    deep: () => {
      throw new Error('the handler of a route that failed to boot must not run');
    },
  },
);
const responseError = await rejection(() => responseServer.listen({ port: 0, host: '127.0.0.1' }));
await responseServer.close();
check(
  problems,
  responseError instanceof BootError,
  `listen for a 65-deep response schema ended with ${String(responseError)}`,
);
check(
  problems,
  responseError instanceof BootError && responseError.code === 'NESTED_TOO_DEEP',
  `listen for a 65-deep response schema rejected with code ${responseError instanceof BootError ? responseError.code : 'none'}`,
);

conclude(statement, problems);
