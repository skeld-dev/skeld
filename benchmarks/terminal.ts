// Does:  Formats everything the benchmark prints to the terminal.
// Holds: It only formats; no figure is computed or decided here.

import { relative } from 'node:path';
import { generatorBottleneckText } from './verdict.ts';
import type {
  BenchSample,
  BenchSummary,
  BenchVerdict,
  BuildId,
  CheckRow,
  RouteId,
  RunOptions,
  ServerId,
} from './types.ts';
import {
  connections,
  expectedBody,
  generatorCeilingPercent,
  host,
  keepLinePercent,
  runnerCores,
  serverCores,
  stopGraceMs,
  workers,
} from './values.ts';

type Align = 'left' | 'right';

interface Column {
  readonly header: string;
  readonly align: Align;
}

export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function plural(count: number, singular: string, several: string): string {
  return `${count} ${count === 1 ? singular : several}`;
}

export function displayPath(path: string): string {
  return relative(process.cwd(), path) || '.';
}

export const formatRate = (value: number): string => value.toFixed(1);
export const formatMs = (value: number): string => value.toFixed(2);
export const formatPercent = (value: number | null): string => (value === null ? '-' : `${value.toFixed(1)} %`);
export const formatCpu = (value: number | null): string => (value === null ? '-' : `${Math.round(value)} %`);
export const formatMicroseconds = (value: number | null): string => (value === null ? '-' : value.toFixed(1));

function renderTable(columns: readonly Column[], rows: readonly (readonly string[])[]): readonly string[] {
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    columns
      .map((column, index) => {
        const cell = cells[index] ?? '';
        const width = widths[index] ?? cell.length;
        return column.align === 'left' ? cell.padEnd(width) : cell.padStart(width);
      })
      .join('  ')
      .trimEnd();
  return [line(columns.map((column) => column.header)), ...rows.map(line)];
}

export function autocannonFlags(options: Pick<RunOptions, 'durationSeconds' | 'pipelining'>): string {
  return `-c ${connections} -d ${options.durationSeconds} -p ${options.pipelining} -w ${workers}`;
}

export function coresText(unpinnedReason: string | null): string {
  return unpinnedReason ?? `each server on core ${serverCores}, the runner on cores ${runnerCores}`;
}

export function startLines(
  options: RunOptions,
  runDirectory: string,
  minutes: number,
  unpinnedReason: string | null,
): readonly string[] {
  return [
    `DarkStart benchmark: ${plural(options.servers.length, 'server', 'servers')}, ${plural(options.routes.length, 'route', 'routes')}, ${plural(options.rounds, 'round', 'rounds')}, autocannon ${autocannonFlags(options)} after a ${options.warmUpSeconds} s warm-up, about ${minutes} min`,
    `Cores: ${coresText(unpinnedReason)}`,
    `Results: ${displayPath(runDirectory)}/`,
  ];
}

export function diagStartLines(
  options: RunOptions,
  runDirectory: string,
  minutes: number,
  unpinnedReason: string | null,
): readonly string[] {
  const first = options.check
    ? 'DarkStart diag check: the normal and diag builds start once, then the clean and planted scenario passes; nothing is measured'
    : `DarkStart diag benchmark: the normal and diag builds, ${plural(options.routes.length, 'route', 'routes')}, ${plural(options.rounds, 'round', 'rounds')}, autocannon ${autocannonFlags(options)} after a ${options.warmUpSeconds} s warm-up, about ${minutes} min, then the clean and planted scenario passes`;
  return [
    first,
    `Sampling: steps on 1 in ${options.stepN} requests, CPU on 1 in ${options.cpuN}`,
    `Cores: ${coresText(unpinnedReason)}`,
    `Results: ${displayPath(runDirectory)}/`,
  ];
}

const progressLabelWidth = 14;

export function entrantLabel(entrant: { readonly server: ServerId; readonly build: BuildId }): string {
  return entrant.build === 'darkstart' ? entrant.server : entrant.build;
}

const progress = (round: number, rounds: number, label: string, text: string): string =>
  `[${round}/${rounds}] ${label.padEnd(progressLabelWidth)}  ${text}`;

export function startedLine(round: number, rounds: number, label: string, port: number, ms: number): string {
  return progress(round, rounds, label, `started on ${host}:${port} in ${Math.round(ms)} ms`);
}

export function stoppedLine(round: number, rounds: number, label: string): string {
  return progress(round, rounds, label, 'stopped');
}

export function warmUpLine(round: number, rounds: number, label: string, route: RouteId, seconds: number): string {
  return progress(round, rounds, label, `${route.padEnd(5)}  warm-up ${seconds} s`);
}

export function measuredLine(rounds: number, sample: BenchSample): string {
  return progress(
    sample.round,
    rounds,
    entrantLabel(sample),
    `${sample.route.padEnd(5)}  ${formatMicroseconds(sample.serverCpuMicrosecondsPerRequest)} CPU µs/req  ${formatRate(sample.requestsPerSecond)} req/s  p99 ${formatMs(sample.latencyP99Ms)} ms`,
  );
}

const checkColumns: readonly Column[] = [
  { header: 'Server', align: 'left' },
  { header: 'Route', align: 'left' },
  { header: 'Status', align: 'right' },
  { header: 'Media type', align: 'left' },
  { header: 'Bytes', align: 'right' },
  { header: 'Result', align: 'left' },
];

const checkResult = (row: CheckRow): string => {
  if (!row.started) {
    return 'did not start';
  }
  return row.passed ? 'ok' : `expected 200 with body ${expectedBody}`;
};

