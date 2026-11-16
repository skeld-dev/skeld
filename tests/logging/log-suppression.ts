// Does:  Proves two suppression keys in one window each write 20 records and, unprompted, one summary of the rest.
// Holds: No request follows the floods, so each summary is the window's own; distinct unknown paths share one key.

// biome-ignore-all lint/security/noSecrets: route templates and event names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: the summaries are awaited by polling the child's stdout
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';

const perWindow = 20;
const flood = 25;
// Why: The window is 10 s from its first record; a summary later than 1.5 windows was not written at expiry.
const summaryWaitMs = 15_000;
const contract = defineContract({
  items: { method: 'POST', path: '/items', responses: { 200: t.object({ ok: t.boolean() }) } },
  stats: { method: 'GET', path: '/stats', responses: { 200: t.object({ report: t.string({ maxLength: 2000 }) }) } },
});

function serve(): void {
  const server = createServer({ log: { thresholds: { security: 'info' } } });
  server.routes(contract, {
    items: () => ({ status: 200, body: { ok: true } }),
    stats: () => ({ status: 200, body: { report: JSON.stringify(server.logStats()) } }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

function send(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode ?? 0));
    });
    req.once('error', reject);
    req.end();
  });
}

interface Key {
  name: string;
  event: string;
  route: string | undefined;
  status: number;
  request: (port: number, index: number) => Promise<number>;
}

const keys: Key[] = [
  {
    name: 'one cross-site refusal on one route',
    event: 'skeld.refuse.csrf',
    route: '/items',
    status: 403,
    request: (port) => send(port, 'POST', '/items', { origin: 'http://evil.example' }),
  },
  {
    name: 'distinct unknown paths, one key with no route',
    event: 'skeld.refuse.not_found',
    route: undefined,
    status: 404,
    request: (port, index) => send(port, 'GET', `/unknown-${index}`),
  },
];

const summaryOf = (records: LogObject[], event: string): LogObject[] =>
  records.filter((rec) => rec.event_name === 'skeld.log.suppressed' && rec['skeld.suppressed.event_name'] === event);

async function main(): Promise<void> {
  const report = createReport();
  const child = await startLogChild(fileURLToPath(import.meta.url));
  let statuses: number[][] = [];
  let stats: Record<string, unknown> = {};
  let unprompted = false;
  try {
    statuses = await Promise.all(
      keys.map((key) => Promise.all(Array.from({ length: flood }, (_, index) => key.request(child.port, index)))),
    );
    const reply = await fetch(`http://127.0.0.1:${child.port}/stats`);
    stats = JSON.parse(JSON.parse(await reply.text()).report);
    const deadline = Date.now() + summaryWaitMs;
    while (!unprompted && Date.now() < deadline) {
      await delay(50);
      unprompted = keys.every((key) => summaryOf(child.records(), key.event).length > 0);
    }
  } finally {
    await child.stop('SIGKILL');
  }
  const records = child.records();
  keys.forEach((key, at) => {
    const problems: string[] = [];
    const answered = (statuses[at] ?? []).filter((status) => status === key.status).length;
    check(problems, answered === flood, `${answered} of ${flood} requests answered ${key.status}`);
    const own = records.filter((rec) => rec.event_name === key.event);
    check(problems, own.length === perWindow, `${own.length} ${key.event} records, not ${perWindow}`);
    check(
      problems,
      own.every((rec) => rec['http.route'] === key.route),
      `a record names a route other than ${key.route}`,
    );
    const summaries = summaryOf(records, key.event);
    const [summary] = summaries;
    check(problems, summaries.length === 1, `${summaries.length} summaries without a further request or close()`);
    check(
      problems,
      summary?.['skeld.suppressed.count'] === flood - perWindow,
      `the summary counts ${String(summary?.['skeld.suppressed.count'])}, not ${flood - perWindow}`,
    );
    check(
      problems,
      summary?.['http.route'] === key.route,
      `the summary names route ${String(summary?.['http.route'])}`,
    );
    check(
      problems,
      summary?.severity_text === own[0]?.severity_text && summary?.['skeld.category'] === own[0]?.['skeld.category'],
      'the summary does not carry the severity and category of the suppressed event',
    );
    report.result(key.name, problems, `${own.length} records written and one summary of ${flood - perWindow}`);
  });
  const dropped = stats.dropped;
  const droppedTotal =
    typeof dropped === 'object' && dropped !== null
      ? Object.values(dropped).reduce<number>((sum, value) => sum + Number(value), 0)
      : Number.NaN;
  const counted: string[] = [];
  const suppressed = keys.length * (flood - perWindow);
  check(counted, stats.suppressed === suppressed, `suppressed is ${String(stats.suppressed)}, not ${suppressed}`);
  check(counted, droppedTotal === 0, `dropped counts sum to ${droppedTotal}`);
  const accounted = Number(stats.written) + Number(stats.queued) + Number(stats.inFlight) + droppedTotal;
  check(counted, stats.created === accounted, `created ${String(stats.created)} is not the sum ${accounted}`);
  report.result('the stats call counts the rest as suppressed, not dropped', counted, `suppressed ${suppressed}`);
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
