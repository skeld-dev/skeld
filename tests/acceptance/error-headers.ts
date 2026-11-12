// Does:  Proves an engine-written error carries no author header and, under a CORS policy, only the engine's grant.
// Holds: Checked on 400, 413 and 500 responses the engine writes, over raw sockets.

import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, parseRaw, rawExchange, type RawResponse } from './support.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'an engine-written 400, 413 and 500 under a CORS policy carry exactly the engine access-control-allow-origin and vary Origin and no set-cookie, cache-control or custom header and no name outside the kept names (x-request-id among them), with a current date; the 200, a declared 404 and a context.send 401 carry every header set for them';
const origin = 'https://app.example';
const hookDate = 'Thu, 01 Jan 1970 00:00:00 GMT';
const keptNames = new Set([
  'x-request-id',
  'content-type',
  'content-length',
  'date',
  'connection',
  'keep-alive',
  'x-content-type-options',
  'content-security-policy',
  'x-frame-options',
  'cache-control',
]);
const engineGrant = new Map([
  ['access-control-allow-origin', origin],
  ['vary', 'Origin'],
]);
const dateSlackMs = 10_000;

const note = t.object({ ok: t.boolean() });
const contract = defineContract({
  val: {
    method: 'GET',
    path: '/val',
    query: t.object({ n: t.integer({ minimum: 0 }) }),
    responses: { 200: note },
  },
  big: {
    method: 'POST',
    path: '/big',
    body: t.object({ text: t.string({ maxLength: 4000 }) }),
    responses: { 200: note },
  },
  boom: { method: 'GET', path: '/boom', responses: { 200: note } },
  fine: { method: 'GET', path: '/fine', responses: { 200: note } },
  gone: {
    method: 'GET',
    path: '/gone',
    responses: { 200: note, 404: t.object({ reason: t.string({ maxLength: 16 }) }) },
  },
  guarded: { method: 'GET', path: '/guarded', responses: { 200: note } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe returns a body the declared type refuses, to see the engine's 500
  return value as never;
}

async function serve(): Promise<void> {
  const server = createServer({ cors: { origins: [origin] } });
  server.addHook('onRequest', (context) => {
    context.setCookie({ name: 'hook', value: '1' });
    context.setHeader('cache-control', 'public, max-age=600');
    context.setHeader('x-canary', 'hook');
    context.setHeader('date', hookDate);
    if (context.route.name === 'guarded') {
      context.send({ status: 401, headers: { 'x-sent': 'by-hook' }, payload: '{"status":401}' });
    }
  });
  server.routes(
    contract,
    {
      val: () => ({ status: 200, body: { ok: true } }),
      big: () => ({ status: 200, body: { ok: true } }),
      boom: () => ({
        status: 200,
        body: pastTypes({ ok: 'not a boolean' }),
        headers: { 'x-second': 'handler' },
        cookies: [{ name: 'handler', value: '1' }],
      }),
      fine: () => ({ status: 200, body: { ok: true }, headers: { 'x-handler': 'fine' } }),
      gone: () => ({ status: 404, body: { reason: 'gone' }, headers: { 'x-handler': 'gone' } }),
      guarded: () => ({ status: 200, body: { ok: true } }),
    },
    { bodyLimits: { big: 64 } },
  );
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

function describe(response: RawResponse): string {
  return `${response.status} ${[...response.headers].map(([name, value]) => `${name}: ${value}`).join(' | ')} || body ${response.body}`;
}

function checkEngineError(problems: string[], label: string, response: RawResponse, status: number): void {
  check(problems, response.status === status, `${label} answered ${response.status}, not ${status}`);
  for (const [name, value] of engineGrant) {
    check(
      problems,
      response.headers.get(name) === value,
      `${label} ${name} was ${response.headers.get(name)}, not ${value}`,
    );
  }
  const stray = [...response.headers.keys()].filter((name) => !engineGrant.has(name) && !keptNames.has(name));
  check(problems, stray.length === 0, `${label} carries names outside the kept names: ${stray.join(', ')}`);
  const date = Date.parse(response.headers.get('date') ?? '');
  check(
    problems,
    Number.isFinite(date) && Math.abs(Date.now() - date) < dateSlackMs,
    `${label} date was ${response.headers.get('date')}`,
  );
}

function checkKept(
  problems: string[],
  label: string,
  response: RawResponse,
  status: number,
  extra: ReadonlyMap<string, string>,
): void {
  check(problems, response.status === status, `${label} answered ${response.status}, not ${status}`);
  const expected = new Map<string, string>([
    ['access-control-allow-origin', origin],
    ['vary', 'Origin'],
    ['set-cookie', 'hook=1; Path=/; HttpOnly; Secure; SameSite=Lax'],
    ['cache-control', 'public, max-age=600'],
    ['x-canary', 'hook'],
    ['date', hookDate],
    ...extra,
  ]);
  for (const [name, value] of expected) {
    check(
      problems,
      response.headers.get(name) === value,
      `${label} ${name} was ${response.headers.get(name)}, not ${value}`,
    );
  }
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const log: string[] = [];
  const { port } = child;
  const get = (path: string, method = 'GET') =>
    rawExchange(port, `${method} ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\norigin: ${origin}\r\n\r\n`);
  try {
    const bigBody = JSON.stringify({ text: 'x'.repeat(1000) });
    const [bad, big, boom, fine, gone, guarded, head] = await Promise.all([
      get('/val'),
      rawExchange(
        port,
        `POST /big HTTP/1.1\r\nhost: x\r\nconnection: close\r\norigin: ${origin}\r\nsec-fetch-site: same-origin\r\ncontent-type: application/json\r\ncontent-length: ${bigBody.length}\r\n\r\n${bigBody}`,
      ),
      get('/boom'),
      get('/fine'),
      get('/gone'),
      get('/guarded'),
      get('/val', 'HEAD'),
    ]);
    const rows: readonly (readonly [string, RawResponse])[] = [
      ['400 validation', bad],
      ['413 body over limit', big],
      ['500 serializer refusal', boom],
      ['200', fine],
      ['404 declared', gone],
      ['401 context.send', guarded],
      ['HEAD engine-written error', head],
    ];
    for (const [label, response] of rows) {
      log.push(`${label}: ${describe(response)}`);
    }
    checkEngineError(problems, '400', bad, 400);
    checkEngineError(problems, '413', big, 413);
    checkEngineError(problems, '500', boom, 500);
    check(
      problems,
      boom.body === '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}',
      `500 body was ${boom.body}`,
    );
    checkKept(problems, '200', fine, 200, new Map([['x-handler', 'fine']]));
    checkKept(problems, 'declared 404', gone, 404, new Map([['x-handler', 'gone']]));
    checkKept(problems, 'context.send 401', guarded, 401, new Map([['x-sent', 'by-hook']]));
    checkEngineError(problems, 'HEAD error', head, 400);
    check(problems, head.body === '', `HEAD error carried a body: ${head.body}`);
    check(
      problems,
      parseRaw(head.raw).headers.get('content-length') !== undefined,
      'HEAD error carries no content-length',
    );
  } finally {
    await child.stop();
  }
  process.stdout.write(`${log.join('\n')}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
