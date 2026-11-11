// Does:  Proves that the typed client stops reading a hostile response at its limit and rejects one nested past 64.
// Holds: The peer is a plain node:http server that records how many body bytes it wrote before the client hung up.

import http, { type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createClient } from '@darkstart/core/client';
import { defineContract } from '@darkstart/core/contract';
import { HttpError } from '@darkstart/core/http-error';
import * as t from '@darkstart/core/schema';
import { check, conclude } from './support.ts';

const statement =
  'a client call rejects with RESPONSE_TOO_LARGE once a body passes the limit derived from the schema (1 MiB when unbounded or undeclared), whether it streams, understates its Content-Length by encoding, or declares a length over it, and the peer sees the client stop within one chunk; maxResponseBytes replaces the limit both ways and a bad value throws TypeError; a response nested 65 deep rejects with INVALID_RESPONSE';
const smallLimit = 1166;
const defaultLimit = 1_048_576;
const pacingMs = 20;
const waitForCloseMs = 2000;

function nestedArrays(levels: number): t.Schema {
  let schema: t.Schema = t.integer({ minimum: 0, maximum: 9 });
  for (let level = 0; level < levels; level++) {
    schema = t.array(schema, { maxItems: 1 });
  }
  return schema;
}

const contract = defineContract({
  small: {
    method: 'GET',
    path: '/small',
    query: t.object({ mode: t.string({ maxLength: 32 }) }),
    responses: { 200: t.object({ data: t.string({ maxLength: 10 }) }) },
  },
  big: {
    method: 'GET',
    path: '/big',
    query: t.object({ mode: t.string({ maxLength: 32 }) }),
    responses: {
      200: t.object({ data: t.string({ unbounded: 'the 1 MiB default limit is the subject of this script' }) }),
    },
  },
  deep: {
    method: 'GET',
    path: '/deep',
    query: t.object({ mode: t.string({ maxLength: 32 }) }),
    responses: { 200: nestedArrays(64) },
  },
});

interface PeerRecord {
  sent: number;
  sentAtClose: number | null;
  timedOut: boolean;
  closed: Promise<void>;
}

const records = new Map<string, PeerRecord>();

function track(res: ServerResponse, key: string): PeerRecord {
  let markClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  const record: PeerRecord = { sent: 0, sentAtClose: null, timedOut: false, closed };
  res.on('close', () => {
    if (!res.writableFinished) {
      record.sentAtClose = record.sent;
    }
    markClosed();
  });
  records.set(key, record);
  return record;
}

function sendPaced(res: ServerResponse, record: PeerRecord, next: () => Buffer | null): void {
  const step = (): void => {
    if (res.destroyed) {
      return;
    }
    const piece = next();
    if (piece === null) {
      res.end();
      return;
    }
    record.sent += piece.length;
    res.write(piece);
    setTimeout(step, pacingMs);
  };
  step();
}

function paddedBody(total: number): string {
  const head = '{"data":"abc"}';
  return `${head}${' '.repeat(total - head.length)}`;
}

function arrayText(levels: number): string {
  return `${'['.repeat(levels)}${']'.repeat(levels)}`;
}

function numberAfter(mode: string, prefix: string): number {
  return Number(mode.slice(prefix.length));
}

const json = { 'content-type': 'application/json' };

