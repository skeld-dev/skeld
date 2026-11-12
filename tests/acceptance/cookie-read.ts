// Does:  Proves rawCookies gives one frozen set of raw cookie values in the handler and each hook, parsed only on read.
// Holds: A cookie value planted in a request is read back exactly and is in no stderr or stdout line or diag file.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer, type RawCookies } from '@skeld/core/server';
import { check, conclude, rawExchange } from './support.ts';
import { startDiagChild } from './support-diag.ts';
import { parseRecords } from './support-log.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'rawCookies returns the same values in the handler and in the onRequest, preHandler, onSend and onError hooks; a name sent twice, also across two Cookie header lines, gives undefined from get and every value in order from getAll; __proto__ and constructor are plain entries; values are exactly as sent; the object and its arrays cannot be modified; a request that never reads cookies parses nothing and one that reads in the handler and three hooks parses once; no cookie value appears in stderr, stdout or a diag file';

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
const stages = ['onRequest', 'preHandler', 'onSend', 'handler'] as const;

const failing = defineContract({
  fail: { method: 'GET', path: '/fail', responses: { 200: t.object({ ok: t.boolean() }) } },
});
const contract = defineContract({
  read: { method: 'GET', path: '/read', responses: { 200: t.object({ report: t.string({ maxLength: 8000 }) }) } },
  plain: { method: 'GET', path: '/plain', responses: { 200: t.object({ ok: t.boolean() }) } },
  boom: { method: 'GET', path: '/boom', responses: { 200: t.object({ ok: t.boolean() }) } },
  seen: {
    method: 'GET',
    path: '/seen',
    query: t.object({ id: t.string({ maxLength: 32 }) }),
    responses: { 200: t.object({ report: t.string({ maxLength: 20_000 }) }) },
  },
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

function idOf(headers: Record<string, string | readonly string[] | undefined>): string | null {
  const id = headers['x-id'];
  return typeof id === 'string' && headers['x-read'] === '1' ? id : null;
}

async function serve(): Promise<void> {
  const seen = new Map<string, Record<string, string>>();
  const note = (id: string | null, stage: string, cookies: () => RawCookies): void => {
    if (id !== null) {
      seen.set(id, { ...seen.get(id), [stage]: describe(cookies()) });
    }
  };
  const server = createServer();
  server.addHook('onRequest', (context) => {
    note(idOf(context.headers), 'onRequest', () => context.rawCookies);
  });
  server.addHook('preHandler', (context) => {
    note(idOf(context.headers), 'preHandler', () => context.rawCookies);
  });
  server.addHook('onSend', (context) => {
    note(idOf(context.headers), 'onSend', () => context.rawCookies);
  });
  server.routes(contract, {
    read: (request) => {
      note(idOf(request.headers), 'handler', () => request.rawCookies);
      return { status: 200, body: { report: describe(request.rawCookies) } };
    },
    plain: () => ({ status: 200, body: { ok: true } }),
    boom: (request) => {
      note(idOf(request.headers), 'handler', () => request.rawCookies);
      request.rawCookies.get('sid');
      throw new Error('boom');
    },
    seen: ({ query }) => ({ status: 200, body: { report: JSON.stringify(seen.get(query.id) ?? {}) } }),
  });
  server.register((scope) => {
    scope.addHook('onError', (context) => {
      note(idOf(context.headers), 'onError', () => context.rawCookies);
    });
    scope.routes(failing, {
      fail: (request) => {
        note(idOf(request.headers), 'handler', () => request.rawCookies);
        throw new Error('fail');
      },
    });
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

async function values(problems: string[], port: number): Promise<number> {
  let compared = 0;
  for (const [index, item] of cases.entries()) {
    const id = `case${index}`;
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's hook record apart.
    const response = await rawExchange(port, get('/read', [...item.cookieLines, `x-id: ${id}`, 'x-read: 1']));
    check(problems, response.status === 200, `${item.label}: /read answered ${response.status}`);
    const records = parseSnapshot(bodyReport(response.body));
    const seenResponse = await rawExchange(port, get(`/seen?id=${id}`, []));
    const hookText: unknown = JSON.parse(bodyReport(seenResponse.body) || '{}');
    const hooks = typeof hookText === 'object' && hookText !== null ? { ...hookText } : {};
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
    for (const stage of stages) {
      if (stage === 'handler') {
        continue;
      }
      const parsed = parseSnapshot(Reflect.get(hooks, stage));
      compared++;
      check(
        problems,
        JSON.stringify(parsed?.entries) === wanted,
        `${item.label}: ${stage} read ${JSON.stringify(parsed?.entries)}, expected the handler's ${wanted}`,
      );
      check(
        problems,
        JSON.stringify(parsed?.tamper) === JSON.stringify(refusedTamper),
        `${item.label}: ${stage} tamper result ${JSON.stringify(parsed?.tamper)}`,
      );
    }
  }
  const failed = await rawExchange(port, get('/fail', ['Cookie: a=1; dup=x; dup=y', 'x-id: err', 'x-read: 1']));
  check(problems, failed.status === 500, `/fail answered ${failed.status}`);
  await delay(50);
  const errSeen = await rawExchange(port, get('/seen?id=err', []));
  const errRecord: unknown = JSON.parse(bodyReport(errSeen.body) || '{}');
  const onError = parseSnapshot(
    typeof errRecord === 'object' && errRecord !== null ? Reflect.get(errRecord, 'onError') : undefined,
  );
  const viaHandler = parseSnapshot(
    typeof errRecord === 'object' && errRecord !== null ? Reflect.get(errRecord, 'handler') : undefined,
  );
  compared++;
  check(problems, onError !== null, 'the onError hook recorded nothing');
  check(
    problems,
    JSON.stringify(onError?.entries) === JSON.stringify(viaHandler?.entries) &&
      JSON.stringify(onError?.entries)?.includes('["a","1",["1"]]') === true &&
      JSON.stringify(onError?.entries)?.includes('["dup",null,["x","y"]]') === true,
    `onError read ${JSON.stringify(onError?.entries)}`,
  );
  return compared;
}

interface Spans {
  n: number;
}

function parseSpans(snapshotText: string): number {
  const last = snapshotText.trim().split('\n').at(-1) ?? '{}';
  const parsed: unknown = JSON.parse(last);
  const spans = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'spans') : undefined;
  const entry: unknown =
    typeof spans === 'object' && spans !== null ? Reflect.get(spans, 'req.cookies.parse') : undefined;
  const counted: Spans | null =
    typeof entry === 'object' && entry !== null && 'n' in entry && typeof entry.n === 'number' ? { n: entry.n } : null;
  return counted === null ? 0 : counted.n;
}

async function parseCounts(problems: string[]): Promise<{ quiet: number; reading: number }> {
  const leakHeader = `Cookie: sid=${mark}; a=${mark}`;
  const idle = await startDiagChild(fileURLToPath(import.meta.url));
  let plainOk = 0;
  for (let n = 0; n < 12; n++) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep the span count attributable.
    const response = await rawExchange(idle.port, get('/plain', [leakHeader]));
    plainOk += response.status === 200 ? 1 : 0;
  }
  const idleFiles = await idle.stopAndRead();
  check(problems, plainOk === 12, `${plainOk} of 12 plain requests answered 200`);

  const busy = await startDiagChild(fileURLToPath(import.meta.url));
  for (let n = 0; n < 3; n++) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep the span count attributable.
    await rawExchange(busy.port, get('/read', [leakHeader, `x-id: d${n}`, 'x-read: 1']));
  }
  await rawExchange(busy.port, get('/read', ['x-id: nocookie', 'x-read: 1']));
  const boom = await rawExchange(busy.port, get('/boom', [leakHeader, 'x-id: dboom', 'x-read: 1']));
  check(problems, boom.status === 500, `/boom answered ${boom.status} under diag`);
  await delay(50);
  const busyFiles = await busy.stopAndRead();
  const stderr = busy.stderr();
  check(
    problems,
    parseRecords(busy.stdout()).some(
      (record) =>
        record?.event_name === 'skeld.request.error' &&
        record['skeld.reason'] === 'thrown' &&
        record['http.route'] === '/boom' &&
        record['http.response.status_code'] === 500,
    ),
    'stdout held no skeld.request.error record for the 500, so its cookie check proves nothing',
  );
  check(problems, !stderr.includes(mark), 'a cookie value appears in stderr');
  check(problems, !busy.stdout().includes(mark), 'a cookie value appears in stdout');
  check(problems, !idle.stderr().includes(mark), 'a cookie value appears in the idle child stderr');
  check(problems, !idle.stdout().includes(mark), 'a cookie value appears in the idle child stdout');
  check(problems, !busyFiles.text.includes(mark), 'a cookie value appears in a diag file');
  check(problems, !idleFiles.text.includes(mark), 'a cookie value appears in the idle child diag files');
  return { quiet: parseSpans(idleFiles.snapshot), reading: parseSpans(busyFiles.snapshot) };
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  let compared = 0;
  try {
    compared = await values(problems, child.port);
  } finally {
    await child.stop();
  }
  const counts = await parseCounts(problems);
  check(problems, counts.quiet === 0, `${counts.quiet} cookie parses for 12 requests that never read cookies`);
  check(
    problems,
    counts.reading === 4,
    `${counts.reading} cookie parses for 4 requests that read in five places, and one with no Cookie header`,
  );
  process.stderr.write(`${JSON.stringify({ compared, ...counts })}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
