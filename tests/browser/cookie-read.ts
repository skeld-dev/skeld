// Does:  Proves rawCookies gives one frozen set of raw cookie values in the handler, and that no value is logged.
// Holds: A cookie value planted in a request is read back exactly and is in no stderr or stdout line.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer, type RawCookies } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';
import { parseRecords } from '../support/support-log.ts';
import { startServerChild } from '../support/support-typesystem.ts';

const statement =
  'rawCookies returns the values sent; a name sent twice, also across two Cookie header lines, gives undefined from get and every value in order from getAll; __proto__ and constructor are plain entries; values are exactly as sent; the object and its arrays cannot be modified; no cookie value appears in stderr or stdout';

const names = [
  'a',
  'b',
  'c',
  'dup',
  'x',
  '__proto__',
  'constructor',
  'empty',
  'enc',
  'q',
  'sid',
  'missing',
  'toString',
  'hasOwnProperty',
];

const contract = defineContract({
  read: { method: 'GET', path: '/read', responses: { 200: t.object({ report: t.string({ maxLength: 8000 }) }) } },
  boom: { method: 'GET', path: '/boom', responses: { 200: t.object({ ok: t.boolean() }) } },
});

function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return `threw ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

function describe(cookies: RawCookies): string {
  const entries = names.map((name) => [name, cookies.get(name) ?? null, cookies.getAll(name)]);
  const many = cookies.getAll('dup');
  const none = cookies.getAll('missing');
  const tamper = {
    frozen: Object.isFrozen(cookies),
    redefine: attempt(() => Reflect.set(cookies, 'get', () => 'tampered')),
    add: attempt(() => Reflect.defineProperty(cookies, 'evil', { value: 1 })),
    arrayFrozen: Object.isFrozen(many) && Object.isFrozen(none),
    arraySet: attempt(() => Reflect.set(many, 0, 'tampered')),
    arrayPush: attempt(() => Reflect.apply(Array.prototype.push, many, ['tampered'])),
    emptyPush: attempt(() => Reflect.apply(Array.prototype.push, none, ['tampered'])),
  };
  return JSON.stringify({ entries, tamper });
}

async function serve(): Promise<void> {
  const server = createServer();
  server.routes(contract, {
    read: (request) => ({ status: 200, body: { report: describe(request.rawCookies) } }),
    boom: (request) => {
      request.rawCookies.get('sid');
      throw new Error('boom');
    },
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => {
    void server.close().then(() => process.exit(0));
  });
  process.stdout.write(`listening ${port}\n`);
}

function get(path: string, lines: readonly string[]): string {
  return `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${lines.map((line) => `${line}\r\n`).join('')}\r\n`;
}

type Entry = readonly [name: string, value: string | null, all: readonly string[]];
type Expectation = ReadonlyMap<string, Entry>;

function expectation(entries: readonly Entry[]): Expectation {
  const wanted = new Map<string, Entry>(names.map((name) => [name, [name, null, []]]));
  for (const entry of entries) {
    wanted.set(entry[0], entry);
  }
  return wanted;
}

interface Case {
  label: string;
  cookieLines: readonly string[];
  expect: Expectation;
}

const mark = randomBytes(8).toString('hex');
const cases: Case[] = [
  {
    label: 'one Cookie line',
    cookieLines: [
      `Cookie: a=1; b=2; dup=x; dup=y; __proto__=p; constructor=c; empty=; enc=%41%20; q="quoted"; sid=${mark}`,
    ],
    expect: expectation([
      ['a', '1', ['1']],
      ['b', '2', ['2']],
      ['dup', null, ['x', 'y']],
      ['__proto__', 'p', ['p']],
      ['constructor', 'c', ['c']],
      ['empty', '', ['']],
      ['enc', '%41%20', ['%41%20']],
      ['q', '"quoted"', ['"quoted"']],
      ['sid', mark, [mark]],
    ]),
  },
  {
    label: 'two Cookie lines',
    cookieLines: ['Cookie: a=1; b=2', 'Cookie: c=3; a=9', `Cookie: sid=${mark}`],
    expect: expectation([
      ['a', null, ['1', '9']],
      ['b', '2', ['2']],
      ['c', '3', ['3']],
      ['sid', mark, [mark]],
    ]),
  },
  {
    label: 'a name three times',
    cookieLines: ['Cookie: x=1; x=2; x=3'],
    expect: expectation([['x', null, ['1', '2', '3']]]),
  },
  { label: 'no Cookie header', cookieLines: [], expect: expectation([]) },
];

function expectedReport(expect: Expectation): unknown {
  return names.map((name) => [name, expect.get(name)?.[1] ?? null, expect.get(name)?.[2] ?? []]);
}

interface Snapshot {
  entries: unknown;
  tamper: Record<string, unknown>;
}

function parseSnapshot(text: string | undefined): Snapshot | null {
  if (text === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed) || !('tamper' in parsed)) {
    return null;
  }
  const tamper = parsed.tamper;
  return typeof tamper === 'object' && tamper !== null ? { entries: parsed.entries, tamper: { ...tamper } } : null;
}

const refusedTamper = {
  frozen: true,
  redefine: 'false',
  add: 'false',
  arrayFrozen: true,
  arraySet: 'false',
  arrayPush: 'threw TypeError',
  emptyPush: 'threw TypeError',
};

function bodyReport(body: string): string {
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' && parsed !== null && 'report' in parsed && typeof parsed.report === 'string'
    ? parsed.report
    : '';
}

async function values(problems: string[], port: number): Promise<void> {
  for (const item of cases) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's report apart.
    const response = await rawExchange(port, get('/read', item.cookieLines));
    check(problems, response.status === 200, `${item.label}: /read answered ${response.status}`);
    const records = parseSnapshot(bodyReport(response.body));
    check(problems, records !== null, `${item.label}: the handler's report is unreadable`);
    const wanted = JSON.stringify(expectedReport(item.expect));
    check(
      problems,
      JSON.stringify(records?.entries) === wanted,
      `${item.label}: handler read ${JSON.stringify(records?.entries)}, expected ${wanted}`,
    );
    check(
      problems,
      JSON.stringify(records?.tamper) === JSON.stringify(refusedTamper),
      `${item.label}: handler tamper result ${JSON.stringify(records?.tamper)}`,
    );
  }
}

async function leakSearch(problems: string[], child: Awaited<ReturnType<typeof startServerChild>>): Promise<void> {
  const leakHeader = `Cookie: sid=${mark}; a=${mark}`;
  await rawExchange(child.port, get('/read', [leakHeader]));
  const boom = await rawExchange(child.port, get('/boom', [leakHeader]));
  check(problems, boom.status === 500, `/boom answered ${boom.status}`);
  await delay(50);
  check(
    problems,
    parseRecords(child.stdout()).some(
      (record) =>
        record?.event_name === 'skeld.request.error' &&
        record['skeld.reason'] === 'thrown' &&
        record['http.route'] === '/boom' &&
        record['http.response.status_code'] === 500,
    ),
    'stdout held no skeld.request.error record for the 500, so its cookie check proves nothing',
  );
  check(problems, !child.stderr().includes(mark), 'a cookie value appears in stderr');
  check(problems, !child.stdout().includes(mark), 'a cookie value appears in stdout');
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  try {
    await values(problems, child.port);
    await leakSearch(problems, child);
  } finally {
    await child.stop();
  }
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