const peer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://peer');
  const mode = url.searchParams.get('mode') ?? '';
  const record = track(res, `${url.pathname}?${mode}`);
  if (mode === 'ok') {
    res.writeHead(200, json).end('{"data":"abc"}');
  } else if (mode.startsWith('pad-')) {
    res.writeHead(200, json).end(paddedBody(numberAfter(mode, 'pad-')));
  } else if (mode.startsWith('bigpad-')) {
    const total = numberAfter(mode, 'bigpad-');
    res.writeHead(200, json).end(`{"data":"${'a'.repeat(total - 11)}"}`);
  } else if (mode.startsWith('stream-') || mode.startsWith('stream201-')) {
    const status = mode.startsWith('stream201-') ? 201 : 200;
    const chunk = Buffer.alloc(numberAfter(mode, status === 201 ? 'stream201-' : 'stream-'), 0x61);
    res.writeHead(status, json);
    sendPaced(res, record, () => (record.sent >= chunk.length * 400 ? null : chunk));
  } else if (mode === 'gzip') {
    const packed = gzipSync(Buffer.from(`{"data":"${'a'.repeat(8_000_000)}"}`));
    res.writeHead(200, { ...json, 'content-encoding': 'gzip', 'content-length': String(packed.length) });
    let offset = 0;
    sendPaced(res, record, () => {
      if (offset >= packed.length) {
        return null;
      }
      const piece = packed.subarray(offset, offset + 128);
      offset += piece.length;
      return piece;
    });
  } else if (mode.startsWith('declared-')) {
    const [, status, length] = mode.split('-');
    res.writeHead(Number(status), { ...json, 'content-length': String(length) });
    const first = Buffer.alloc(64, 0x20);
    record.sent = first.length;
    res.write(first);
    const timer = setTimeout(() => {
      record.timedOut = true;
      res.destroy();
    }, waitForCloseMs);
    res.once('close', () => clearTimeout(timer));
  } else if (mode.startsWith('deep-') || mode.startsWith('deep201-')) {
    const status = mode.startsWith('deep201-') ? 201 : 200;
    res.writeHead(status, json).end(arrayText(numberAfter(mode, status === 201 ? 'deep201-' : 'deep-')));
  } else {
    res.writeHead(500).end();
  }
});
await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
const address = peer.address();
if (address === null || typeof address === 'string') {
  throw new Error('the peer did not bind a TCP port');
}
const baseUrl = `http://127.0.0.1:${address.port}`;

type Outcome = { kind: 'resolved'; status: number; body: unknown } | { kind: 'rejected'; error: unknown };

async function observe(invoke: () => Promise<{ status: number; body: unknown }>): Promise<Outcome> {
  try {
    const result = await invoke();
    return { kind: 'resolved', status: result.status, body: result.body };
  } catch (error) {
    return { kind: 'rejected', error };
  }
}

function describe(outcome: Outcome): string {
  if (outcome.kind === 'resolved') {
    return `resolved ${outcome.status}`;
  }
  return outcome.error instanceof HttpError ? `HttpError ${outcome.error.code}` : String(outcome.error);
}

function rejectedWith(outcome: Outcome, code: string): boolean {
  return (
    outcome.kind === 'rejected' &&
    outcome.error instanceof HttpError &&
    outcome.error.code === code &&
    outcome.error.status === null
  );
}

async function recordFor(path: string, mode: string): Promise<PeerRecord> {
  const record = records.get(`${path}?${mode}`);
  if (record === undefined) {
    throw new Error(`the peer saw no request for ${path}?${mode}`);
  }
  await Promise.race([record.closed, new Promise((resolve) => setTimeout(resolve, waitForCloseMs + 500))]);
  return record;
}

const problems: string[] = [];
const client = createClient(contract, { baseUrl });
const call = (route: 'small' | 'big' | 'deep', mode: string, using = client) =>
  observe(() => using[route]({ query: { mode } }));

async function streamCase(
  label: string,
  route: 'small' | 'big',
  mode: string,
  limit: number,
  chunk: number,
): Promise<void> {
  const outcome = await call(route, mode);
  check(problems, rejectedWith(outcome, 'RESPONSE_TOO_LARGE'), `${label}: call was ${describe(outcome)}`);
  const record = await recordFor(`/${route}`, mode);
  check(
    problems,
    record.sentAtClose !== null,
    `${label}: the peer never saw the client hang up (wrote ${record.sent} bytes)`,
  );
  const sent = record.sentAtClose ?? record.sent;
  check(problems, sent > limit, `${label}: the client hung up after ${sent} bytes, at or below the limit of ${limit}`);
  check(
    problems,
    sent <= limit + chunk,
    `${label}: the peer wrote ${sent} bytes before the client stopped, over ${limit} plus one ${chunk}-byte chunk`,
  );
}

