// Does:  Proves a request past its time limit is answered 503 TIMEOUT and its signal is aborted.
// Holds: Answers are read on raw sockets, so a second response or a late byte cannot hide.

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, parseRaw, type RawResponse } from '../support/support.ts';

const statement =
  'with handlerTimeoutMs 300 a handler, an async onRequest hook and an async preHandler hook that never settle are answered 503 TIMEOUT with connection close, the signal aborts, a late reply adds no second response or byte, a reply inside the limit is unaffected, the next connection is answered and a disconnect aborts the signal';

const serverLimit = 300;
const note = t.object({ ok: t.boolean() });
const contract = defineContract({
  hang: { method: 'GET', path: '/hang', responses: { 200: note } },
  hookhang: { method: 'GET', path: '/hookhang', responses: { 200: note } },
  prehang: { method: 'GET', path: '/prehang', responses: { 200: note } },
  late: { method: 'GET', path: '/late', responses: { 200: note } },
  fast: { method: 'GET', path: '/fast', responses: { 200: note } },
  quick: { method: 'GET', path: '/quick', responses: { 200: note } },
});

interface Seen {
  signal?: AbortSignal;
  abortAt?: number;
  flagAtEvent?: boolean;
  returnedAt?: number;
}
const seen = new Map<string, Seen>();

function caseOf(headers: { readonly [name: string]: string | readonly string[] | undefined }): string {
  const value = headers['x-case'];
  return typeof value === 'string' ? value : '';
}

function watch(key: string, signal: AbortSignal): Seen {
  const entry = seen.get(key) ?? {};
  seen.set(key, entry);
  entry.signal = signal;
  signal.addEventListener(
    'abort',
    () => {
      entry.abortAt = performance.now();
      entry.flagAtEvent = signal.aborted;
    },
    { once: true },
  );
  return entry;
}

const ok = () => ({ status: 200 as const, body: { ok: true } });
const never = () => new Promise<never>(() => undefined);

interface Req {
  headers: { readonly [name: string]: string | readonly string[] | undefined };
  signal: AbortSignal;
}

function handlers() {
  return {
    hang: (request: Req) => {
      watch(caseOf(request.headers), request.signal);
      return never();
    },
    hookhang: ok,
    prehang: ok,
    late: async (request: Req) => {
      const entry = watch(caseOf(request.headers), request.signal);
      await delay(600);
      entry.returnedAt = performance.now();
      return ok();
    },
    fast: async () => {
      await delay(100);
      return ok();
    },
    quick: ok,
  };
}

interface Timed {
  response: RawResponse;
  t0: number;
  firstByteMs: number | null;
  closedMs: number | null;
  bytes: number;
}

function timedExchange(at: number, request: string, waitMs: number): Promise<Timed> {
  return new Promise((resolve) => {
    const socket = net.connect(at, '127.0.0.1');
    const chunks: Buffer[] = [];
    let t0 = 0;
    let firstByteMs: number | null = null;
    let closedMs: number | null = null;
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      const raw = Buffer.concat(chunks);
      resolve({ response: parseRaw(raw.toString('latin1')), t0, firstByteMs, closedMs, bytes: raw.length });
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (data) => {
      firstByteMs ??= performance.now() - t0;
      chunks.push(Buffer.from(data));
    });
    socket.on('close', () => {
      closedMs = performance.now() - t0;
      finish();
    });
    socket.on('error', () => undefined);
    socket.on('connect', () => {
      t0 = performance.now();
      socket.write(request, 'latin1');
    });
  });
}

const get = (path: string, caseName: string) =>
  `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\nx-case: ${caseName}\r\n\r\n`;

const problems: string[] = [];
const log: string[] = [];

