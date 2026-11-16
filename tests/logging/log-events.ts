// Does:  Proves each refusal and failure event is triggered with no options and gives its record.
// Holds: Each event and reason in the trigger list gives the record its request caused; no header spelling leaks.

// biome-ignore-all lint/security/noSecrets: route templates, event names and header values, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each trigger is sent alone so its request id stays its own
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import type { AccessTypes, AuthorizeOutcome, Gate, GateRequest, IdentifyOutcome } from '@skeld/core/gate';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer, type RequestContext, type Server } from '@skeld/core/server';
import { announceListening, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';
import { type RawResponse, rawExchange } from '../support/support.ts';

const detailOwners = new Map([
  ['skeld.schema_location', 'response_mismatch'],
  ['skeld.returned_status', 'undeclared_status'],
  ['skeld.redirect_refusal', 'redirect_refused'],
  ['skeld.reserved_header', 'reserved_header'],
]);
const redirectRefusals = [
  'not a string',
  'surrounding whitespace',
  'control character',
  'backslash',
  'not a local path',
  'not a URL',
  'scheme not http or https',
  'userinfo',
  'origin not allowed',
];

const ok = t.object({ ok: t.boolean() });
const reportShape = t.object({ report: t.string({ maxLength: 4000 }) });
const noBody = t.object({ a: t.string({ maxLength: 10 }) });
const contract = defineContract({
  ok: { method: 'GET', path: '/ok', responses: { 200: ok } },
  thrown: { method: 'GET', path: '/thrown', responses: { 200: ok } },
  httpError: { method: 'GET', path: '/http-error', responses: { 200: ok } },
  slow: { method: 'GET', path: '/slow', responses: { 200: ok } },
  undeclared: { method: 'GET', path: '/undeclared', responses: { 200: ok } },
  undeclaredText: { method: 'GET', path: '/undeclared-text', responses: { 200: ok } },
  undeclaredHigh: { method: 'GET', path: '/undeclared-high', responses: { 200: ok } },
  undeclaredFraction: { method: 'GET', path: '/undeclared-fraction', responses: { 200: ok } },
  mismatch: { method: 'GET', path: '/mismatch', responses: { 200: ok } },
  reserved: { method: 'GET', path: '/reserved', responses: { 200: ok } },
  reservedCookie: { method: 'GET', path: '/reserved-cookie', responses: { 200: ok } },
  reservedOdd: { method: 'GET', path: '/reserved-odd', responses: { 200: ok } },
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
});

const gatedContract = defineContract({
  guarded: { method: 'GET', path: '/guarded', access: { policy: 'p', action: 'a' }, responses: { 200: ok } },
});

function caseOf(request: GateRequest): string {
  const value = request.headers['x-case'];
  return typeof value === 'string' ? value : '';
}

// Does:  A minimal gate for the third server: the x-case header picks which refusal or fault each step answers.
const testGate: Gate<AccessTypes> = {
  boot: () => undefined,
  bind: () => ({
    cookie: false,
    identify: (request): IdentifyOutcome<unknown> => {
      switch (caseOf(request)) {
        case 'credential_missing':
          return { kind: 'refuse', reason: 'credential_missing', challenge: 'bearer' };
        case 'credential_invalid':
          return { kind: 'refuse', reason: 'credential_invalid', challenge: null };
        case 'credential_conflict':
          return { kind: 'refuse', reason: 'credential_conflict' };
        case 'csrf_token':
          return { kind: 'refuse', reason: 'csrf_token' };
        case 'rate_limited':
          return { kind: 'refuse', reason: 'rate_limited', retryAfterSeconds: 3 };
        case 'unavailable':
          return { kind: 'refuse', reason: 'unavailable' };
        case 'gate':
          throw new Error('a gate step that threw');
        default:
          return { kind: 'admit', principal: { id: 'p' } };
      }
    },
    authorize: (_principal, _input, request): AuthorizeOutcome => {
      switch (caseOf(request)) {
        case 'access_denied':
          return { kind: 'refuse', reason: 'access_denied' };
        case 'access_hidden':
          return { kind: 'refuse', reason: 'access_hidden' };
        case 'resource_missing':
          return { kind: 'refuse', reason: 'resource_missing' };
        default:
          return { kind: 'admit', grant: { g: 1 } };
      }
    },
    release: () => undefined,
  }),
};

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the fixtures return and send values the declared types refuse, to see the run-time answer
  return value as never;
}