async function declaredCase(label: string, route: 'small' | 'big', mode: string): Promise<void> {
  const started = performance.now();
  const outcome = await call(route, mode);
  const elapsed = performance.now() - started;
  check(
    problems,
    rejectedWith(outcome, 'RESPONSE_TOO_LARGE'),
    `(c) declared length ${label}: call was ${describe(outcome)}`,
  );
  const record = await recordFor(`/${route}`, mode);
  check(
    problems,
    !record.timedOut,
    `(c) declared length ${label}: the client kept the connection open for ${waitForCloseMs} ms`,
  );
  check(
    problems,
    record.sentAtClose === 64,
    `(c) declared length ${label}: the peer had written ${record.sentAtClose} body bytes, expected only the 64 flushed with the headers`,
  );
  check(problems, elapsed < waitForCloseMs, `(c) declared length ${label}: the call took ${Math.round(elapsed)} ms`);
}

try {
  await call('small', 'ok');
  await streamCase('(a) streamed, no Content-Length, derived limit', 'small', 'stream-256', smallLimit, 256);
  await streamCase('(a) streamed, no Content-Length, unbounded schema', 'big', 'stream-16384', defaultLimit, 16_384);
  await streamCase('(a) streamed, undeclared status 201', 'small', 'stream201-16384', defaultLimit, 16_384);

  const gzipOutcome = await call('small', 'gzip');
  check(
    problems,
    rejectedWith(gzipOutcome, 'RESPONSE_TOO_LARGE'),
    `(b) gzip body larger than its Content-Length: call was ${describe(gzipOutcome)}`,
  );
  const gzipRecord = await recordFor('/small', 'gzip');
  check(
    problems,
    gzipRecord.sentAtClose !== null,
    `(b) gzip: the peer finished writing all ${gzipRecord.sent} encoded bytes before the client stopped`,
  );

  await declaredCase('derived limit plus one', 'small', `declared-200-${smallLimit + 1}`);
  await declaredCase('1 MiB plus one, unbounded schema', 'big', `declared-200-${defaultLimit + 1}`);
  await declaredCase('1 MiB plus one, undeclared status 201', 'small', `declared-201-${defaultLimit + 1}`);

  const okSmall = await call('small', 'ok');
  check(
    problems,
    okSmall.kind === 'resolved' && okSmall.status === 200,
    `(d) small response: call was ${describe(okSmall)}`,
  );
  check(
    problems,
    okSmall.kind === 'resolved' && JSON.stringify(okSmall.body) === '{"data":"abc"}',
    '(d) small response: body was not {"data":"abc"}',
  );
  const exactSmall = await call('small', `pad-${smallLimit}`);
  check(
    problems,
    exactSmall.kind === 'resolved' && exactSmall.status === 200,
    `(d) body of exactly ${smallLimit} bytes: call was ${describe(exactSmall)}`,
  );
  const overSmall = await call('small', `pad-${smallLimit + 1}`);
  check(
    problems,
    rejectedWith(overSmall, 'RESPONSE_TOO_LARGE'),
    `(d) body of ${smallLimit + 1} bytes with its Content-Length: call was ${describe(overSmall)}`,
  );
  const halfMebibyte = await call('big', 'bigpad-500000');
  check(
    problems,
    halfMebibyte.kind === 'resolved' && halfMebibyte.status === 200,
    `(d) 500,000-byte unbounded response: call was ${describe(halfMebibyte)}`,
  );
  const exactBig = await call('big', `bigpad-${defaultLimit}`);
  check(
    problems,
    exactBig.kind === 'resolved' && exactBig.status === 200,
    `(d) body of exactly 1 MiB: call was ${describe(exactBig)}`,
  );
  const overBig = await call('big', `bigpad-${defaultLimit + 1}`);
  check(
    problems,
    rejectedWith(overBig, 'RESPONSE_TOO_LARGE'),
    `(d) body of 1 MiB plus one: call was ${describe(overBig)}`,
  );

  const small100 = createClient(contract, { baseUrl, maxResponseBytes: 100 });
  const refusedSmall = await call('small', 'pad-300', small100);
  check(
    problems,
    rejectedWith(refusedSmall, 'RESPONSE_TOO_LARGE'),
    `(e) maxResponseBytes 100 on a 300-byte body the derived limit allows: call was ${describe(refusedSmall)}`,
  );
  const admittedSmall = await call('small', 'ok', small100);
  check(
    problems,
    admittedSmall.kind === 'resolved' && admittedSmall.status === 200,
    `(e) maxResponseBytes 100 on a 14-byte body: call was ${describe(admittedSmall)}`,
  );
  const derivedRefuses = await call('small', 'pad-5000');
  check(
    problems,
    rejectedWith(derivedRefuses, 'RESPONSE_TOO_LARGE'),
    `(e) control: the derived limit on a 5,000-byte body: call was ${describe(derivedRefuses)}`,
  );
  const large10m = createClient(contract, { baseUrl, maxResponseBytes: 10_000_000 });
  const admitsLargeSmall = await call('small', 'pad-5000', large10m);
  check(
    problems,
    admitsLargeSmall.kind === 'resolved' && admitsLargeSmall.status === 200,
    `(e) maxResponseBytes 10,000,000 on a 5,000-byte body: call was ${describe(admitsLargeSmall)}`,
  );
  const defaultRefusesBig = await call('big', 'bigpad-2000000');
  check(
    problems,
    rejectedWith(defaultRefusesBig, 'RESPONSE_TOO_LARGE'),
    `(e) control: the 1 MiB limit on a 2,000,000-byte body: call was ${describe(defaultRefusesBig)}`,
  );
  const admitsLargeBig = await call('big', 'bigpad-2000000', large10m);
  check(
    problems,
    admitsLargeBig.kind === 'resolved' && admitsLargeBig.status === 200,
    `(e) maxResponseBytes 10,000,000 on a 2,000,000-byte body: call was ${describe(admitsLargeBig)}`,
  );
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let thrown: unknown = null;
    try {
      createClient(contract, { baseUrl, maxResponseBytes: bad });
    } catch (error) {
      thrown = error;
    }
    check(
      problems,
      thrown instanceof TypeError,
      `(e) maxResponseBytes ${bad} gave ${String(thrown)}, expected a TypeError`,
    );
  }

  const deep64 = await call('deep', 'deep-64');
  check(
    problems,
    deep64.kind === 'resolved' && deep64.status === 200,
    `(f) declared 200 nested 64 deep: call was ${describe(deep64)}`,
  );
  const deep65 = await call('deep', 'deep-65');
  check(
    problems,
    rejectedWith(deep65, 'INVALID_RESPONSE'),
    `(f) declared 200 nested 65 deep: call was ${describe(deep65)}`,
  );
  const undeclared64 = await call('small', 'deep201-64');
  check(
    problems,
    undeclared64.kind === 'resolved' && undeclared64.status === 201,
    `(f) undeclared 201 nested 64 deep: call was ${describe(undeclared64)}`,
  );
  const undeclared65 = await call('small', 'deep201-65');
  check(
    problems,
    rejectedWith(undeclared65, 'INVALID_RESPONSE'),
    `(f) undeclared 201 nested 65 deep: call was ${describe(undeclared65)}`,
  );
} finally {
  peer.closeAllConnections();
  await new Promise<void>((resolve) => peer.close(() => resolve()));
}
conclude(statement, problems);
