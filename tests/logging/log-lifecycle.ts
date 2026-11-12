// Does:  Proves each request yields one access record and one id, and the lifecycle points count alike in each mode.
// Holds: Every case runs in its own server child per mode, so the diag counts of a case are exactly that case's.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';
import { rawExchange } from '../support/support.ts';

const ok = t.object({ ok: t.boolean() });
const contract = defineContract({
  ok: { method: 'GET', path: '/ok', responses: { 200: ok } },
  hooked: { method: 'GET', path: '/hooked', responses: { 200: ok } },
  throwing: { method: 'GET', path: '/throw', responses: { 200: ok } },
  hang: { method: 'GET', path: '/hang', responses: { 200: ok } },
  medium: {
    method: 'GET',
    path: '/medium',
    responses: { 200: t.object({ data: t.string({ maxLength: 2_000_000 }) }) },
  },
  big: { method: 'GET', path: '/big', responses: { 200: t.object({ data: t.string({ maxLength: 20_000_000 }) }) } },
  submit: {
    method: 'POST',
    path: '/submit',
    body: t.object({ name: t.string({ maxLength: 20 }) }),
    responses: { 200: ok },
  },
});

const handlerTimeoutMs = 400;
const corsOrigin = 'https://app.example';

function serve(): void {
  const server = createServer({
    handlerTimeoutMs,
    cors: { origins: [corsOrigin] },
    log: process.env.LOG_MODE === 'off' ? false : { access: true, thresholds: { security: 'info' } },
  });
  server.addHook('onRequest', (context) => {
    if (context.route.name === 'hooked') {
      context.send({ status: 202, payload: 'replied by a hook' });
    }
  });
  server.routes(contract, {
    ok: () => ({ status: 200, body: { ok: true } }),
    hooked: () => ({ status: 200, body: { ok: true } }),
    throwing: () => {
      throw new Error('handler failure');
    },
    hang: () => new Promise<never>(() => undefined),
    medium: () => ({ status: 200, body: { data: 'x'.repeat(1_000_000) } }),
    big: () => ({ status: 200, body: { data: 'x'.repeat(16_000_000) } }),
    submit: () => ({ status: 200, body: { ok: true } }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

interface Sent {
  status: number | null;
  id: string | null;
  inbound: string;
}

interface Expected {
  status?: number;
  outcome: 'completed' | 'aborted';
}

interface Points {
  start: number;
  routed?: number;
  refused?: number;
  failed?: number;
  closed: number;
}

interface Case {
  name: string;
  run: (port: number) => Promise<Sent[]>;
  expected: Expected[];
  points: Points;
  // Why: A race has no fixed split between completed and aborted, so only its count is judged.
  anyOutcome?: boolean;
  // Why: The other records the case draws besides its access records, by event name, each under its request's id.
  events?: string[];
  unanswered?: number;
  // Why: What the client sees can differ from the access records: an abort already received 200, Node answers apart.
  statuses?: number[];
}

let serial = 0;
function nextInbound(tag: string): string {
  serial++;
  return `INBOUND-${tag}-${serial}`;
}

async function exchange(port: number, tag: string, request: (inbound: string) => string): Promise<Sent> {
  const inbound = nextInbound(tag);
  const response = await rawExchange(port, request(inbound), 4000);
  return {
    status: Number.isNaN(response.status) ? null : response.status,
    id: response.headers.get('x-request-id') ?? null,
    inbound,
  };
}

function plain(method: string, path: string, extra = '', body = ''): (inbound: string) => string {
  const length = body === '' ? '' : `content-length: ${Buffer.byteLength(body)}\r\n`;
  return (inbound) =>
    `${method} ${path} HTTP/1.1\r\nhost: a.example\r\nx-request-id: ${inbound}\r\nconnection: close\r\n${extra}${length}\r\n${body}`;
}

function headOf(chunk: string | Buffer): { status: number | null; id: string | null } {
  const head = Buffer.from(chunk).toString('latin1').split('\r\n\r\n')[0] ?? '';
  const status = /^HTTP\/1\.1 (\d{3})/.exec(head);
  const id = /\r\nx-request-id: ([^\r]*)/i.exec(head);
  return { status: status?.[1] === undefined ? null : Number(status[1]), id: id?.[1] ?? null };
}

function midResponseAbort(port: number): Promise<Sent> {
  const inbound = nextInbound('abort-mid');
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let head: { status: number | null; id: string | null } | null = null;
    let received = 0;
    socket.on('error', () => undefined);
    socket.on('connect', () => {
      socket.write(`GET /big HTTP/1.1\r\nhost: a.example\r\nx-request-id: ${inbound}\r\nconnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      head ??= headOf(chunk);
      received += chunk.length;
      if (received >= 100_000) {
        socket.pause();
        setTimeout(() => socket.destroy(), 300);
      }
    });
    socket.on('close', () => resolve({ status: head?.status ?? null, id: head?.id ?? null, inbound }));
  });
}

function bodyAbort(port: number): Promise<Sent> {
  const inbound = nextInbound('abort-body');
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let answered: { status: number | null; id: string | null } | null = null;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      answered ??= headOf(chunk);
    });
    socket.on('connect', () => {
      socket.write(
        `POST /submit HTTP/1.1\r\nhost: a.example\r\ncontent-type: application/json\r\ncontent-length: 1000\r\nx-request-id: ${inbound}\r\nconnection: close\r\n\r\n{"name":"par`,
      );
      setTimeout(() => socket.destroy(), 60);
    });
    socket.on('close', () => resolve({ status: answered?.status ?? null, id: answered?.id ?? null, inbound }));
  });
}

function race(port: number, index: number): Promise<Sent> {
  const inbound = nextInbound('race');
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let head: { status: number | null; id: string | null } | null = null;
    socket.on('error', () => undefined);
    socket.on('connect', () => {
      socket.write(
        `GET ${index % 4 === 3 ? '/medium' : '/ok'} HTTP/1.1\r\nhost: a.example\r\nx-request-id: ${inbound}\r\nconnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      head ??= headOf(chunk);
      if (index % 2 === 0) {
        socket.destroy();
      } else {
        socket.resetAndDestroy();
      }
    });
    socket.on('close', () => resolve({ status: head?.status ?? null, id: head?.id ?? null, inbound }));
  });
}

async function races(port: number, total: number, workers: number): Promise<Sent[]> {
  const results: Sent[] = [];
  let next = 0;
  const work = async (): Promise<void> => {
    const index = next++;
    if (index >= total) {
      return;
    }
    results.push(await race(port, index));
    return work();
  };
  await Promise.all(Array.from({ length: workers }, () => work()));
  return results;
}

const cases: Case[] = [
  {
    name: 'success',
    run: async (port) => [await exchange(port, 'ok', plain('GET', '/ok'))],
    expected: [{ status: 200, outcome: 'completed' }],
    points: { start: 1, routed: 1, refused: 0, failed: 0, closed: 1 },
  },
  {
    name: 'not found',
    events: ['skeld.refuse.not_found'],
    run: async (port) => [await exchange(port, 'nf', plain('GET', '/nope'))],
    expected: [{ status: 404, outcome: 'completed' }],
    points: { start: 1, routed: 0, refused: 1, failed: 0, closed: 1 },
  },
  {
    name: 'framing refusal (two Host fields)',
    events: ['skeld.refuse.framing'],
    run: async (port) => [
      await exchange(
        port,
        'framing',
        (inbound) =>
          `GET /ok HTTP/1.1\r\nhost: a.example\r\nhost: b.example\r\nx-request-id: ${inbound}\r\nconnection: close\r\n\r\n`,
      ),
    ],
    expected: [{ status: 400, outcome: 'completed' }],
    points: { start: 1, routed: 0, refused: 1, failed: 0, closed: 1 },
  },
  {
    name: 'cross-site refusal',
    events: ['skeld.refuse.csrf'],
    run: async (port) => [
      await exchange(
        port,
        'csrf',
        plain('POST', '/submit', 'content-type: application/json\r\nsec-fetch-site: cross-site\r\n', '{"name":"ada"}'),
      ),
    ],
    expected: [{ status: 403, outcome: 'completed' }],
    points: { start: 1, refused: 1, failed: 0, closed: 1 },
  },
  {
    name: 'preflight (one granted, one refused)',
    events: ['skeld.refuse.preflight'],
    run: async (port) => [
      await exchange(
        port,
        'pre-ok',
        plain('OPTIONS', '/ok', `origin: ${corsOrigin}\r\naccess-control-request-method: GET\r\n`),
      ),
      await exchange(
        port,
        'pre-no',
        plain('OPTIONS', '/ok', 'origin: https://evil.example\r\naccess-control-request-method: GET\r\n'),
      ),
    ],
    expected: [
      { status: 204, outcome: 'completed' },
      { status: 403, outcome: 'completed' },
    ],
    points: { start: 2, refused: 1, failed: 0, closed: 2 },
  },
  {
    name: 'hook reply',
    run: async (port) => [await exchange(port, 'hook', plain('GET', '/hooked'))],
    expected: [{ status: 202, outcome: 'completed' }],
    points: { start: 1, routed: 1, refused: 0, failed: 0, closed: 1 },
  },
  {
    name: 'validation refusal',
    events: ['skeld.refuse.validation'],
    run: async (port) => [
      await exchange(
        port,
        'validation',
        plain('POST', '/submit', 'content-type: application/json\r\n', '{"name":123}'),
      ),
    ],
    expected: [{ status: 400, outcome: 'completed' }],
    points: { start: 1, routed: 1, refused: 1, failed: 0, closed: 1 },
  },
  {
    name: 'handler throw',
    events: ['skeld.request.error'],
    run: async (port) => [await exchange(port, 'throw', plain('GET', '/throw'))],
    expected: [{ status: 500, outcome: 'completed' }],
    points: { start: 1, routed: 1, refused: 0, failed: 1, closed: 1 },
  },
  {
    name: 'timeout',
    events: ['skeld.request.error'],
    run: async (port) => [await exchange(port, 'timeout', plain('GET', '/hang'))],
    expected: [{ status: 503, outcome: 'completed' }],
    points: { start: 1, routed: 1, refused: 0, failed: 1, closed: 1 },
  },
  {
    name: 'client abort mid-response',
    run: async (port) => [await midResponseAbort(port)],
    expected: [{ outcome: 'aborted' }],
    points: { start: 1, routed: 1, refused: 0, failed: 0, closed: 1 },
    statuses: [200],
  },
  {
    name: 'body abort',
    run: async (port) => [await bodyAbort(port)],
    expected: [{ outcome: 'aborted' }],
    points: { start: 1, routed: 1, closed: 1 },
    unanswered: 1,
  },
  {
    name: '1,000 finish-and-close races',
    run: (port) => races(port, 1000, 25),
    expected: Array.from({ length: 1000 }, () => ({ outcome: 'completed' as const })),
    points: { start: 1000, routed: 1000, refused: 0, failed: 0, closed: 1000 },
    anyOutcome: true,
  },
  {
    name: 'a request Node refuses before the engine sees it',
    run: async (port) => [
      await exchange(
        port,
        'parser-space',
        (inbound) => `GET /ok HTTP/1.1\r\nhost: a.example\r\nbad header : x\r\nx-request-id: ${inbound}\r\n\r\n`,
      ),
      await exchange(
        port,
        'parser-method',
        (inbound) => `B R E W /ok HTTP/1.1\r\nhost: a.example\r\nx-request-id: ${inbound}\r\n\r\n`,
      ),
      await exchange(
        port,
        'parser-431',
        (inbound) =>
          `GET /ok HTTP/1.1\r\nhost: a.example\r\nx-request-id: ${inbound}\r\nx-big: ${'h'.repeat(20_000)}\r\n\r\n`,
      ),
    ],
    expected: [],
    points: { start: 0, routed: 0, refused: 0, failed: 0, closed: 0 },
    unanswered: 3,
    statuses: [400, 400, 431],
  },
];

type Mode = 'plain' | 'off' | 'on' | 'silent';
const silentMs = 7000;

interface Counts {
  totals: Record<string, number>;
  keyed: Record<string, number>;
  nodeAnswered: Record<string, number>;
}

interface Run {
  mode: Mode;
  sent: Sent[];
  records: LogObject[];
  stdoutLines: number;
  counts: Counts | null;
  problems: string[];
}

const pointNames = ['start', 'routed', 'refused', 'failed', 'closed'] as const;

function readCounts(dir: string): Counts | null {
  const lines = readFileSync(join(dir, 'snapshot.jsonl'), 'utf8').trim().split('\n');
  const last = lines.at(-1);
  if (last === undefined || last === '') {
    return null;
  }
  const snapshot: unknown = JSON.parse(last);
  if (typeof snapshot !== 'object' || snapshot === null || !('counts' in snapshot)) {
    return null;
  }
  const raw = snapshot.counts;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const totals: Record<string, number> = Object.fromEntries(pointNames.map((name) => [name, 0]));
  const keyed: Record<string, number> = {};
  const nodeAnswered: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('refuse.node_answered') && typeof value === 'number' && value > 0) {
      nodeAnswered[key] = value;
    }
    const match = /^point\.([a-z]+)/.exec(key);
    if (match?.[1] === undefined || typeof value !== 'number') {
      continue;
    }
    totals[match[1]] = (totals[match[1]] ?? 0) + value;
    keyed[key] = value;
  }
  return { totals, keyed, nodeAnswered };
}

function snapshotCount(dir: string): number {
  return readFileSync(join(dir, 'snapshot.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '').length;
}

async function untilTrue(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a poll waits for the child's next write
    await delay(20);
  }
  return condition();
}

function accessRecords(child: LogChild): LogObject[] {
  return child.records().filter((record) => record.event_name === 'skeld.request.closed');
}

async function runChild(item: Case, mode: Mode): Promise<Run> {
  const problems: string[] = [];
  const diag = mode !== 'plain';
  const dir = diag ? mkdtempSync(join(tmpdir(), 'skeld-lifecycle-')) : null;
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    diag,
    env: {
      LOG_MODE: mode === 'off' ? 'off' : 'on',
      ...(dir === null ? {} : { SKELD_DIAG_DIR: dir, SKELD_DIAG_STEP_N: '1' }),
    },
    ...(mode === 'silent' ? { reader: { mode: 'silent' as const, ms: silentMs } } : {}),
  });
  let counts: Counts | null = null;
  let sent: Sent[] = [];
  try {
    sent = await item.run(child.port);
    if (mode === 'silent') {
      check(
        problems,
        child.lines().length === 0,
        `the reader was not silent: ${child.lines().length} lines reached it during the case`,
      );
    }
    if (mode === 'plain' || mode === 'on') {
      const arrived = await untilTrue(() => accessRecords(child).length >= item.expected.length, 10_000);
      check(problems, arrived, `only ${accessRecords(child).length} of ${item.expected.length} access records arrived`);
    }
    await delay(400);
    if (dir !== null) {
      const mark = snapshotCount(dir);
      const taken = await untilTrue(() => snapshotCount(dir) > mark, 8000);
      check(problems, taken, 'the recorder wrote no snapshot after the requests');
      counts = readCounts(dir);
    }
  } finally {
    await child.stop();
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    mode,
    sent,
    records: child.records(),
    stdoutLines: child.lines().length,
    counts,
    problems,
  };
}

function checkAccess(item: Case, run: Run): string[] {
  const problems: string[] = [];
  const access = run.records.filter((record) => record.event_name === 'skeld.request.closed');
  check(
    problems,
    access.length === item.expected.length,
    `${access.length} access records for ${item.expected.length} requests`,
  );
  const outcomes = access.map((record) => String(record['skeld.outcome']));
  if (item.anyOutcome === true) {
    check(
      problems,
      outcomes.every((outcome) => outcome === 'completed' || outcome === 'aborted'),
      'an access record has an outcome other than completed or aborted',
    );
  } else {
    for (const outcome of ['completed', 'aborted'] as const) {
      const wanted = item.expected.filter((entry) => entry.outcome === outcome).length;
      const got = outcomes.filter((candidate) => candidate === outcome).length;
      check(problems, got === wanted, `${got} access records say ${outcome}, expected ${wanted}`);
    }
    const statuses = access.flatMap((record) =>
      typeof record['http.response.status_code'] === 'number' ? [record['http.response.status_code']] : [],
    );
    const wantedStatuses = item.expected.flatMap((entry) => (entry.status === undefined ? [] : [entry.status])).sort();
    const answered = access.filter((record) => record['skeld.outcome'] === 'completed');
    check(
      problems,
      JSON.stringify(answered.map((record) => record['http.response.status_code']).sort()) ===
        JSON.stringify(wantedStatuses),
      `completed access records carry statuses ${JSON.stringify(answered.map((record) => record['http.response.status_code']))}, expected ${JSON.stringify(wantedStatuses)} (all ${JSON.stringify(statuses)})`,
    );
  }
  const ids = access.map((record) => String(record['skeld.request_id']));
  check(problems, new Set(ids).size === ids.length, 'two access records share a request id');
  return problems;
}

function checkIds(item: Case, run: Run): string[] {
  const problems: string[] = [];
  const answered = run.sent.filter((entry) => entry.id !== null);
  if (item.anyOutcome !== true) {
    const wanted = run.sent.length - (item.unanswered ?? 0);
    check(
      problems,
      answered.length === wanted,
      `${answered.length} responses carried an x-request-id, expected ${wanted}`,
    );
  }
  for (const entry of answered) {
    check(problems, entry.id !== entry.inbound, `a response carried the inbound id ${entry.inbound}`);
  }
  return problems;
}

function checkRecordIds(item: Case, run: Run): string[] {
  const problems: string[] = [];
  const issued = new Set(run.sent.flatMap((entry) => (entry.id === null ? [] : [entry.id])));
  const inbound = new Set(run.sent.map((entry) => entry.inbound));
  const scoped = run.records.filter((record) => 'skeld.request_id' in record);
  const unknown = scoped.filter((record) => !issued.has(String(record['skeld.request_id'])));
  const unanswered = run.sent.filter((entry) => entry.id === null).length;
  const aborted = item.expected.filter((entry) => entry.outcome === 'aborted').length;
  const allowance = item.anyOutcome === true ? 1000 : Math.max(unanswered, aborted) * 8;
  check(problems, unknown.length <= allowance, `${unknown.length} request records carry an id no response carried`);
  if (item.events !== undefined) {
    const others = scoped.filter(
      (record) => record.event_name !== 'skeld.request.closed' && issued.has(String(record['skeld.request_id'])),
    );
    const got = others.map((record) => String(record.event_name)).sort();
    check(
      problems,
      JSON.stringify(got) === JSON.stringify([...item.events].sort()),
      `records besides the access record: ${JSON.stringify(got)}, expected ${JSON.stringify(item.events)}`,
    );
  }
  for (const record of scoped) {
    check(
      problems,
      !inbound.has(String(record['skeld.request_id'])),
      'a record carries an inbound id as its request id',
    );
  }
  if (item.anyOutcome !== true) {
    for (const entry of run.sent) {
      if (entry.id === null) {
        continue;
      }
      const mine = scoped.filter((record) => record['skeld.request_id'] === entry.id);
      const mineAccess = mine.filter((record) => record.event_name === 'skeld.request.closed');
      check(
        problems,
        mineAccess.length === 1,
        `request ${entry.inbound}: ${mineAccess.length} access records under its response id`,
      );
      check(problems, mine.length >= 1, `request ${entry.inbound}: no record under its response id`);
    }
  } else {
    const byId = new Map<string, number>();
    for (const record of scoped.filter((candidate) => candidate.event_name === 'skeld.request.closed')) {
      byId.set(String(record['skeld.request_id']), (byId.get(String(record['skeld.request_id'])) ?? 0) + 1);
    }
    const missing = [...issued].filter((id) => byId.get(id) !== 1);
    check(
      problems,
      missing.length === 0,
      `${missing.length} of ${issued.size} response ids lack exactly one access record`,
    );
  }
  return problems;
}

function checkPoints(item: Case, runs: Run[]): string[] {
  const problems: string[] = [];
  const diagRuns = runs.filter((run) => run.mode !== 'plain');
  const reference = diagRuns.find((run) => run.mode === 'off');
  for (const run of diagRuns) {
    if (run.counts === null) {
      problems.push(`${run.mode}: no point counts could be read`);
      continue;
    }
    const totals = run.counts.totals;
    for (const name of pointNames) {
      const wanted = item.points[name];
      if (wanted !== undefined) {
        check(problems, totals[name] === wanted, `${run.mode}: point.${name} is ${totals[name]}, expected ${wanted}`);
      }
      const base = reference?.counts?.totals[name];
      check(
        problems,
        base !== undefined && totals[name] === base,
        `${run.mode}: point.${name} is ${totals[name]}, with the log off it is ${base}`,
      );
    }
    if (item.anyOutcome !== true && reference?.counts != null) {
      check(
        problems,
        JSON.stringify(Object.entries(run.counts.keyed).sort()) ===
          JSON.stringify(Object.entries(reference.counts.keyed).sort()),
        `${run.mode}: the keyed point counts ${JSON.stringify(run.counts.keyed)} differ from the log off ${JSON.stringify(reference.counts.keyed)}`,
      );
    }
  }
  return problems;
}

function accessSplit(run: Run): string {
  const access = run.records.filter((record) => record.event_name === 'skeld.request.closed');
  const aborted = access.filter((record) => record['skeld.outcome'] === 'aborted').length;
  return `${access.length} access records (${access.length - aborted} completed, ${aborted} aborted)`;
}

function describePoints(runs: Run[]): string {
  return runs
    .filter((run) => run.mode !== 'plain' && run.counts !== null)
    .map((run) => {
      const answered = Object.entries(run.counts?.nodeAnswered ?? {});
      const node = answered.length === 0 ? '' : ` (${answered.map(([key, count]) => `${key} ${count}`).join(', ')})`;
      return `${run.mode} ${pointNames.map((name) => `${name} ${run.counts?.totals[name]}`).join(' ')}${node}`;
    })
    .join('; ');
}

async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const step = async (from: number): Promise<void> => {
    if (from >= items.length) {
      return;
    }
    results.push(...(await Promise.all(items.slice(from, from + size).map(work))));
    return step(from + size);
  };
  await step(0);
  return results;
}

async function main(): Promise<void> {
  const report = createReport('log-lifecycle');
  const modes: Mode[] = ['plain', 'off', 'on', 'silent'];
  const outcomes = await inBatches(cases, 3, async (item) => ({
    item,
    runs: await Promise.all(modes.map((mode) => runChild(item, mode))),
  }));
  for (const { item, runs } of outcomes) {
    const byMode = (mode: Mode): Run => {
      const found = runs.find((run) => run.mode === mode);
      if (found === undefined) {
        throw new Error(`no ${mode} run for ${item.name}`);
      }
      return found;
    };
    const plainRun = byMode('plain');
    const onRun = byMode('on');
    const offRun = byMode('off');

    const accessProblems = [
      ...runs.flatMap((run) => run.problems.map((problem) => `${run.mode}: ${problem}`)),
      ...checkAccess(item, plainRun).map((problem) => `plain build: ${problem}`),
      ...checkAccess(item, onRun).map((problem) => `diag build, log on: ${problem}`),
    ];
    check(accessProblems, offRun.stdoutLines === 0, `with the log off stdout held ${offRun.stdoutLines} lines`);
    check(
      accessProblems,
      offRun.records.length === 0,
      `with the log off ${offRun.records.length} records were written`,
    );
    if (item.anyOutcome !== true) {
      const wanted = [
        ...(item.statuses ?? item.expected.flatMap((entry) => (entry.status === undefined ? [] : [entry.status]))),
      ].sort();
      for (const run of runs) {
        const seen = run.sent.flatMap((entry) => (entry.status === null ? [] : [entry.status])).sort();
        check(
          accessProblems,
          JSON.stringify(seen) === JSON.stringify(wanted),
          `${run.mode}: responses ${JSON.stringify(seen)}, expected ${JSON.stringify(wanted)}`,
        );
      }
    }
    report.result(
      `AC-4 ${item.name}: exactly one access record per request, none with the log off`,
      accessProblems,
      `${item.expected.length} request(s), plain build ${accessSplit(plainRun)}, diag build ${accessSplit(onRun)}; log off wrote ${offRun.stdoutLines} lines; every mode answered the same statuses`,
    );

    const idProblems = [
      ...runs.flatMap((run) => checkIds(item, run).map((problem) => `${run.mode}: ${problem}`)),
      ...checkRecordIds(item, plainRun).map((problem) => `plain build: ${problem}`),
      ...checkRecordIds(item, onRun).map((problem) => `diag build, log on: ${problem}`),
    ];
    report.result(
      `AC-5 ${item.name}: x-request-id equals the request id on its records and never the inbound value`,
      idProblems,
      `${runs.map((run) => `${run.mode} ${run.sent.filter((entry) => entry.id !== null).length} of ${run.sent.length} responses carry an id`).join(', ')}; each id is on exactly one access record of its request and on no inbound value`,
    );

    const pointProblems = checkPoints(item, runs);
    report.result(
      `AC-4 ${item.name}: lifecycle points count the same with the log off, on and the reader silent`,
      pointProblems,
      describePoints(runs),
    );
  }
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
