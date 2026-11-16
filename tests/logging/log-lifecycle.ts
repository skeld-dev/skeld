// Does:  Proves each request yields one access record and one response id that is never the inbound value.
// Holds: Every case runs in its own server child, so the records of a case are exactly that case's.

import net from 'node:net';
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
    log: { access: true, thresholds: { security: 'info' } },
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

interface Case {
  name: string;
  run: (port: number) => Promise<Sent[]>;
  expected: Expected[];
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
  },
  {
    name: 'not found',
    events: ['skeld.refuse.not_found'],
    run: async (port) => [await exchange(port, 'nf', plain('GET', '/nope'))],
    expected: [{ status: 404, outcome: 'completed' }],
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
  },
  {
    name: 'hook reply',
    run: async (port) => [await exchange(port, 'hook', plain('GET', '/hooked'))],
    expected: [{ status: 202, outcome: 'completed' }],
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
  },
  {
    name: 'handler throw',
    events: ['skeld.request.error'],
    run: async (port) => [await exchange(port, 'throw', plain('GET', '/throw'))],
    expected: [{ status: 500, outcome: 'completed' }],
  },
  {
    name: 'timeout',
    events: ['skeld.request.error'],
    run: async (port) => [await exchange(port, 'timeout', plain('GET', '/hang'))],
    expected: [{ status: 503, outcome: 'completed' }],
  },
  {
    name: 'client abort mid-response',
    run: async (port) => [await midResponseAbort(port)],
    expected: [{ outcome: 'aborted' }],
    statuses: [200],
  },
  {
    name: 'body abort',
    run: async (port) => [await bodyAbort(port)],
    expected: [{ outcome: 'aborted' }],
    unanswered: 1,
  },
  {
    name: '1,000 finish-and-close races',
    run: (port) => races(port, 1000, 25),
    expected: Array.from({ length: 1000 }, () => ({ outcome: 'completed' as const })),
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
    unanswered: 3,
    statuses: [400, 400, 431],
  },
];

interface Run {
  sent: Sent[];
  records: LogObject[];
  stdoutLines: number;
  problems: string[];
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

async function runChild(item: Case): Promise<Run> {
  const problems: string[] = [];
  const child = await startLogChild(fileURLToPath(import.meta.url));
  let sent: Sent[] = [];
  try {
    sent = await item.run(child.port);
    const arrived = await untilTrue(() => accessRecords(child).length >= item.expected.length, 10_000);
    check(problems, arrived, `only ${accessRecords(child).length} of ${item.expected.length} access records arrived`);
    await delay(400);
  } finally {
    await child.stop();
  }
  return {
    sent,
    records: child.records(),
    stdoutLines: child.lines().length,
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

function accessSplit(run: Run): string {
  const access = run.records.filter((record) => record.event_name === 'skeld.request.closed');
  const aborted = access.filter((record) => record['skeld.outcome'] === 'aborted').length;
  return `${access.length} access records (${access.length - aborted} completed, ${aborted} aborted)`;
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
  const outcomes = await inBatches(cases, 3, async (item) => ({ item, run: await runChild(item) }));
  for (const { item, run } of outcomes) {
    const accessProblems = [...run.problems, ...checkAccess(item, run)];
    if (item.anyOutcome !== true) {
      const wanted = [
        ...(item.statuses ?? item.expected.flatMap((entry) => (entry.status === undefined ? [] : [entry.status]))),
      ].sort();
      const seen = run.sent.flatMap((entry) => (entry.status === null ? [] : [entry.status])).sort();
      check(
        accessProblems,
        JSON.stringify(seen) === JSON.stringify(wanted),
        `responses ${JSON.stringify(seen)}, expected ${JSON.stringify(wanted)}`,
      );
    }
    report.result(
      `AC-4 ${item.name}: exactly one access record per request`,
      accessProblems,
      `${item.expected.length} request(s), ${accessSplit(run)}; the responses carried the expected statuses`,
    );

    const idProblems = [...checkIds(item, run), ...checkRecordIds(item, run)];
    report.result(
      `AC-5 ${item.name}: x-request-id equals the request id on its records and never the inbound value`,
      idProblems,
      `${run.sent.filter((entry) => entry.id !== null).length} of ${run.sent.length} responses carry an id; each id is on exactly one access record of its request and on no inbound value`,
    );
  }
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
