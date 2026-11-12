// Does:  Proves a service's stdout, read by Collector contrib v0.165.0 with the documented configuration, maps.
// Holds: Every destination record is compared with its source line; the Collector is stopped on every exit.

// biome-ignore-all lint/security/noSecrets: route templates, event names and OTLP field names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: polling waits are taken one after another
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogObject, startLogChild } from './support-log.ts';
import { check, createReport, type Report } from './support-proof.ts';
import { request as wireRequest } from './support-wire.ts';

const expectedVersion = '0.165.0';
const usage =
  'usage: node --conditions=skeld-source tests/acceptance/log-collector.ts --collector <path to otelcol-contrib>';
const exitUsage = 2;
const exitVersion = 3;
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const configPath = join(sourceRoot, 'docs/logging/collector.yaml');
const exportWaitMs = 30_000;
const stopWaitMs = 15_000;
const traceId = '0af7651916cd43dd8448eb211c80319c';
const traceparent = `00-${traceId}-b7ad6b7169203331-01`;

const contract = defineContract({
  hello: { method: 'GET', path: '/hi', responses: { 200: t.object({ ok: t.boolean() }) } },
});

function serve(): void {
  const server = createServer({ log: { access: true, correlation: true } });
  server.routes(contract, {
    hello: ({ log }) => {
      log.info('hello from the handler', { visits: 7, kind: 'proof' });
      return { status: 200, body: { ok: true } };
    },
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

type Obj = Record<string, unknown>;

interface Destination {
  raw: Obj;
  attributes: Map<string, Obj>;
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objects(value: unknown): Obj[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function refuse(code: number, message: string): never {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exit(code);
}

function collectorArgument(argv: readonly string[]): string {
  const at = argv.indexOf('--collector');
  const value = at === -1 ? undefined : argv[at + 1];
  if (value === undefined || value === '' || value.startsWith('--')) {
    return refuse(exitUsage, '--collector <path> is required');
  }
  return value;
}

// Does:  Refuses to run, with a usage line and a distinct exit status, unless the binary reports the pinned version.
function versionLine(binary: string): string {
  const run = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  if (run.error) {
    return refuse(exitVersion, `cannot run ${binary} --version: ${run.error.message}`);
  }
  const line = run.stdout.trim().split('\n')[0] ?? '';
  if (line !== `otelcol-contrib version ${expectedVersion}`) {
    return refuse(exitVersion, `${binary} --version printed "${line}", not version ${expectedVersion}`);
  }
  return line;
}

function destinationOf(raw: Obj): Destination {
  const attributes = new Map<string, Obj>();
  for (const entry of objects(raw.attributes)) {
    if (typeof entry.key === 'string' && isObject(entry.value)) {
      attributes.set(entry.key, entry.value);
    }
  }
  return { raw, attributes };
}

function destinationRecords(text: string): Destination[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const resources = lines.flatMap((line) => objects([JSON.parse(line)]));
  const scopes = resources.flatMap((resource) => objects(resource.resourceLogs).flatMap((r) => objects(r.scopeLogs)));
  return scopes.flatMap((scope) => objects(scope.logRecords)).map(destinationOf);
}

function describe(value: unknown): string {
  return `${typeof value} ${JSON.stringify(value)}`;
}

function compareTimeAndSeverity(source: LogObject, raw: Obj, problems: string[]): void {
  const instant = BigInt(Date.parse(String(source.time))) * 1_000_000n;
  check(
    problems,
    typeof raw.timeUnixNano === 'string' && /^\d+$/.test(raw.timeUnixNano) && BigInt(raw.timeUnixNano) === instant,
    `Timestamp ${describe(raw.timeUnixNano)} is not the instant of ${String(source.time)} (${instant} ns)`,
  );
  check(
    problems,
    typeof source.severity_number === 'number' &&
      typeof raw.severityNumber === 'number' &&
      raw.severityNumber === source.severity_number,
    `SeverityNumber ${describe(raw.severityNumber)} is not the number ${describe(source.severity_number)}`,
  );
  check(
    problems,
    typeof source.severity_text === 'string' && raw.severityText === source.severity_text,
    `SeverityText ${describe(raw.severityText)} is not the string ${describe(source.severity_text)}`,
  );
  check(
    problems,
    typeof source.event_name === 'string' && raw.eventName === source.event_name,
    `EventName ${describe(raw.eventName)} is not the string ${describe(source.event_name)}`,
  );
  if (typeof source.message === 'string') {
    const body = isObject(raw.body) ? raw.body.stringValue : undefined;
    check(
      problems,
      body === source.message,
      `Body ${describe(raw.body)} is not the string ${describe(source.message)}`,
    );
  }
}

function compareIds(source: LogObject, destination: Destination, problems: string[]): void {
  const sourceId = source['skeld.request_id'];
  const idValue = destination.attributes.get('skeld.request_id');
  check(
    problems,
    sourceId === undefined ? idValue === undefined : idValue?.stringValue === sourceId,
    `attribute skeld.request_id is ${describe(idValue)}, source has ${describe(sourceId)} (a string attribute)`,
  );
  const sourceInbound = source['http.request.header.x-request-id'];
  const inbound = destination.attributes.get('http.request.header.x-request-id');
  const values = isObject(inbound?.arrayValue) ? objects(inbound.arrayValue.values) : [];
  const expected = Array.isArray(sourceInbound) ? sourceInbound[0] : undefined;
  check(
    problems,
    sourceInbound === undefined ? inbound === undefined : values.length === 1 && values[0]?.stringValue === expected,
    `attribute http.request.header.x-request-id is ${describe(inbound)}, source has ${describe(sourceInbound)}`,
  );
}

function compareTrace(source: LogObject, raw: Obj, problems: string[]): void {
  if (typeof source.trace_id !== 'string') {
    check(
      problems,
      raw.traceId === undefined || raw.traceId === '',
      `TraceId ${describe(raw.traceId)} without context`,
    );
    check(problems, raw.flags === undefined || raw.flags === 0, `TraceFlags ${describe(raw.flags)} without context`);
    return;
  }
  check(problems, raw.traceId === source.trace_id, `TraceId ${describe(raw.traceId)} is not ${source.trace_id}`);
  const flags = Number.parseInt(String(source.trace_flags), 16);
  check(
    problems,
    typeof raw.flags === 'number' && raw.flags % 256 === flags,
    `TraceFlags ${describe(raw.flags)} do not hold ${String(source.trace_flags)}`,
  );
}

function compare(source: LogObject, destination: Destination): string[] {
  const problems: string[] = [];
  compareTimeAndSeverity(source, destination.raw, problems);
  compareIds(source, destination, problems);
  compareTrace(source, destination.raw, problems);
  return problems;
}

async function stopCollector(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), stopWaitMs);
  const [code] = await exited;
  clearTimeout(timer);
  return typeof code === 'number' ? code : null;
}

// Does:  Runs the service, sends one request with trace context and one without, and returns its stdout text.
async function serviceOutput(report: Report, ids: { traced: string; plain: string }): Promise<string> {
  const service = await startLogChild(fileURLToPath(import.meta.url));
  try {
    const traced = await wireRequest(service.port, 'GET', '/hi', [
      `traceparent: ${traceparent}`,
      `x-request-id: ${ids.traced}`,
    ]);
    const plain = await wireRequest(service.port, 'GET', '/hi', [`x-request-id: ${ids.plain}`]);
    const statuses = `statuses ${traced.status} and ${plain.status}`;
    report.result(
      'service answers both requests',
      traced.status === 200 && plain.status === 200 ? [] : [statuses],
      statuses,
    );
    for (const wire of [traced, plain]) {
      await service.waitForRecord(
        (record) =>
          record.event_name === 'skeld.request.closed' && record['skeld.request_id'] === wire.first('x-request-id'),
      );
    }
    return service.stdoutBytes().toString('utf8');
  } finally {
    await service.stop();
  }
}

function exportedCount(path: string): number {
  try {
    return destinationRecords(readFileSync(path, 'utf8')).length;
  } catch {
    // Why: The exporter may be mid-write; a partial last line is read again on the next poll.
    return 0;
  }
}

// Does:  Runs the Collector over the stdout file until it has exported every source line, then stops it.
async function collect(
  binary: string,
  work: string,
  expected: number,
): Promise<{ text: string; exit: number | null; output: string }> {
  const otelOut = join(work, 'otel.jsonl');
  const collector = spawn(binary, ['--config', configPath], {
    cwd: work,
    env: { ...process.env, SKELD_LOG_FILE: join(work, 'skeld.log'), SKELD_OTEL_OUT: otelOut },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const keep = (chunk: Buffer): void => {
    output += chunk.toString('utf8');
  };
  collector.stdout.on('data', keep);
  collector.stderr.on('data', keep);
  try {
    const deadline = Date.now() + exportWaitMs;
    while (Date.now() < deadline && collector.exitCode === null) {
      if (exportedCount(otelOut) >= expected) {
        break;
      }
      await delay(100);
    }
  } catch (error) {
    await stopCollector(collector);
    throw error;
  }
  const exit = await stopCollector(collector);
  const text = existsSync(otelOut) ? readFileSync(otelOut, 'utf8') : '';
  return { text, exit, output };
}

function parseSources(text: string): LogObject[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isObject(parsed)) {
        throw new Error(`service stdout holds a line that is not a JSON object: ${line.slice(0, 80)}`);
      }
      return parsed;
    });
}

function judgeRecords(report: Report, sources: LogObject[], destinations: Destination[]): void {
  for (const [at, source] of sources.entries()) {
    const destination = destinations[at];
    const name = `record ${at + 1} ${String(source.event_name)}${typeof source.trace_id === 'string' ? ' (trace context)' : ''}`;
    if (destination === undefined) {
      report.result(name, ['no destination record'], '');
      continue;
    }
    const { raw } = destination;
    report.result(
      name,
      compare(source, destination),
      `Timestamp ${describe(raw.timeUnixNano)} for ${String(source.time)}; SeverityNumber ${describe(raw.severityNumber)}; ` +
        `SeverityText ${describe(raw.severityText)}; EventName ${describe(raw.eventName)}; ` +
        `skeld.request_id ${JSON.stringify(destination.attributes.get('skeld.request_id'))}; ` +
        `TraceId ${describe(raw.traceId)}; flags ${describe(raw.flags)}`,
    );
  }
  const carriers = destinations.filter((destination) => destination.raw.traceId === traceId).length;
  const expectedCarriers = sources.filter((source) => source.trace_id === traceId).length;
  const bare = sources.filter(
    (source) => source.trace_id === undefined && source['skeld.request_id'] !== undefined,
  ).length;
  const problems: string[] = [];
  check(problems, expectedCarriers >= 2, `${expectedCarriers} source records hold the trace id`);
  check(
    problems,
    carriers === expectedCarriers,
    `${carriers} destination records hold the trace id, not ${expectedCarriers}`,
  );
  check(problems, bare >= 2, `${bare} request-scoped source records have no trace context`);
  report.result(
    'the request with trace context and the one without differ',
    problems,
    `${carriers} destination records carry TraceId ${traceId}; ${bare} request-scoped source records carry none`,
  );
}

async function main(): Promise<void> {
  const binary = collectorArgument(process.argv.slice(2));
  const version = versionLine(binary);
  const report = createReport('log-collector');
  const work = mkdtempSync(join(tmpdir(), 'skeld-collector-'));
  report.note('AC-13: a Skeld service on stdout, Collector contrib read through docs/logging/collector.yaml');
  report.note(`collector version line: ${version}`);
  report.note(`collector command: ${binary} --config ${configPath}`);
  report.note(
    'collector environment: SKELD_LOG_FILE=<the service stdout, written to a file> SKELD_OTEL_OUT=<otlp json file>',
  );
  report.note(`configuration used (${configPath}):`);
  for (const line of readFileSync(configPath, 'utf8').trimEnd().split('\n')) {
    report.note(`  | ${line}`);
  }
  try {
    const text = await serviceOutput(report, { traced: 'trace-request-1', plain: 'plain-request-2' });
    writeFileSync(join(work, 'skeld.log'), text);
    const sources = parseSources(text);
    report.note(
      `service stdout: ${sources.length} lines, events ${sources.map((source) => String(source.event_name)).join(', ')}`,
    );
    const run = await collect(binary, work, sources.length);
    const destinations = destinationRecords(run.text);
    const counts = `${destinations.length} destination records for ${sources.length} source lines; collector exit ${run.exit}`;
    report.result(
      'collector exported one record per source line',
      destinations.length === sources.length ? [] : [`${counts}; output ${run.output.trim().slice(-400)}`],
      counts,
    );
    report.note(`first exported line: ${run.text.split('\n')[0] ?? ''}`);
    judgeRecords(report, sources, destinations);
  } finally {
    rmSync(work, { recursive: true, force: true });
    report.finish();
  }
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
