// Does:  Writes a run's results as JSON and as the Markdown report.
// Holds: Both files are written from the same run object, so the report cannot disagree with the data.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeCommandLine } from './load.ts';
import {
  autocannonFlags,
  coresText,
  entrantLabel,
  formatCpu,
  formatMicroseconds,
  formatMs,
  formatPercent,
  formatRate,
  plural,
  verdictLine,
} from './terminal.ts';
import type { BenchOptions, BenchRun, BenchSample, BenchSummary, RouteId } from './types.ts';
import {
  connections,
  generatorCeilingPercent,
  keepLinePercent,
  runnerCores,
  saturationPercent,
  serverCores,
  workers,
} from './values.ts';

const gibibyte = 1024 ** 3;

const routeTitles: Readonly<Record<RouteId, string>> = { hello: 'GET /', echo: 'POST /' };

export const markdownTable = (headers: readonly string[], rows: readonly (readonly string[])[]): readonly string[] => [
  `| ${headers.join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
];

const resultRow = (group: BenchSummary): readonly string[] => [
  entrantLabel(group),
  String(group.rounds),
  formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.median ?? null),
  formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.min ?? null),
  formatMicroseconds(group.serverCpuMicrosecondsPerRequest?.max ?? null),
  formatPercent(group.cpuPercentOfFastify),
  formatRate(group.requestsPerSecond.median),
  formatRate(group.requestsPerSecond.min),
  formatRate(group.requestsPerSecond.max),
  formatPercent(group.percentOfFastify),
  formatPercent(group.percentOfNodeHttp),
  formatMs(group.latencyP99Ms.median),
  formatMs(group.latencyP99Ms.min),
  formatMs(group.latencyP99Ms.max),
];

const resultsSection = (run: BenchRun): readonly string[] =>
  run.options.routes.flatMap((route) => {
    const groups = run.summary.filter((group) => group.route === route);
    if (groups.length === 0) {
      return [];
    }
    return [
      `### ${route}: ${routeTitles[route]}`,
      '',
      ...markdownTable(
        [
          'Server',
          'Rounds',
          'Median CPU µs/req',
          'Min CPU µs/req',
          'Max CPU µs/req',
          'CPU vs Fastify',
          'Median req/s',
          'Min req/s',
          'Max req/s',
          'req/s vs Fastify',
          'req/s vs node:http',
          'Median p99 ms',
          'Min p99 ms',
          'Max p99 ms',
        ],
        groups.map(resultRow),
      ),
      '',
    ];
  });

const roundRow = (sample: BenchSample): readonly string[] => [
  String(sample.round),
  String(sample.position),
  entrantLabel(sample),
  sample.route,
  sample.kind,
  formatRate(sample.requestsPerSecond),
  formatMs(sample.latencyP99Ms),
  String(sample.requests),
  String(sample.errors),
  String(sample.timeouts),
  String(sample.non2xx),
  String(sample.bytesPerResponse),
  formatCpu(sample.generatorCpuPercent),
  formatCpu(sample.serverCpuPercent),
  formatMicroseconds(sample.serverCpuMicrosecondsPerRequest),
  sample.serverCores ?? '-',
  sample.bound ?? '-',
];

const unknownIfNull = (value: string | null): string => value ?? 'unknown';

const yesNo = (value: boolean | null): string => {
  if (value === null) {
    return 'unknown';
  }
  return value ? 'yes (hypervisor flag set)' : 'no';
};

const revisionText = (run: BenchRun): string => {
  const { revision, uncommittedChanges } = run.software;
  if (revision === null) {
    return 'revision unknown';
  }
  if (uncommittedChanges === null) {
    return `revision ${revision}`;
  }
  return `revision ${revision} (${uncommittedChanges ? 'uncommitted changes' : 'clean'})`;
};

export const keyValueTable = (rows: readonly (readonly [string, string])[]): readonly string[] => [
  '| | |',
  '|---|---|',
  ...rows.map(([key, value]) => `| ${key} | ${value} |`),
];

