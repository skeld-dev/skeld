// Does:  Proves a request flood writes at most 20 records per event and route in a 10 s window plus one exact summary.
// Holds: The summary is awaited with no request after the flood, and the stats call counts the rest as suppressed.

// biome-ignore-all lint/security/noSecrets: route templates and event names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: the summary is awaited by polling the child's stdout
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';

type Variant = 'refusal' | 'throws' | 'unknown';

const flood = 10_000;
const windowMs = 10_000;
const perWindow = 20;
const reportShape = t.object({ report: t.string({ maxLength: 2000 }) });
const contract = defineContract({
  items: { method: 'POST', path: '/items', responses: { 200: t.object({ ok: t.boolean() }) } },
  boom: { method: 'GET', path: '/boom', responses: { 200: t.object({ ok: t.boolean() }) } },
  stats: { method: 'GET', path: '/stats', responses: { 200: reportShape } },
  formatted: { method: 'GET', path: '/formatted', responses: { 200: reportShape } },
});

function serve(variant: Variant): void {
  let formatted = 0;
  if (variant === 'throws') {
    Error.prepareStackTrace = (error, sites) => {
      formatted++;
      return [Error.prototype.toString.call(error), ...sites.map((site) => `    at ${String(site)}`)].join('\n');
    };
  }
  const options =
    variant === 'throws'
      ? { errorFrames: true }
      : variant === 'unknown'
        ? { thresholds: { security: 'info' as const } }
        : {};
  const server = createServer({ log: options });
  server.routes(contract, {
    items: () => ({ status: 200, body: { ok: true } }),
    boom: () => {
      throw new Error('boom');
    },
    stats: () => ({ status: 200, body: { report: JSON.stringify(server.logStats()) } }),
    formatted: () => ({ status: 200, body: { report: JSON.stringify({ formatted }) } }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => {
      process.on('SIGTERM', () => void closeAndExit(server));
      announceListening(port);
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

async function closeAndExit(server: { close: () => Promise<void> }): Promise<void> {
  await server.close();
  process.exit(0);
}

interface Burst {
  startedAt: number;
  endedAt: number;
  statuses: Map<number, number>;
}

interface Shape {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  pathOf: (index: number) => string;
}

function once(
  agent: http.Agent,
  port: number,
  shape: Shape,
  index: number,
  statuses: Map<number, number>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      host: '127.0.0.1',
      port,
      path: shape.pathOf(index),
      method: shape.method,
      headers: shape.headers,
      agent,
    };
    const req = http.request(options, (res) => {
      const status = res.statusCode ?? 0;
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
      res.resume();
      res.once('end', resolve);
    });
    req.once('error', reject);
    req.end();
  });
}

async function sendFlood(port: number, shape: Shape): Promise<Burst> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const statuses = new Map<number, number>();
  let next = 0;
  const startedAt = Date.now();
  const worker = async (): Promise<void> => {
    for (let index = next++; index < flood; index = next++) {
      await once(agent, port, shape, index, statuses);
    }
  };
  await Promise.all(Array.from({ length: 64 }, () => worker()));
  const endedAt = Date.now();
  agent.destroy();
  return { startedAt, endedAt, statuses };
}

function statusLine(statuses: Map<number, number>): string {
  return [...statuses.entries()].map(([status, count]) => `${count} x ${status}`).join(', ');
}

async function getReport(port: number, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const body: unknown = await response.json();
  const text = typeof body === 'object' && body !== null ? Reflect.get(body, 'report') : undefined;
  const parsed: unknown = JSON.parse(String(text));
  return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
}

interface Waited {
  summarySeen: number | null;
  summary: LogObject | null;
}

async function awaitSummary(child: LogChild, eventName: string, ms: number): Promise<Waited> {
  const result: Waited = { summarySeen: null, summary: null };
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const now = Date.now();
    const records = child.records();
    const summary = records.find(
      (rec) => rec.event_name === 'skeld.log.suppressed' && rec['skeld.suppressed.event_name'] === eventName,
    );
    if (summary !== undefined) {
      result.summarySeen = now;
      result.summary = summary;
      return result;
    }
    await delay(5);
  }
  return result;
}