const failureLine = (row: CheckRow): string => {
  if (!row.started) {
    return `Check failed: ${row.server} did not start. Nothing was measured.`;
  }
  if (row.status === null) {
    return `Check failed: ${row.server} gave no answer to ${row.route}. Nothing was measured.`;
  }
  return `Check failed: ${row.server} answers ${row.route} with ${row.status}. Nothing was measured.`;
};

export function checkLines(rows: readonly CheckRow[], servers: number, routes: number): readonly string[] {
  const table = renderTable(
    checkColumns,
    rows.map((row) => [
      row.server,
      row.route,
      row.status === null ? '-' : String(row.status),
      row.mediaType ?? '-',
      row.bytes === null ? '-' : String(row.bytes),
      checkResult(row),
    ]),
  );
  const failed = rows.find((row) => !row.passed);
  const last =
    failed === undefined
      ? `Check passed: ${plural(servers, 'server answers', 'servers answer')} ${plural(routes, 'route', 'routes')} alike.`
      : failureLine(failed);
  return [...table, '', last];
}

const summaryColumns: readonly Column[] = [
  { header: 'Route', align: 'left' },
  { header: 'Server', align: 'left' },
  { header: 'Rounds', align: 'right' },
  { header: 'CPU µs/req', align: 'right' },
  { header: 'Min', align: 'right' },
  { header: 'Max', align: 'right' },
  { header: 'CPU vs Fastify', align: 'right' },
  { header: 'Median req/s', align: 'right' },
  { header: 'req/s vs Fastify', align: 'right' },
  { header: 'Median p99 ms', align: 'right' },
];

export function verdictLine(verdict: BenchVerdict): string {
  const ratios = `Fastify's server CPU per request is ${formatPercent(verdict.echo)} of DarkStart's on echo (judged) and ${formatPercent(verdict.hello)} on hello (recorded); the line is ${keepLinePercent} % on echo.`;
  if (verdict.kind === 'keep') {
    return `Verdict: keep. ${ratios}`;
  }
  if (verdict.kind === 'below') {
    return `Verdict: below the line. ${ratios}`;
  }
  return `Verdict: not assessed. ${verdict.reason ?? ''}`;
}

function noteLine(verdict: BenchVerdict, measuredRounds: number): string | null {
  if (verdict.kind === 'not-assessed' || verdict.generatorBoundRounds === 0) {
    return null;
  }
  return `Note: ${generatorBottleneckText(verdict.generatorBoundRounds, measuredRounds)}; the ratios may understate the difference between servers.`;
}

export function summaryLines(
  summary: readonly BenchSummary[],
  verdict: BenchVerdict,
  measuredRounds: number,
  reportPath: string,
): readonly string[] {
  const table =
    summary.length === 0
      ? []
      : [
          ...renderTable(
            summaryColumns,
            summary.map((group) => [
              group.route,
              group.server,
              String(group.rounds),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.median ?? null),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.min ?? null),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.max ?? null),
              formatPercent(group.cpuPercentOfFastify),
              formatRate(group.requestsPerSecond.median),
              formatPercent(group.percentOfFastify),
              formatMs(group.latencyP99Ms.median),
            ]),
          ),
          '',
        ];
  const note = noteLine(verdict, measuredRounds);
  return [...table, verdictLine(verdict), ...(note === null ? [] : [note]), `Report: ${displayPath(reportPath)}`];
}

const diagSummaryColumns: readonly Column[] = [
  { header: 'Build', align: 'left' },
  { header: 'Route', align: 'left' },
  { header: 'Rounds', align: 'right' },
  { header: 'Median CPU µs/req', align: 'right' },
  { header: 'Min', align: 'right' },
  { header: 'Max', align: 'right' },
  { header: 'Median req/s', align: 'right' },
  { header: 'Median p99 ms', align: 'right' },
];

export function diagSummaryLines(
  summary: readonly BenchSummary[],
  overhead: string,
  security: string,
  readoutPath: string,
): readonly string[] {
  const table =
    summary.length === 0
      ? []
      : [
          ...renderTable(
            diagSummaryColumns,
            summary.map((group) => [
              entrantLabel(group),
              group.route,
              String(group.rounds),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.median ?? null),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.min ?? null),
              formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.max ?? null),
              formatRate(group.requestsPerSecond.median),
              formatMs(group.latencyP99Ms.median),
            ]),
          ),
          '',
        ];
  return [...table, overhead, security, `Readout: ${displayPath(readoutPath)}`];
}

export function nonConformingWarning(found: readonly string[]): string {
  return `this run differs from the acceptance protocol (${found.join('; ')}). It is recorded and gets no verdict.`;
}

export function generatorWarning(sample: BenchSample, generatorCpuPercent: number): string {
  const server = sample.serverCpuPercent === null ? 'unknown' : `${Math.round(sample.serverCpuPercent)} %`;
  return `round ${sample.round} ${entrantLabel(sample)} ${sample.route}: the load generator used ${Math.round(generatorCpuPercent)} % of a core, at or above its ${generatorCeilingPercent} % ceiling for ${workers} workers, and the server ${server}; this round measured autocannon, not the server.`;
}

export function busyWarning(loadAverage: number): string {
  return `the 1-minute load average was ${loadAverage.toFixed(2)} when the run started; other work on this machine lowers every number.`;
}

export function inheritedDiagWarning(names: readonly string[]): string {
  return `the runner's environment sets ${names.join(', ')}; every server starts without them, and the benchmark sets the diag build's own.`;
}

export function staleLockWarning(pid: number): string {
  return `replaced a lock left by pid ${pid}, which is no longer running.`;
}

export function killedWarning(server: string): string {
  return `${server} did not exit within ${stopGraceMs / 1000} s of SIGTERM and was killed.`;
}

export const procUnavailableWarning = 'server CPU could not be read on this system; the Bound column reads unknown.';
