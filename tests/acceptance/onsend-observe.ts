// Does:  Proves that an onSend hook cannot change the wire payload and that a hook returning a string will not compile.
// Holds: The wire bytes are compared with the contract's own serialization, for a sync and an async hook that both ran.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, rawExchange } from './support.ts';

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

const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
const repoModules = fileURLToPath(new URL('../../node_modules', import.meta.url));

function compile(folder: string, source: string): { status: number | null; output: string } {
  writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
  writeFileSync(join(folder, 'probe.ts'), source);
  writeFileSync(
    join(folder, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2025',
        module: 'nodenext',
        lib: ['es2025'],
        types: ['node'],
        strict: true,
        noEmit: true,
        customConditions: ['skeld-source'],
        allowImportingTsExtensions: true,
      },
      files: ['probe.ts'],
    }),
  );
  const result = spawnSync(process.execPath, [tsc, '-p', folder], { encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const header = "import { createServer } from '@skeld/core/server';\nconst server = createServer();\n";
const probes = {
  voidHook: `${header}server.addHook('onSend', () => undefined);\n`,
  asyncVoidHook: `${header}server.addHook('onSend', async () => undefined);\n`,
  stringHook: `${header}server.addHook('onSend', () => 'replaced');\n`,
  asyncStringHook: `${header}server.addHook('onSend', async () => 'replaced');\n`,
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

const scratch = mkdtempSync(join(tmpdir(), 'skeld-onsend-'));
try {
  symlinkSync(repoModules, join(scratch, 'node_modules'));
  for (const [name, source] of Object.entries(probes)) {
    const outcome = compile(scratch, source);
    const refused = outcome.output.split('\n').filter((line) => line.includes('probe.ts('));
    if (name === 'voidHook' || name === 'asyncVoidHook') {
      check(
        problems,
        outcome.status === 0,
        `${name} must compile (control), tsc exit ${outcome.status}: ${outcome.output}`,
      );
    } else {
      check(problems, outcome.status === 2 || outcome.status === 1, `${name} compiled (tsc exit ${outcome.status})`);
      check(problems, refused.length > 0, `${name}: the compiler reported no error on probe.ts: ${outcome.output}`);
    }
  }
} finally {
  unlinkSync(join(scratch, 'node_modules'));
  rmSync(scratch, { recursive: true });
}

conclude(statement, problems);
