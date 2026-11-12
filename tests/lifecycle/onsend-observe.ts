// Does:  Proves that an onSend hook cannot change the wire payload and that a hook returning a string will not compile.
// Holds: The wire bytes are compared with the contract's own serialization, for a sync and an async hook that both ran.

import { compileProbes, rejectsAt } from '../support/support-compile.ts';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';

const statement =
  'an onSend hook that returns a different string, sync or async, leaves the bytes on the wire exactly the serialized contract body, and a hook declared to return a string does not compile';
const replacement = '{"id":999,"name":"REPLACED"}';
const expectedBody = JSON.stringify({ id: 7, name: 'ann' });

const contract = defineContract({
  item: {
    method: 'GET',
    path: '/item',
    responses: { 200: t.object({ id: t.integer({ minimum: 0 }), name: t.string({ maxLength: 16 }) }) },
  },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe forces a hook the declared type refuses, to see what the wire does
  return value as never;
}

async function wireBody(hook: () => unknown): Promise<{ body: string; length: string | undefined; ran: number }> {
  let ran = 0;
  const server = createServer();
  server.routes(contract, { item: () => ({ status: 200, body: { id: 7, name: 'ann' } }) });
  server.addHook(
    'onSend',
    pastTypes(() => {
      ran++;
      return hook();
    }),
  );
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    const response = await rawExchange(port, 'GET /item HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    return { body: response.body, length: response.headers.get('content-length'), ran };
  } finally {
    await server.close();
  }
}

const header = "import { createServer } from '@skeld/core/server';\nconst server = createServer();\n";
const probes = {
  voidHook: `${header}server.addHook('onSend', () => undefined);\n`,
  asyncVoidHook: `${header}server.addHook('onSend', async () => undefined);\n`,
  stringHook: `${header}server.addHook('onSend', () => 'replaced'); // BAD\n`,
  asyncStringHook: `${header}server.addHook('onSend', async () => 'replaced'); // BAD\n`,
};

const problems: string[] = [];

const syncHook = await wireBody(() => replacement);
check(problems, syncHook.ran === 1, `the sync onSend hook ran ${syncHook.ran} times`);
check(problems, syncHook.body === expectedBody, `sync hook: wire body was ${syncHook.body}, expected ${expectedBody}`);
check(
  problems,
  syncHook.length === String(Buffer.byteLength(expectedBody)),
  `sync hook: content-length was ${syncHook.length}, expected ${Buffer.byteLength(expectedBody)}`,
);

const asyncHook = await wireBody(async () => replacement);
check(problems, asyncHook.ran === 1, `the async onSend hook ran ${asyncHook.ran} times`);
check(
  problems,
  asyncHook.body === expectedBody,
  `async hook: wire body was ${asyncHook.body}, expected ${expectedBody}`,
);
check(
  problems,
  asyncHook.length === String(Buffer.byteLength(expectedBody)),
  `async hook: content-length was ${asyncHook.length}, expected ${Buffer.byteLength(expectedBody)}`,
);

const results = compileProbes(Object.values(probes));
for (const [index, [name, source]] of Object.entries(probes).entries()) {
  const result = results[index];
  const expected =
    name === 'voidHook' || name === 'asyncVoidHook' ? result?.status === 0 : rejectsAt(result, source, 2769);
  check(problems, expected, `${name}: unexpected compiler result ${result?.status}: ${result?.errors.join(' | ')}`);
}

conclude(statement, problems);