const goodReply = { status: 200 as const, body: { ok: true } };

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
  const third = createServer({ log, gate: testGate });
  third.routes(gatedContract, { guarded: () => goodReply });
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
  let thirdPort = 0;
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
      undeclaredText: () => pastTypes({ status: '200', body: { ok: true } }),
      undeclaredHigh: () => pastTypes({ status: 1000, body: { ok: true } }),
      undeclaredFraction: () => pastTypes({ status: 201.5, body: { ok: true } }),
      mismatch: () => pastTypes({ status: 200, body: { ok: 'not a boolean' } }),
      reserved: () => pastTypes({ ...goodReply, headers: { 'x-request-id': 'forged' } }),
      reservedCookie: () => pastTypes({ ...goodReply, headers: { 'Set-Cookie': 'a=b' } }),
      reservedOdd: () => pastTypes({ ...goodReply, headers: { 'SeT-CoOkIe': 'a=b' } }),
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
      ports: () => ({ status: 200, body: { report: `${secondPort},${thirdPort}` } }),
    },
    { handlerTimeouts: { slow: 100 }, bodyLimits: { body: 64 } },
  );
  second.routes(contract, {
    ok: () => goodReply,
    thrown: () => goodReply,
    httpError: () => goodReply,
    slow: () => goodReply,
    undeclared: () => goodReply,
    undeclaredText: () => goodReply,
    undeclaredHigh: () => goodReply,
    undeclaredFraction: () => goodReply,
    mismatch: () => goodReply,
    reserved: () => goodReply,
    reservedCookie: () => goodReply,
    reservedOdd: () => goodReply,
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
  });
  second
    .listen({ port: 0, host: '127.0.0.1' })
    .then((address) => {
      secondPort = address.port;
      return third.listen({ port: 0, host: '127.0.0.1' });
    })
    .then((address) => {
      thirdPort = address.port;
      return first.listen({ port: 0, host: '127.0.0.1' });
    })
    .then(({ port }) => {
      process.on('SIGTERM', () => void closeBoth(first, second, third));
      announceListening(port);
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

async function closeBoth(first: Server, second: Server, third: { close: () => Promise<void> }): Promise<void> {
  await Promise.all([first.close(), second.close(), third.close()]);
  process.exit(0);
}

interface Spec {
  server: 'first' | 'second' | 'third';
  method: string;
  path: string;
  headers?: string[];
  body?: string;
  raw?: string;
  times?: number;
}

const deepBody = `{"a":${'['.repeat(70)}${']'.repeat(70)}}`;
const triggers = new Map<string, Spec>([
  ['skeld.request.error|thrown', { server: 'first', method: 'GET', path: '/thrown' }],
  ['skeld.request.error|http_error', { server: 'first', method: 'GET', path: '/http-error' }],
  ['skeld.request.error|timeout', { server: 'first', method: 'GET', path: '/slow' }],
  ['skeld.request.error|undeclared_status', { server: 'first', method: 'GET', path: '/undeclared' }],
  ['detail|undeclared_status|text', { server: 'first', method: 'GET', path: '/undeclared-text' }],
  ['detail|undeclared_status|high', { server: 'first', method: 'GET', path: '/undeclared-high' }],
  ['detail|undeclared_status|fraction', { server: 'first', method: 'GET', path: '/undeclared-fraction' }],
  ['detail|reserved_header|cookie', { server: 'first', method: 'GET', path: '/reserved-cookie' }],
  ['detail|reserved_header|odd', { server: 'first', method: 'GET', path: '/reserved-odd' }],
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
  [
    'skeld.refuse.credential_invalid',
    { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: credential_invalid'] },
  ],
  [
    'skeld.refuse.credential_conflict',
    { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: credential_conflict'] },
  ],
  ['skeld.refuse.csrf_token', { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: csrf_token'] }],
  [
    'skeld.refuse.rate_limited',
    { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: rate_limited'] },
  ],
  [
    'skeld.refuse.access_denied',
    { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: access_denied'] },
  ],
  [
    'skeld.refuse.access_hidden',
    { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: access_hidden'] },
  ],
  ['skeld.refuse.unavailable', { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: unavailable'] }],
  ['skeld.request.error|gate', { server: 'third', method: 'GET', path: '/guarded', headers: ['x-case: gate'] }],
  ['skeld.app.message', { server: 'first', method: 'GET', path: '/log' }],
]);
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
    const ports = String(typeof body === 'object' && body !== null ? Reflect.get(body, 'report') : '').split(',');
    const secondPort = Number(ports[0]);
    const thirdPort = Number(ports[1]);
    for (const [key, spec] of triggers) {
      const port = spec.server === 'first' ? child.port : spec.server === 'second' ? secondPort : thirdPort;
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

const exceptionKeys = ['skeld.exception.kind'];

function reasonProblems(event: string, reason: string, rec: LogObject): string[] {
  const problems: string[] = [];
  const reads =
    event === 'skeld.request.error'
      ? reason === 'thrown' || reason === 'http_error'
      : event === 'skeld.hook.error' && reason !== 'late_send';
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
  if (reason === 'undeclared_status') {
    check(
      problems,
      rec['skeld.returned_status'] === 201,
      `skeld.returned_status is ${String(rec['skeld.returned_status'])}, the handler returned 201`,
    );
  }
  if (reason === 'redirect_refused') {
    check(
      problems,
      redirectRefusals.includes(String(rec['skeld.redirect_refusal'])),
      `skeld.redirect_refusal is ${String(rec['skeld.redirect_refusal'])}, not one of the documented causes`,
    );
  }
  if (reason === 'reserved_header') {
    check(
      problems,
      rec['skeld.reserved_header'] === 'x-request-id',
      `skeld.reserved_header is ${String(rec['skeld.reserved_header'])}, the handler named x-request-id`,
    );
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

function detailCases(run: Run, report: ReturnType<typeof createReport>): void {
  const expectations: [string, string, string, unknown][] = [
    ['detail|undeclared_status|text', 'undeclared_status', 'skeld.returned_status', undefined],
    ['detail|undeclared_status|high', 'undeclared_status', 'skeld.returned_status', undefined],
    ['detail|undeclared_status|fraction', 'undeclared_status', 'skeld.returned_status', undefined],
    ['detail|reserved_header|cookie', 'reserved_header', 'skeld.reserved_header', 'set-cookie'],
    ['detail|reserved_header|odd', 'reserved_header', 'skeld.reserved_header', 'set-cookie'],
  ];
  for (const [trigger, reason, key, expected] of expectations) {
    const problems: string[] = [];
    const sent = run.sent.get(trigger);
    const mine = run.records.filter(
      (rec) => rec.event_name === 'skeld.request.error' && rec['skeld.request_id'] === sent?.requestId,
    );
    check(problems, sent?.requestId != null && mine.length === 1, `${mine.length} error records for the request`);
    const [only] = mine;
    check(
      problems,
      only?.['skeld.reason'] === reason,
      `skeld.reason is ${String(only?.['skeld.reason'])}, not ${reason}`,
    );
    check(
      problems,
      only !== undefined && (expected === undefined ? !(key in only) : only[key] === expected),
      `${key} is ${only !== undefined && key in only ? JSON.stringify(only[key]) : 'absent'}, expected ${expected === undefined ? 'absent' : JSON.stringify(expected)}`,
    );
    report.result(
      `AC-11 ${trigger.replace('detail|', '')} writes ${expected === undefined ? `no ${key}` : `${key} ${String(expected)}`}`,
      problems,
      `the request answered ${sent?.status} gave one skeld.request.error record`,
    );
  }
  const text = run.records.map((rec) => JSON.stringify(rec)).join('\n');
  const spellings = ['Set-Cookie', 'SeT-CoOkIe'].filter((spelling) => text.includes(spelling));
  const own = run.records.filter((rec) => rec.event_name === 'skeld.request.error');
  const stray = own.flatMap((rec) =>
    [...detailOwners].filter(([key, owner]) => key in rec && rec['skeld.reason'] !== owner).map(([key]) => key),
  );
  report.result(
    'AC-11 no record carries the application spelling of a header, and a detail key never sits on another reason',
    [
      ...spellings.map((spelling) => `a record contains ${spelling}`),
      ...stray.map((key) => `${key} sits on a record of another reason`),
    ],
    `${run.records.length} records searched`,
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

function eventCase(key: string, run: Run, report: ReturnType<typeof createReport>): void {
  const [event = '', reason] = key.split('|');
  const sent = run.sent.get(key);
  const problems: string[] = [];
  if (reason === undefined) {
    const own = run.records.filter((rec) => rec.event_name === event);
    check(problems, own.length >= 1, `no ${event} record`);
    report.result(`AC-11 ${event}`, problems, `${own.length} records`);
    return;
  }
  const mine = run.records.filter(
    (rec) =>
      rec.event_name === event &&
      rec['skeld.reason'] === reason &&
      (sent?.requestId == null || rec['skeld.request_id'] === sent.requestId),
  );
  check(problems, mine.length === 1, `${mine.length} records for the triggering request`);
  const [only] = mine;
  if (only !== undefined) {
    problems.push(...reasonProblems(event, reason, only));
  }
  report.result(
    `AC-11 ${event} reason ${reason}`,
    problems,
    `the request answered ${sent?.status} gave one ${event} record with skeld.reason ${reason}`,
  );
}

async function main(): Promise<void> {
  const report = createReport('log-events');
  const base = await runMain({});
  for (const key of triggers.keys()) {
    if (!key.startsWith('detail|')) {
      eventCase(key, base, report);
    }
  }
  detailCases(base, report);
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
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