interface Scenario {
  name: string;
  variant: Variant;
  eventName: string;
  route: string | null;
  shape: Shape;
  expectedStatus: number;
  frames: boolean;
}

const scenarios: Scenario[] = [
  {
    name: 'one refusal on one route',
    variant: 'refusal',
    eventName: 'skeld.refuse.csrf',
    route: '/items',
    shape: { method: 'POST', headers: { origin: 'http://evil.example' }, pathOf: () => '/items' },
    expectedStatus: 403,
    frames: false,
  },
  {
    name: 'one handler that throws',
    variant: 'throws',
    eventName: 'skeld.request.error',
    route: '/boom',
    shape: { method: 'GET', headers: {}, pathOf: () => '/boom' },
    expectedStatus: 500,
    frames: true,
  },
  {
    name: 'distinct unknown paths',
    variant: 'unknown',
    eventName: 'skeld.refuse.not_found',
    route: null,
    shape: { method: 'GET', headers: {}, pathOf: (index) => `/unknown-${index}` },
    expectedStatus: 404,
    frames: false,
  },
];

function routeOf(record: LogObject): unknown {
  return record['http.route'];
}

async function runScenario(scenario: Scenario, report: ReturnType<typeof createReport>): Promise<void> {
  const label = `AC-10 ${scenario.name}`;
  const child = await startLogChild(fileURLToPath(import.meta.url), { args: [scenario.variant] });
  let burst: Burst;
  let waited: Waited;
  let stats: Record<string, unknown> = {};
  let formatted: number | null = null;
  try {
    burst = await sendFlood(child.port, scenario.shape);
    waited = await awaitSummary(child, scenario.eventName, 25_000);
    stats = await getReport(child.port, '/stats');
    if (scenario.variant === 'throws') {
      formatted = Number((await getReport(child.port, '/formatted')).formatted);
    }
  } finally {
    await child.stop();
  }
  const records = child.records();
  const own = records.filter(
    (rec) => rec.event_name === scenario.eventName && routeOf(rec) === (scenario.route ?? undefined),
  );
  const summaries = records.filter(
    (rec) => rec.event_name === 'skeld.log.suppressed' && rec['skeld.suppressed.event_name'] === scenario.eventName,
  );

  const before: string[] = [];
  const flightMs = burst.endedAt - burst.startedAt;
  const firstTime = own[0] === undefined ? Number.NaN : Date.parse(String(own[0].time));
  check(before, burst.statuses.get(scenario.expectedStatus) === flood, `statuses were ${statusLine(burst.statuses)}`);
  check(before, flightMs < windowMs, `the ${flood} requests took ${flightMs} ms, not inside one ${windowMs} ms window`);
  check(
    before,
    burst.endedAt - firstTime < windowMs,
    `the last response came ${burst.endedAt - firstTime} ms after the first record`,
  );
  report.result(
    `${label}: the ${flood} requests all drew ${scenario.expectedStatus} inside one window`,
    before,
    `${statusLine(burst.statuses)} in ${flightMs} ms; the last response ${burst.endedAt - firstTime} ms after the first record`,
  );

  const written: string[] = [];
  check(
    written,
    own.length >= 1 && own.length <= perWindow,
    `${own.length} records of ${scenario.eventName}, not 1 to ${perWindow}`,
  );
  if (scenario.variant === 'unknown') {
    check(
      written,
      own.every((rec) => !('http.route' in rec)),
      'a not-found record names a route',
    );
  }
  report.result(
    `${label}: at most ${perWindow} records written`,
    written,
    `${own.length} records of ${scenario.eventName} on stdout`,
  );

  const summary: string[] = [];
  const sample = waited.summary;
  check(summary, summaries.length === 1, `${summaries.length} summaries on stdout`);
  check(summary, sample !== null, 'no summary arrived while no request was sent');
  if (sample !== null && waited.summarySeen !== null) {
    const arrivedAfter = waited.summarySeen - firstTime;
    const recordGap = Date.parse(String(sample.time)) - firstTime;
    check(summary, arrivedAfter <= windowMs * 1.5, `the summary arrived ${arrivedAfter} ms after the first record`);
    check(summary, recordGap <= windowMs * 1.5, `the summary is stamped ${recordGap} ms after the first record`);
    check(
      summary,
      sample['skeld.suppressed.count'] === flood - own.length,
      `the summary counts ${String(sample['skeld.suppressed.count'])}, expected ${flood - own.length}`,
    );
    check(
      summary,
      routeOf(sample) === (scenario.route ?? undefined),
      `the summary names route ${String(routeOf(sample))}`,
    );
    check(
      summary,
      sample.severity_text !== undefined && sample['skeld.category'] !== undefined,
      'the summary lacks its severity or category',
    );
    report.result(
      `${label}: one summary counting the rest, within 1.5 windows, with no further request`,
      summary,
      `reached the reader ${arrivedAfter} ms after the first record's own time, stamped ${recordGap} ms after it; counts ${String(sample['skeld.suppressed.count'])} = ${flood} - ${own.length}`,
    );
  } else {
    report.result(`${label}: one summary counting the rest, within 1.5 windows, with no further request`, summary, '');
  }

  if (scenario.frames) {
    const formatting: string[] = [];
    check(
      formatting,
      formatted !== null && formatted >= 1 && formatted <= perWindow,
      `${formatted} stacks formatted, not 1 to ${perWindow}`,
    );
    check(
      formatting,
      own.length > 0 && own.every((rec) => typeof rec['exception.stacktrace'] === 'string'),
      'a written error record holds no frames, so errorFrames did not run',
    );
    report.result(
      `${label}: at most ${perWindow} formatted stacks, counted by a formatter that defers to Node's`,
      formatting,
      `${formatted} stacks formatted for ${flood} throws; ${own.length} records hold frames`,
    );
  }

  const counted: string[] = [];
  const dropped = stats.dropped;
  const droppedTotal =
    typeof dropped === 'object' && dropped !== null
      ? Object.values(dropped).reduce<number>((sum, value) => sum + Number(value), 0)
      : Number.NaN;
  check(
    counted,
    stats.suppressed === flood - own.length,
    `suppressed is ${String(stats.suppressed)}, expected ${flood - own.length}`,
  );
  check(counted, droppedTotal === 0, `dropped counts sum to ${droppedTotal}`);
  const accounted = Number(stats.written) + Number(stats.queued) + Number(stats.inFlight) + droppedTotal;
  check(counted, stats.created === accounted, `created ${String(stats.created)} is not the sum ${accounted}`);
  report.result(
    `${label}: the stats call reports the rest as suppressed, not dropped`,
    counted,
    `suppressed ${String(stats.suppressed)}, dropped ${droppedTotal}, created ${String(stats.created)} = written + queued + in flight`,
  );

  if (scenario.variant === 'unknown') {
    const keys: string[] = [];
    check(
      keys,
      own.length <= perWindow && summaries.length === 1,
      `${own.length} records and ${summaries.length} summaries for ${flood} distinct paths`,
    );
    check(keys, !('http.route' in (sample ?? {})), 'the summary names a route');
    report.result(
      `${label}: no new suppression key for ${flood} distinct unknown paths`,
      keys,
      `${flood} paths gave ${own.length} records and one summary with no route; a key per path would have written ${flood}`,
    );
  }
}

async function main(): Promise<void> {
  const report = createReport('log-suppression');
  for (const scenario of scenarios) {
    await runScenario(scenario, report);
  }
  report.finish();
}

if (process.argv[2] === 'serve') {
  const variant = (['refusal', 'throws', 'unknown'] as const).find((candidate) => candidate === process.argv[3]);
  if (variant === undefined) {
    process.stderr.write(`unknown variant ${String(process.argv[3])}\n`);
    process.exitCode = 1;
  } else {
    serve(variant);
  }
} else {
  await main();
}
