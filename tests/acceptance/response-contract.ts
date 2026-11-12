// Does:  Proves that a response which breaks its schema is the fixed 500, and an undeclared key is dropped.
// Holds: The stderr line names the route, the status and the schema location, never the value.

import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { defineContract } from '@darkstart/core/contract';
import { HttpError } from '@darkstart/core/http-error';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';
import { check, conclude } from './support.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'a response is written from its declared properties and any other value is the fixed 500 with a stderr line naming route, status and schema location and no value (AC-41); an HttpError whose details are wrong or throw is the fixed 500, one stderr line, and the server keeps serving (AC-45)';
const fixed500 = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';
const exposeMarker = 'LEAKMARK9';

const user = t.object({
  id: t.integer({ minimum: 0 }),
  name: t.string({ maxLength: 8 }),
  tags: t.optional(t.array(t.string({ maxLength: 4 }), { maxItems: 2 })),
});
const closedA = t.object({ kind: t.literal('a'), x: t.integer({ minimum: 0 }) });
const closedB = t.object({ kind: t.literal('b'), y: t.integer({ minimum: 0 }) });

const contract = defineContract({
  user: {
    method: 'GET',
    path: '/user/:case',
    params: t.object({ case: t.string({ maxLength: 32 }) }),
    responses: { 200: user },
  },
  tally: {
    method: 'GET',
    path: '/tally',
    responses: { 200: t.record(t.string({ maxLength: 8 }), t.integer({ minimum: 0 }), { maxProperties: 8 }) },
  },
  either: {
    method: 'GET',
    path: '/either/:case',
    params: t.object({ case: t.string({ maxLength: 32 }) }),
    responses: { 200: t.union([closedA, closedB]) },
  },
  fail: {
    method: 'GET',
    path: '/fail/:mode',
    params: t.object({ mode: t.string({ maxLength: 32 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  ok: { method: 'GET', path: '/ok', responses: { 200: t.object({ ok: t.boolean() }) } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe returns values the declared types refuse, to see what the wire does
  return value as never;
}

function userValue(name: string): unknown {
  switch (name) {
    case 'good':
      return { id: 1, name: 'ann', passwordHash: 'x' };
    case 'string-id':
      return { id: exposeMarker, name: 'ann' };
    case 'no-name':
      return { id: 1 };
    case 'long-name':
      return { id: 1, name: exposeMarker };
    case 'three-tags':
      return { id: 1, name: 'ann', tags: ['tgA1', 'tgB2', 'tgC3'] };
    case 'negative-id':
      return { id: -1, name: 'ann' };
    case 'fraction-id':
      return { id: 1.5, name: 'ann' };
    case 'nan-id':
      return { id: Number.NaN, name: 'ann' };
    case 'date-name':
      return { id: 1, name: new Date(0) };
    case 'hole-tags':
      return { id: 1, name: 'ann', tags: new Array(2) };
    case 'to-json':
      return { id: 1, name: 'ann', toJSON: () => ({ id: 99, name: 'evil' }) };
    default:
      throw new Error(`unknown case ${name}`);
  }
}

function eitherValue(name: string): unknown {
  switch (name) {
    case 'a':
      return { kind: 'a', x: 1 };
    case 'b':
      return { kind: 'b', y: 2 };
    case 'extra-key':
      return { kind: 'a', x: 1, y: 2 };
    case 'no-member':
      return { kind: 'c', x: 1 };
    default:
      throw new Error(`unknown case ${name}`);
  }
}

async function serve(): Promise<void> {
  const server = createServer();
  server.setErrorHandler((error) => {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message === 'bad-path') {
      return new HttpError(400, 'BAD', 'bad', { details: pastTypes([{ path: 5, message: 'm' }]) });
    }
    if (message === 'throwing-details') {
      const thrown = new HttpError(400, 'BAD', 'bad');
      Object.defineProperty(thrown, 'details', {
        get: () => {
          throw new Error('details getter threw');
        },
      });
      return thrown;
    }
    return new HttpError(null, 'INTERNAL', 'unhandled');
  });
  server.routes(contract, {
    user: (request) => ({ status: 200, body: pastTypes(userValue(request.params.case)) }),
    tally: () => {
      const inherited = { inherited: 7 };
      const value = Object.create(inherited);
      value.a = 1;
      value.b = 2;
      return { status: 200, body: value };
    },
    either: (request) => ({ status: 200, body: pastTypes(eitherValue(request.params.case)) }),
    fail: (request) => {
      throw new Error(request.params.mode);
    },
    ok: () => ({ status: 200, body: { ok: true } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

interface Seen {
  readonly status: number;
  readonly body: string;
}

type Child = Awaited<ReturnType<typeof startServerChild>>;

async function get(child: Child, path: string): Promise<Seen> {
  try {
    const response = await fetch(`http://127.0.0.1:${child.port}${path}`, { headers: { connection: 'close' } });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: `no answer: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function linesFor(stderr: string, route: string, path: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith(`darkstart: GET ${path} `) && line.includes(` ${route}: `));
}

const refusals: readonly (readonly [string, readonly string[]])[] = [
  ['string-id', ['/id']],
  ['no-name', ['/name']],
  ['long-name', ['/name']],
  ['three-tags', ['/tags']],
  ['negative-id', ['/id']],
  ['fraction-id', ['/id']],
  ['nan-id', ['/id']],
  ['date-name', ['/name']],
  ['hole-tags', ['/tags', '/tags/*']],
];

async function failCase(child: Child, mode: string, problems: string[], log: string[]): Promise<void> {
  const offset = child.stderr().length;
  const seen = await get(child, `/fail/${mode}`);
  await delay(60);
  const lines = linesFor(child.stderr().slice(offset), 'fail', '/fail/:mode').filter((line) =>
    /error body does not match/.test(line),
  );
  log.push(`AC-45 ${mode}: ${seen.status} ${seen.body} | ${lines.join(' // ')}`);
  check(problems, seen.status === 500 && seen.body === fixed500, `${mode} answered ${seen.status} ${seen.body}`);
  check(problems, lines.length === 1, `${mode} wrote ${lines.length} stderr lines saying the error body did not match`);
  const next = await get(child, '/ok');
  check(
    problems,
    next.status === 200 && next.body === '{"ok":true}',
    `request after ${mode} answered ${next.status} ${next.body}`,
  );
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const log: string[] = [];
  try {
    const paths = [
      ...refusals.map(([name]) => `/user/${name}`),
      '/user/good',
      '/user/to-json',
      '/tally',
      '/either/a',
      '/either/b',
      '/either/extra-key',
      '/either/no-member',
    ];
    const answers = new Map<string, Seen>();
    const stderrByPath = new Map<string, string>();
    for (const path of paths) {
      const offset = child.stderr().length;
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time attributes template-only stderr to its case
      answers.set(path, await get(child, path));
      await delay(60);
      stderrByPath.set(path, child.stderr().slice(offset));
    }
    const answer = (path: string): Seen => answers.get(path) ?? { status: 0, body: 'no answer' };

    const good = answer('/user/good');
    log.push(`good: ${good.status} ${good.body}`);
    check(
      problems,
      good.status === 200 && good.body === '{"id":1,"name":"ann"}',
      `good answered ${good.status} ${good.body}`,
    );

    for (const [name, locations] of refusals) {
      const seen = answer(`/user/${name}`);
      const lines = linesFor(stderrByPath.get(`/user/${name}`) ?? '', 'user', '/user/:case');
      const line = lines[0] ?? '';
      log.push(`${name}: ${seen.status} ${seen.body} | ${lines.join(' // ')}`);
      check(problems, seen.status === 500 && seen.body === fixed500, `${name} answered ${seen.status} ${seen.body}`);
      check(problems, lines.length === 1, `${name} wrote ${lines.length} stderr lines`);
      check(problems, line.includes(' 500 user: '), `${name} stderr does not name 500 and the route user: ${line}`);
      check(
        problems,
        locations.some((location) => line.endsWith(` at ${location}`)),
        `${name} stderr does not end with a location of ${locations.join(' or ')}: ${line}`,
      );
      const leaked = [exposeMarker, 'tgA1', 'NaN', '1970'].filter(
        (value) => line.includes(value) || seen.body.includes(value),
      );
      check(
        problems,
        leaked.length === 0,
        `${name} stderr or body holds a returned value ${leaked.join(',')}: ${line}`,
      );
    }

    const toJson = answer('/user/to-json');
    log.push(`to-json: ${toJson.status} ${toJson.body}`);
    check(
      problems,
      toJson.status === 200 && toJson.body === '{"id":1,"name":"ann"}',
      `toJSON object answered ${toJson.status} ${toJson.body}`,
    );

    const tally = answer('/tally');
    log.push(`record: ${tally.status} ${tally.body}`);
    check(
      problems,
      tally.status === 200 && tally.body === '{"a":1,"b":2}',
      `record answered ${tally.status} ${tally.body}`,
    );

    for (const [name, expectedBody] of [
      ['a', '{"kind":"a","x":1}'],
      ['b', '{"kind":"b","y":2}'],
    ] as const) {
      const seen = answer(`/either/${name}`);
      log.push(`union ${name}: ${seen.status} ${seen.body}`);
      check(
        problems,
        seen.status === 200 && seen.body === expectedBody,
        `union ${name} answered ${seen.status} ${seen.body}`,
      );
    }
    for (const name of ['extra-key', 'no-member']) {
      const seen = answer(`/either/${name}`);
      log.push(
        `union ${name}: ${seen.status} ${seen.body} | ${linesFor(stderrByPath.get(`/either/${name}`) ?? '', 'either', '/either/:case').join(' // ')}`,
      );
      check(
        problems,
        seen.status === 500 && seen.body === fixed500,
        `union ${name} answered ${seen.status} ${seen.body}`,
      );
    }

    await failCase(child, 'bad-path', problems, log);
    await failCase(child, 'throwing-details', problems, log);
    const everything = child.stderr();
    check(
      problems,
      !/uncaught/i.test(everything) && !/\n\s+at /.test(everything),
      `stderr holds an uncaught exception or stack: ${everything}`,
    );
    log.push(`full stderr:\n${everything}`);
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
