// Does:  Proves every row of docs/logging/events.md: each event is triggered with no options and gives its record.
// Holds: Rows come from the page; a reason with no trigger fails unless its row says no request produces it.

// biome-ignore-all lint/security/noSecrets: route templates, event names and header values, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each trigger is sent alone so its request id stays its own
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer, type RequestContext, type Server } from '@skeld/core/server';
import { announceListening, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';
import { type RawResponse, rawExchange } from '../support/support.ts';

interface Row {
  event: string;
  category: string;
  severity: string;
  when: string;
  keys: string[];
  reasons: string[];
}

const eventsPath = fileURLToPath(new URL('../../docs/logging/events.md', import.meta.url));
const optionalKeys = new Set(['skeld.schema_location', 'http.route']);

function cellsOf(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function tokensOf(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}

function sectionRows(text: string, heading: string): string[][] {
  const section = text.split(`## ${heading}`)[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map(cellsOf);
}

function readRows(): Row[] {
  const text = readFileSync(eventsPath, 'utf8');
  const reasonRows = sectionRows(text, 'Reasons');
  return sectionRows(text, 'Event table').map((cells) => {
    const [event = '', category = '', severity = '', when = '', own = ''] = cells;
    const name = event.replaceAll('`', '');
    const tokens = tokensOf(own).filter((token) => token !== name);
    const sameAs = /same counts as `([^`]+)`/.exec(own)?.[1];
    const fromTable = reasonRows
      .filter((row) => row[0]?.replaceAll('`', '') === name)
      .map((row) => (row[1] ?? '').replaceAll('`', ''));
    const named = own.includes('`skeld.reason`')
      ? tokens.filter((token) => !token.includes('.') && token !== 'message' && token !== 'fields')
      : [];
    const reasons = [...new Set([...named, ...fromTable])];
    return {
      event: name,
      category: category.replaceAll('`', ''),
      severity: severity.replaceAll('`', ''),
      when,
      keys:
        sameAs === undefined
          ? tokens.filter((token) => token.includes('.') || token === 'message' || token === 'fields')
          : [`@${sameAs}`],
      reasons,
    };
  });
}

function resolvedKeys(row: Row, rows: readonly Row[]): string[] {
  const [first] = row.keys;
  if (first?.startsWith('@')) {
    return rows.find((other) => other.event === first.slice(1))?.keys ?? [];
  }
  return row.keys;
}

const ok = t.object({ ok: t.boolean() });
const reportShape = t.object({ report: t.string({ maxLength: 4000 }) });
const noBody = t.object({ a: t.string({ maxLength: 10 }) });
const contract = defineContract({
  ok: { method: 'GET', path: '/ok', responses: { 200: ok } },
  thrown: { method: 'GET', path: '/thrown', responses: { 200: ok } },
  httpError: { method: 'GET', path: '/http-error', responses: { 200: ok } },
  slow: { method: 'GET', path: '/slow', responses: { 200: ok } },
  undeclared: { method: 'GET', path: '/undeclared', responses: { 200: ok } },
  mismatch: { method: 'GET', path: '/mismatch', responses: { 200: ok } },
  reserved: { method: 'GET', path: '/reserved', responses: { 200: ok } },
  cookie: { method: 'GET', path: '/cookie', responses: { 200: ok } },
  redirect: { method: 'GET', path: '/redirect', responses: { 302: null } },
  sendStatus: { method: 'GET', path: '/send-status', responses: { 200: ok } },
  headersSent: { method: 'GET', path: '/headers-sent', responses: { 200: ok } },
  hookOnResponse: { method: 'GET', path: '/hook-on-response', responses: { 200: ok } },
  hookOnError: { method: 'GET', path: '/hook-on-error', responses: { 200: ok } },
  lateSend: { method: 'GET', path: '/late-send', responses: { 200: ok } },
  afterResponse: { method: 'GET', path: '/after-response', responses: { 200: ok } },
  item: {
    method: 'GET',
    path: '/items/:id',
    params: t.object({ id: t.string({ maxLength: 400 }) }),
    responses: { 200: ok },
  },
  body: { method: 'POST', path: '/body', body: noBody, responses: { 200: ok } },
  deep: { method: 'POST', path: '/deep', body: noBody, responses: { 200: ok } },
  logging: { method: 'GET', path: '/log', responses: { 200: ok } },
  ports: { method: 'GET', path: '/second-port', responses: { 200: reportShape } },
  flood: { method: 'GET', path: '/flood', responses: { 200: ok } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the fixtures return and send values the declared types refuse, to see the run-time answer
  return value as never;
}

const goodReply = { status: 200 as const, body: { ok: true } };
const padding = 'p'.repeat(900);

function onRequest(context: RequestContext): void {
  const send: (reply: unknown) => void = pastTypes(context.send);
  switch (context.route.name) {
    case 'sendStatus':
      send({ status: 99, payload: '{}' });
      break;
    case 'headersSent':
      send({ status: 200, payload: new ArrayBuffer(4) });
      break;
    case 'lateSend':
      send({ status: 200, payload: '{"ok":true}' });
      send({ status: 200, payload: '{"ok":true}' });
      break;
    case 'afterResponse':
      send({ status: 200, payload: '{"ok":true}' });
      throw new Error('thrown after the reply');
    default:
  }
}

function serve(): void {
  const options: unknown = JSON.parse(process.env.LOG_OPTIONS ?? '{}');
  const log = typeof options === 'object' && options !== null ? { ...options } : {};
  const first = createServer({ log });
  const second = createServer({
    log,
    publicOrigin: 'https://api.example',
    csrf: { mode: 'strict' },
    cors: { origins: ['https://app.example'] },
  });
  first.addHook('onRequest', onRequest);
  first.addHook('onResponse', (context) => {
    if (context.route.name === 'hookOnResponse') {
      throw new Error('on response');
    }
  });
  first.addHook('onError', (context) => {
    if (context.route.name === 'hookOnError') {
      throw new Error('on error');
    }
  });
  let secondPort = 0;
  first.routes(
    contract,
    {
      ok: () => goodReply,
      thrown: () => {
        throw new Error('thrown');
      },
      httpError: () => {
        throw new HttpError(500, 'BROKEN', 'broken');
      },
      slow: () => new Promise<never>(() => undefined),
      undeclared: () => pastTypes({ status: 201, body: { ok: true } }),
      mismatch: () => pastTypes({ status: 200, body: { ok: 'not a boolean' } }),
      reserved: () => pastTypes({ ...goodReply, headers: { 'x-request-id': 'forged' } }),
      cookie: () => pastTypes({ ...goodReply, cookies: [{ name: 'bad name', value: 'x' }] }),
      redirect: () => pastTypes({ status: 302, headers: { location: '//evil.example/path' } }),
      sendStatus: () => goodReply,
      headersSent: () => goodReply,
      hookOnResponse: () => goodReply,
      hookOnError: () => {
        throw new Error('handler');
      },
      lateSend: () => goodReply,
      afterResponse: () => goodReply,
      item: () => goodReply,
      body: () => goodReply,
      deep: () => goodReply,
      logging: ({ log: requestLog }) => {
        requestLog.debug('below the app threshold', { k: 1 });
        requestLog.info('an info call', { k: 1 });
        requestLog.warn('a warn call', { k: 2 });
        requestLog.error('an error call', { k: 3 });
        return goodReply;
      },
      ports: () => ({ status: 200, body: { report: String(secondPort) } }),
      flood: () => {
        for (let call = 0; call < 1500; call++) {
          first.log.error(padding, { call });
        }
        return goodReply;
      },
    },
    { handlerTimeouts: { slow: 100 }, bodyLimits: { body: 64 } },
  );
  second.routes(contract, {
    ok: () => goodReply,
    thrown: () => goodReply,
    httpError: () => goodReply,
    slow: () => goodReply,
    undeclared: () => goodReply,
    mismatch: () => goodReply,
    reserved: () => goodReply,
    cookie: () => goodReply,
    redirect: () => pastTypes({ status: 302 }),
    sendStatus: () => goodReply,
    headersSent: () => goodReply,
    hookOnResponse: () => goodReply,
    hookOnError: () => goodReply,
    lateSend: () => goodReply,
    afterResponse: () => goodReply,
    item: () => goodReply,
    body: () => goodReply,
    deep: () => goodReply,
    logging: () => goodReply,
    ports: () => ({ status: 200, body: { report: '' } }),
    flood: () => goodReply,
  });
  second
    .listen({ port: 0, host: '127.0.0.1' })
    .then((address) => {
      secondPort = address.port;
      return first.listen({ port: 0, host: '127.0.0.1' });
    })
    .then(({ port }) => {
      process.on('SIGTERM', () => void closeBoth(first, second));
      announceListening(port);
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

async function closeBoth(first: Server, second: Server): Promise<void> {
  await Promise.all([first.close(), second.close()]);
  process.exit(0);
}

interface Spec {
  server: 'first' | 'second';
  method: string;
  path: string;
  headers?: string[];
  body?: string;
  raw?: string;
  times?: number;
}

const severities = ['debug', 'info', 'warn', 'error', 'fatal'];
const defaults: Record<string, string> = { boot: 'info', app: 'info', security: 'warn' };
const deepBody = `{"a":${'['.repeat(70)}${']'.repeat(70)}}`;
const triggers = new Map<string, Spec>([
  ['skeld.request.error|thrown', { server: 'first', method: 'GET', path: '/thrown' }],
  ['skeld.request.error|http_error', { server: 'first', method: 'GET', path: '/http-error' }],
  ['skeld.request.error|timeout', { server: 'first', method: 'GET', path: '/slow' }],
  ['skeld.request.error|undeclared_status', { server: 'first', method: 'GET', path: '/undeclared' }],
  ['skeld.request.error|response_mismatch', { server: 'first', method: 'GET', path: '/mismatch' }],
  ['skeld.request.error|reserved_header', { server: 'first', method: 'GET', path: '/reserved' }],
  ['skeld.request.error|invalid_cookie', { server: 'first', method: 'GET', path: '/cookie' }],
  ['skeld.request.error|redirect_refused', { server: 'first', method: 'GET', path: '/redirect' }],
  ['skeld.request.error|send_status', { server: 'first', method: 'GET', path: '/send-status' }],
  ['skeld.request.error|headers_sent', { server: 'first', method: 'GET', path: '/headers-sent' }],
  ['skeld.hook.error|on_response', { server: 'first', method: 'GET', path: '/hook-on-response' }],
  ['skeld.hook.error|on_error', { server: 'first', method: 'GET', path: '/hook-on-error' }],
  ['skeld.hook.error|late_send', { server: 'first', method: 'GET', path: '/late-send' }],
  ['skeld.hook.error|after_response', { server: 'first', method: 'GET', path: '/after-response' }],
  [
    'skeld.refuse.framing|duplicate-host',
    {
      server: 'first',
      method: 'GET',
      path: '/ok',
      raw: 'GET /ok HTTP/1.1\r\nHost: a\r\nHost: b\r\nConnection: close\r\n\r\n',
    },
  ],
  [
    'skeld.refuse.framing|transfer-encoding',
    {
      server: 'first',
      method: 'POST',
      path: '/body',
      raw: 'POST /body HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: gzip, chunked\r\nConnection: close\r\n\r\n9\r\n{"a":"x"}\r\n0\r\n\r\n',
    },
  ],
  ['skeld.refuse.path', { server: 'first', method: 'GET', path: '/%zz', times: 25 }],
  ['skeld.refuse.param_too_long', { server: 'first', method: 'GET', path: `/items/${'a'.repeat(101)}` }],
  [
    'skeld.refuse.body_limit',
    {
      server: 'first',
      method: 'POST',
      path: '/body',
      headers: ['Content-Type: application/json'],
      body: `{"a":"${'x'.repeat(90)}"}`,
    },
  ],
  [
    'skeld.refuse.body_depth',
    { server: 'first', method: 'POST', path: '/deep', headers: ['Content-Type: application/json'], body: deepBody },
  ],
  [
    'skeld.refuse.forbidden_key',
    {
      server: 'first',
      method: 'POST',
      path: '/body',
      headers: ['Content-Type: application/json'],
      body: '{"__proto__":{}}',
    },
  ],
  [
    'skeld.refuse.validation',
    { server: 'first', method: 'POST', path: '/body', headers: ['Content-Type: application/json'], body: '{"a":1}' },
  ],
  ['skeld.refuse.not_found', { server: 'first', method: 'GET', path: '/nowhere' }],
  ['skeld.refuse.media_type', { server: 'first', method: 'POST', path: '/body', headers: [], body: '{"a":"x"}' }],
  [
    'skeld.refuse.body_json',
    { server: 'first', method: 'POST', path: '/body', headers: ['Content-Type: application/json'], body: '{bad' },
  ],
  [
    'skeld.refuse.csrf|unverifiable',
    { server: 'first', method: 'POST', path: '/body', headers: ['@origin-is-host'], body: '{}', times: 2 },
  ],
  [
    'skeld.refuse.csrf|origin',
    {
      server: 'second',
      method: 'POST',
      path: '/body',
      headers: ['Origin: https://other.example', 'Content-Type: application/json'],
      body: '{}',
    },
  ],
  [
    'skeld.refuse.csrf|fetch-site',
    {
      server: 'second',
      method: 'POST',
      path: '/body',
      headers: ['Sec-Fetch-Site: cross-site', 'Content-Type: application/json'],
      body: '{}',
    },
  ],
  [
    'skeld.refuse.csrf|missing',
    { server: 'second', method: 'POST', path: '/body', headers: ['Content-Type: application/json'], body: '{}' },
  ],
  [
    'skeld.refuse.preflight',
    {
      server: 'second',
      method: 'OPTIONS',
      path: '/body',
      headers: ['Origin: https://evil.example', 'Access-Control-Request-Method: POST'],
    },
  ],
  ['skeld.app.message', { server: 'first', method: 'GET', path: '/log' }],
]);
const notTriggerable = 'no application code or request produces it; it marks a fault in the engine itself';
const stated = new Set(
  sectionRows(readFileSync(eventsPath, 'utf8'), 'Reasons')
    .filter((cells) => (cells[2] ?? '').includes(notTriggerable))
    .map((cells) => `${(cells[0] ?? '').replaceAll('`', '')}|${(cells[1] ?? '').replaceAll('`', '')}`),
);
let statedCount = 0;

function requestText(port: number, spec: Spec): string {
  if (spec.raw !== undefined) {
    return spec.raw;
  }
  const host = `127.0.0.1:${port}`;
  const headers = (spec.headers ?? []).map((line) => (line === '@origin-is-host' ? `Origin: http://${host}` : line));
  const body = spec.body ?? '';
  const lines = [`${spec.method} ${spec.path} HTTP/1.1`, `Host: ${host}`, 'Connection: close', ...headers];
  if (body !== '') {
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n${body}`;
}

interface Sent {
  key: string;
  status: number;
  requestId: string | null;
}

interface Run {
  records: LogObject[];
  sent: Map<string, Sent>;
  stderr: string;
}

async function runMain(options: unknown): Promise<Run> {
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: ['main'],
    env: { LOG_OPTIONS: JSON.stringify(options) },
  });
  const sent = new Map<string, Sent>();
  try {
    const portReply = await fetch(`http://127.0.0.1:${child.port}/second-port`);
    const body: unknown = await portReply.json();
    const secondPort = Number(typeof body === 'object' && body !== null ? Reflect.get(body, 'report') : Number.NaN);
    for (const [key, spec] of triggers) {
      const port = spec.server === 'first' ? child.port : secondPort;
      let last: RawResponse | null = null;
      let firstId: string | null = null;
      for (let attempt = 0; attempt < (spec.times ?? 1); attempt++) {
        last = await rawExchange(port, requestText(port, spec), 3000);
        firstId ??= last.headers.get('x-request-id') ?? null;
      }
      sent.set(key, { key, status: last?.status ?? 0, requestId: firstId });
    }
    await delay(200);
  } finally {
    await child.stop();
  }
  return { records: child.records(), sent, stderr: child.stderr() };
}

function severityNumber(name: string): number {
  return severities.indexOf(name);
}

function statusOf(row: Row): number | null {
  const found = /status (\d{3})/.exec(row.when);
  return found?.[1] === undefined ? null : Number(found[1]);
}

function writtenByDefault(row: Row): boolean {
  if (row.category === 'access') {
    return false;
  }
  if (!(row.category in defaults) || !severities.includes(row.severity)) {
    return true;
  }
  return severityNumber(row.severity) >= severityNumber(defaults[row.category] ?? 'info');
}

function envelopeProblems(row: Row, rows: readonly Row[], rec: LogObject): string[] {
  const problems: string[] = [];
  let { category, severity } = row;
  if (row.event === 'skeld.log.suppressed') {
    const target = rows.find((other) => other.event === rec['skeld.suppressed.event_name']);
    category = target?.category ?? '?';
    severity = target?.severity ?? '?';
  }
  check(
    problems,
    rec['skeld.category'] === category,
    `category ${String(rec['skeld.category'])}, row says ${category}`,
  );
  if (row.event === 'skeld.app.message') {
    check(problems, severities.includes(String(rec.severity_text)), `severity ${String(rec.severity_text)}`);
  } else {
    check(problems, rec.severity_text === severity, `severity ${String(rec.severity_text)}, row says ${severity}`);
  }
  check(
    problems,
    rec.severity_number === [5, 9, 13, 17, 21][severityNumber(String(rec.severity_text))],
    'severity number does not match its text',
  );
  for (const key of resolvedKeys(row, rows)) {
    if (!optionalKeys.has(key)) {
      check(problems, key in rec, `own key ${key} is missing`);
    }
  }
  const status = statusOf(row);
  if (status !== null) {
    check(
      problems,
      rec['http.response.status_code'] === status,
      `status ${String(rec['http.response.status_code'])}, row says ${status}`,
    );
  }
  check(problems, typeof rec.time === 'string' && !Number.isNaN(Date.parse(rec.time)), 'no ISO time');
  return problems;
}

const exceptionKeys = ['skeld.exception.kind'];

function reasonProblems(row: Row, reason: string, rec: LogObject): string[] {
  const problems: string[] = [];
  const reads =
    row.event === 'skeld.request.error'
      ? reason === 'thrown' || reason === 'http_error'
      : row.event === 'skeld.hook.error' && reason !== 'late_send';
  for (const key of exceptionKeys) {
    check(
      problems,
      reads === key in rec,
      `${key} is ${key in rec ? 'present' : 'absent'}, the row says ${reads ? 'present' : 'absent'}`,
    );
  }
  if (reason === 'response_mismatch') {
    check(problems, typeof rec['skeld.schema_location'] === 'string', 'no skeld.schema_location for a body mismatch');
  }
  return problems;
}

function mapOf(records: readonly LogObject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rec of records) {
    const reason = rec['skeld.reason'];
    const key = `${String(rec.event_name)}${typeof reason === 'string' ? `|${reason}` : ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sameMaps(left: Map<string, number>, right: Map<string, number>): string[] {
  const problems: string[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (left.get(key) !== right.get(key)) {
      problems.push(`${key}: ${left.get(key) ?? 0} expected, ${right.get(key) ?? 0} seen`);
    }
  }
  return problems;
}

async function droppedRecords(): Promise<LogObject[]> {
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: ['main'],
    reader: { mode: 'silent', ms: 4000 },
  });
  try {
    await (await fetch(`http://127.0.0.1:${child.port}/flood`)).text();
    await child.waitForRecord((rec) => rec.event_name === 'skeld.log.dropped', 25_000).catch(() => undefined);
  } finally {
    await child.stop();
  }
  return child.records();
}

function rowCase(row: Row, rows: readonly Row[], run: Run, report: ReturnType<typeof createReport>): void {
  const own = run.records.filter((rec) => rec.event_name === row.event);
  const problems: string[] = [];
  if (writtenByDefault(row)) {
    check(problems, own.length >= 1, `no ${row.event} record`);
    for (const rec of own) {
      problems.push(...envelopeProblems(row, rows, rec));
    }
    report.result(
      `AC-11 row ${row.event}`,
      [...new Set(problems)],
      `${own.length} records: category ${row.category}, severity ${row.severity}, keys ${resolvedKeys(row, rows).join(' ')}`,
    );
    return;
  }
  check(problems, own.length === 0, `${own.length} records below the ${row.category} threshold`);
  const sent = run.sent.get(row.event);
  report.result(
    `AC-11 row ${row.event} (${row.category} ${row.severity}, not written with no options)`,
    problems,
    `${row.event} triggered ${sent === undefined ? 'by no request' : `by a request answered ${sent.status}`}; 0 records`,
  );
}

function reasonCase(
  row: Row,
  reason: string,
  rows: readonly Row[],
  run: Run,
  report: ReturnType<typeof createReport>,
): void {
  const key = `${row.event}|${reason}`;
  const name = `AC-11 ${row.event} reason ${reason}`;
  if (stated.has(key) && !triggers.has(key)) {
    report.note(`${name}: not triggerable from outside, as the page states`);
    statedCount++;
    return;
  }
  const sent = run.sent.get(key);
  const problems: string[] = [];
  check(problems, sent !== undefined, 'the script has no trigger for this documented reason');
  const mine = run.records.filter(
    (rec) =>
      rec.event_name === row.event &&
      rec['skeld.reason'] === reason &&
      (sent?.requestId == null || rec['skeld.request_id'] === sent.requestId),
  );
  check(problems, mine.length === 1, `${mine.length} records for the triggering request`);
  const [only] = mine;
  if (only !== undefined) {
    problems.push(...envelopeProblems(row, rows, only), ...reasonProblems(row, reason, only));
  }
  report.result(
    name,
    problems,
    `the request answered ${sent?.status} gave one ${row.event} record with skeld.reason ${reason}`,
  );
}

function variantCase(
  name: string,
  base: Run,
  variant: Run,
  keep: (rec: LogObject) => boolean,
  added: readonly string[],
  report: ReturnType<typeof createReport>,
  ignore: readonly string[] = [],
): void {
  const expected = mapOf(base.records.filter(keep));
  for (const key of added) {
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const seen = mapOf(variant.records.filter((rec) => !ignore.includes(String(rec.event_name))));
  const problems = sameMaps(expected, seen);
  report.result(
    name,
    problems,
    `${variant.records.length} records in ${seen.size} event and reason kinds; ${base.records.length - base.records.filter(keep).length} records of the base run removed, ${added.length} kinds added, all others equal in count`,
  );
}

async function main(): Promise<void> {
  const report = createReport('log-events');
  const rows = readRows();
  report.note(
    `events.md gives ${rows.length} rows and ${rows.reduce((sum, row) => sum + row.reasons.length, 0)} reasons`,
  );
  const base = await runMain({});
  const dropped = await droppedRecords();
  for (const row of rows) {
    if (row.event === 'skeld.log.dropped') {
      rowCase(row, rows, { records: dropped, sent: new Map(), stderr: '' }, report);
    } else {
      rowCase(row, rows, base, report);
    }
    for (const reason of row.reasons) {
      reasonCase(row, reason, rows, base, report);
    }
  }
  const origin = base.records.filter((rec) => rec.event_name === 'skeld.config.public_origin');
  const originProblems: string[] = [];
  check(
    originProblems,
    origin.length === 1,
    `${origin.length} public_origin records for two unverifiable refusals on one server`,
  );
  check(
    originProblems,
    origin.every((rec) => !('skeld.request_id' in rec)),
    'a public_origin record carries a request id',
  );
  report.result(
    'AC-11 skeld.config.public_origin is written once per server and carries no request id',
    originProblems,
    `${origin.length} record`,
  );

  const summary = base.records.filter((rec) => rec.event_name === 'skeld.log.suppressed');
  const summaryProblems: string[] = [];
  check(summaryProblems, summary.length === 1, `${summary.length} suppression summaries`);
  check(
    summaryProblems,
    summary[0]?.['skeld.suppressed.event_name'] === 'skeld.refuse.path',
    'the summary names another event',
  );
  check(
    summaryProblems,
    summary[0]?.['skeld.suppressed.count'] === 5,
    `the summary counts ${String(summary[0]?.['skeld.suppressed.count'])}, 25 refusals less 20 written is 5`,
  );
  report.result(
    'AC-11 skeld.log.suppressed counts the 5 of 25 refusals past the window of 20',
    summaryProblems,
    'written at close(), category and severity of the suppressed event',
  );

  const authored = base.records.filter((rec) => rec.event_name === 'skeld.app.message');
  const authorProblems: string[] = [];
  check(
    authorProblems,
    authored
      .map((rec) => rec.severity_text)
      .sort()
      .join() === 'error,info,warn',
    `author severities ${authored.map((rec) => rec.severity_text).join()}`,
  );
  check(
    authorProblems,
    authored.every((rec) => String(rec.message).includes(`${String(rec.severity_text)} call`)),
    'an author record carries another call message',
  );
  report.result(
    'AC-11 skeld.app.message takes the severity of the method called; the debug call is below the app threshold',
    authorProblems,
    `${authored.length} records for info, warn, error and one debug call`,
  );

  const raised: [string, string, string][] = [
    ['boot', 'error', 'boot'],
    ['app', 'fatal', 'app'],
    ['security', 'error', 'security'],
  ];
  for (const [category, level, removed] of raised) {
    const run = await runMain({ thresholds: { [category]: level } });
    variantCase(
      `AC-11 raising thresholds.${category} to ${level} removes only the ${removed} records`,
      base,
      run,
      (rec) => rec['skeld.category'] !== removed,
      [],
      report,
    );
  }
  const lowered = await runMain({ thresholds: { security: 'info' } });
  const infoEvents = rows.filter((row) => row.category === 'security' && row.severity === 'info');
  variantCase(
    'AC-11 lowering thresholds.security to info adds exactly the info refusals',
    base,
    lowered,
    () => true,
    infoEvents.map((row) => row.event),
    report,
  );
  const loweredProblems: string[] = [];
  for (const row of infoEvents) {
    const found = lowered.records.filter((rec) => rec.event_name === row.event);
    check(loweredProblems, found.length === 1, `${row.event}: ${found.length} records`);
    for (const rec of found) {
      loweredProblems.push(...envelopeProblems(row, rows, rec));
    }
  }
  report.result(
    'AC-11 each info refusal gives its row once the security threshold admits it',
    loweredProblems,
    `${infoEvents.map((row) => row.event).join(', ')}`,
  );
  const access = await runMain({ access: true });
  variantCase(
    'AC-11 the access option adds skeld.request.closed and changes nothing else',
    base,
    access,
    () => true,
    [],
    report,
    ['skeld.request.closed'],
  );
  const closedRow = rows.find((row) => row.event === 'skeld.request.closed');
  const closedProblems: string[] = [];
  const closed = access.records.filter((rec) => rec.event_name === 'skeld.request.closed');
  check(
    closedProblems,
    closedRow !== undefined && closed.length > 0,
    'no skeld.request.closed record with the access option',
  );
  for (const rec of closed) {
    closedProblems.push(...(closedRow === undefined ? [] : envelopeProblems(closedRow, rows, rec)));
  }
  report.result(
    'AC-11 skeld.request.closed matches its row once the access option is on',
    [...new Set(closedProblems)],
    `${closed.length} records`,
  );
  report.note(`${statedCount} documented reason not triggerable from outside, as the page states`);
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