function checkTimeout(label: string, timed: Timed, limit: number): void {
  const { response } = timed;
  check(problems, response.status === 503, `${label}: status ${response.status}, expected 503`);
  let code: unknown;
  let status: unknown;
  try {
    const parsed: unknown = JSON.parse(response.body);
    code = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'code') : undefined;
    status = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'status') : undefined;
  } catch {
    code = 'unparsable';
  }
  check(problems, code === 'TIMEOUT' && status === 503, `${label}: body ${response.body}`);
  check(
    problems,
    response.headers.get('connection') === 'close',
    `${label}: connection was ${response.headers.get('connection')}`,
  );
  const at = timed.firstByteMs ?? -1;
  const headEnd = response.raw.indexOf('\r\n\r\n') + 4;
  const length = Number(response.headers.get('content-length'));
  check(
    problems,
    response.raw.split('HTTP/1.').length === 2 && timed.bytes === headEnd + length,
    `${label}: ${timed.bytes} bytes for one head of ${headEnd} and a body of ${length}`,
  );
  log.push(
    `${label}: ${response.status} ${response.body} at ${at.toFixed(0)} ms, limit ${limit}, connection ${response.headers.get('connection')}, closed ${timed.closedMs?.toFixed(0) ?? 'no'} ms`,
  );
}

function checkAbort(label: string, caseName: string, timed: Timed): void {
  const entry = seen.get(caseName);
  const abortAfter = entry?.abortAt === undefined ? -1 : entry.abortAt - timed.t0;
  const respondedAt = timed.firstByteMs ?? -1;
  check(problems, entry?.signal?.aborted === true, `${label}: signal.aborted was ${entry?.signal?.aborted}`);
  check(problems, entry?.flagAtEvent === true, `${label}: the abort listener saw aborted ${entry?.flagAtEvent}`);
  log.push(`${label}: signal aborted at ${abortAfter.toFixed(0)} ms, response at ${respondedAt.toFixed(0)} ms`);
}

const server = createServer({ handlerTimeoutMs: serverLimit });
server.addHook('onRequest', async (context) => {
  if (context.route.name === 'hookhang') {
    watch(caseOf(context.headers), context.signal);
    await never();
  }
});
server.addHook('preHandler', async (context) => {
  if (context.route.name === 'prehang') {
    watch(caseOf(context.headers), context.signal);
    await never();
  }
});
server.routes(contract, handlers());
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });

try {
  const proveHung = async (route: string) => {
    const timed = await timedExchange(port, get(`/${route}`, route), 2000);
    checkTimeout(route, timed, serverLimit);
    checkAbort(route, route, timed);
  };
  await proveHung('hang');
  await proveHung('hookhang');
  await proveHung('prehang');

  const late = await timedExchange(port, get('/late', 'late'), 1300);
  checkTimeout('late reply', late, serverLimit);
  const lateEntry = seen.get('late');
  await delay(500);
  check(problems, lateEntry?.returnedAt !== undefined, 'late reply: the handler never returned, nothing was tested');
  check(
    problems,
    lateEntry?.returnedAt === undefined || lateEntry.returnedAt - late.t0 > (late.firstByteMs ?? 0),
    'late reply: the handler returned before the timeout answer',
  );

  const fast = await timedExchange(port, get('/fast', 'fast'), 1500);
  check(
    problems,
    fast.response.status === 200 && fast.response.body === '{"ok":true}',
    `fast route: ${fast.response.status} ${fast.response.body}`,
  );
  log.push(`fast route: ${fast.response.status} at ${fast.firstByteMs?.toFixed(0)} ms`);

  const next = await timedExchange(port, get('/quick', 'quick'), 1500);
  check(
    problems,
    next.response.status === 200 && next.response.body === '{"ok":true}',
    `after a timeout: ${next.response.status} ${next.response.body}`,
  );

  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  const sentAt = performance.now();
  socket.write(get('/hang', 'disconnect'), 'latin1');
  await delay(80);
  const destroyedAt = performance.now();
  socket.destroy();
  await delay(250);
  const gone = seen.get('disconnect');
  const abortedAfter = gone?.abortAt === undefined ? -1 : gone.abortAt - destroyedAt;
  check(
    problems,
    gone?.signal?.aborted === true &&
      abortedAfter >= 0 &&
      abortedAfter <= 100 &&
      gone.abortAt !== undefined &&
      gone.abortAt - sentAt < serverLimit,
    `disconnect: aborted ${gone?.signal?.aborted}, ${abortedAfter.toFixed(0)} ms after the client closed`,
  );
  log.push(
    `disconnect: signal aborted ${abortedAfter.toFixed(0)} ms after the client closed, before the ${serverLimit} ms limit`,
  );
} finally {
  await server.close();
}

process.stdout.write(`${log.join('\n')}\n`);
conclude(statement, problems);