const methodLines = (options: BenchOptions, unpinnedReason: string | null): readonly string[] => {
  const flags = autocannonFlags(options);
  const perWorker = Math.floor(connections / workers);
  return [
    `- Cores: ${coresText(unpinnedReason)}. Each server process starts under \`taskset --cpu-list ${serverCores}\`; the runner pins every one of its threads to cores ${runnerCores} with \`taskset --all-tasks\` at start, and the autocannon workers it creates later inherit that set. The cores each process was allowed, read from Cpus_allowed_list in /proc/<pid>/status, are in › Rounds and › Machine (ADR-015).`,
    `- autocannon \`${flags}\`, run through its API in the runner's process on ${workers} worker threads; autocannon divides the ${connections} connections ${perWorker} per worker (${perWorker * workers} in all) and applies -p per connection in each worker (ADR-010).`,
    ...options.routes.map((route) => `- ${route}: \`${routeCommandLine(route, flags)}\``),
    `- ${plural(options.rounds, 'measured round', 'measured rounds')} per server and route. Each round starts every server in a fresh process, warms each route up for ${options.warmUpSeconds} s (discarded), measures it for ${options.durationSeconds} s, and stops the server. The server order rotates each round.`,
    `- Judged statistic: the server's CPU time per request in each measured round, its utime plus stime from /proc/<pid>/stat over the measured window only (the warm-up excluded) divided by the requests autocannon completed in that window; median, minimum and maximum over the rounds. CPU vs Fastify is Fastify's median divided by the server's, so 100 % or more means the server spends no more CPU per request than Fastify. The verdict is keep when Skeld's echo ratio is ${keepLinePercent} % or more; hello is recorded and not judged (ADR-015).`,
    "- Beside it: autocannon's mean requests per second for each round and its p99 latency, each with median, minimum and maximum over the rounds.",
    `- The load generator runs on the same machine as the servers and competes with them for CPU; every server carries the same handicap. A round is generator-bound when the runner process (${workers} workers and the main thread) used ${generatorCeilingPercent} % or more of one core, ${saturationPercent} % of the workers' ${workers} cores, whatever the server used; such a round of any server but node-http voids the verdict (ADR-009).`,
    '- Loggers off. No TLS. No compression.',
    '- Routes: hello returns { hello: "world" } through a response schema; echo parses a JSON body and returns it. Skeld and Fastify validate the echo body against { hello: string }, closed to other keys; node:http parses and serializes with JSON.parse and JSON.stringify and validates nothing. fastify/benchmarks\' POST route does not validate; this one does, so both frameworks do the same work. Hono and Express, when run, parse the echo body and validate nothing, like node:http; light checks the body by hand (hello is a string), as its own hello benchmark does.',
    '- Server options: skeld, engine defaults; fastify, { logger: false }; node-http, http.createServer with no options; hono, @hono/node-server serve() with no options; express, express() with express.json() on the echo route; light, @lightstart/server/node serve() with no options.',
  ];
};

const diagCommandRow = (commandLine: readonly string[] | null): readonly (readonly [string, string])[] =>
  commandLine === null
    ? []
    : [
        [
          'Diag server command line',
          `${commandLine.join(' ')}, NODE_ENV=production, SKELD_DIAG_DIR, SKELD_DIAG_STEP_N and SKELD_DIAG_CPU_N set per process`,
        ],
      ];

function renderReport(run: BenchRun): string {
  const { machine, software } = run;
  const lines = [
    `# Skeld benchmark ${run.id}`,
    '',
    verdictLine(run.verdict),
    '',
    `Status: ${run.status}. Started ${run.startedAt}, finished ${run.finishedAt}.`,
    '',
    '## Results',
    '',
    ...resultsSection(run),
    '## Rounds',
    '',
    ...markdownTable(
      [
        'Round',
        'Position',
        'Server',
        'Route',
        'Kind',
        'Mean req/s',
        'p99 ms',
        'Requests',
        'Errors',
        'Timeouts',
        'Non-2xx',
        'Bytes per response',
        'Generator CPU',
        'Server CPU',
        'Server CPU µs/req',
        'Server cores',
        'Bound',
      ],
      run.samples.map(roundRow),
    ),
    '',
    '## Machine',
    '',
    ...keyValueTable([
      ['CPU', unknownIfNull(machine.cpuModel)],
      ['Cores', String(machine.cores)],
      ['RAM', `${(machine.memoryBytes / gibibyte).toFixed(2)} GiB`],
      ['OS', unknownIfNull(machine.osName)],
      ['Kernel', machine.kernel],
      ['Virtual machine', yesNo(machine.virtualMachine)],
      ['Runner cores allowed', unknownIfNull(machine.runnerCores)],
      ['Load average at start', machine.loadAverageStart.toFixed(2)],
      ['Load average at end', machine.loadAverageEnd.toFixed(2)],
    ]),
    '',
    '## Software',
    '',
    ...keyValueTable([
      ['Node', software.node],
      ['Runner command line', software.runnerCommandLine.join(' ')],
      [
        'Server command line',
        `${software.serverCommandLine.join(' ')}, NODE_ENV=${software.serverEnvironment.NODE_ENV}`,
      ],
      ...diagCommandRow(software.diagServerCommandLine),
      ['NODE_OPTIONS', software.nodeOptions === null ? 'unset' : JSON.stringify(software.nodeOptions)],
      ['Skeld', `@skeld/core ${software.skeld}, ${revisionText(run)}, from ${software.skeldResolvedFrom}`],
      ['Fastify', software.fastify],
      ['autocannon', software.autocannon],
      ['Hono', `hono ${software.hono}, @hono/node-server ${software.honoNodeServer}`],
      ['Express', software.express],
      [
        'light',
        `@lightstart/server ${software.light} (alantriesagain/lightstart 0b4cc663, packed by its scripts/pack.js)`,
      ],
    ]),
    '',
    '## Method',
    '',
    ...methodLines(run.options, machine.unpinnedReason),
    '',
    '## Warnings',
    '',
    ...(run.warnings.length === 0 ? ['None.'] : run.warnings.map((warning) => `- ${warning}`)),
    '',
  ];
  return lines.join('\n');
}

export function reportFile(runDirectory: string): string {
  return join(runDirectory, 'report.md');
}

export function writeRunFiles(runDirectory: string, run: BenchRun): void {
  writeFileSync(join(runDirectory, 'results.json'), `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(reportFile(runDirectory), renderReport(run));
}
