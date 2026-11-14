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
  formatRate,
  formatRatio,
  plural,
  ratioHeaders,
  splitHeaders,
  splitRow,
} from './terminal.ts';
import type { BenchComparison, BenchOptions, BenchRun, BenchSample, BenchSummary, RouteId } from './types.ts';
import {
  connections,
  generatorCeilingPercent,
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
  formatRate(group.requestsPerSecond.median),
  formatRate(group.requestsPerSecond.min),
  formatRate(group.requestsPerSecond.max),
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
          'Median req/s',
          'Min req/s',
          'Max req/s',
          'Median p99 ms',
          'Min p99 ms',
          'Max p99 ms',
        ],
        groups.map(resultRow),
      ),
      '',
    ];
  });

const splitSection = (run: BenchRun): readonly string[] =>
  run.summary.length === 0
    ? []
    : [
        '### Server CPU by mode and by thread',
        '',
        'Medians in µs per request, from /proc: the counters of the process, as for the totals above, and those of its main thread. Within one round, user plus system and main thread plus other threads each equal the total of that round; each column here is its own median over the rounds, so the columns need not add up to the median total.',
        '',
        ...markdownTable(splitHeaders, run.summary.map(splitRow)),
        '',
      ];

const comparisonSection = (comparison: BenchComparison | undefined): readonly string[] => {
  if (comparison === undefined) {
    return [];
  }
  const { external, ratios } = comparison;
  const version = external.version === null ? '' : ` (${external.server} ${external.version} in its node_modules)`;
  return [
    `### skeld relative to ${external.server}`,
    '',
    `${external.server} is the external entrant, run from ${external.file}${version}. Each figure is skeld's median divided by ${external.server}'s on the same route: a CPU ratio below 1 means skeld used less CPU per request, a req/s ratio above 1 means skeld served more requests per second. These are measurements, not a verdict.`,
    '',
    ...markdownTable(
      ['Route', ...ratioHeaders(external.server)],
      ratios.map((ratio) => [
        ratio.route,
        formatRatio(ratio.serverCpuMicrosecondsPerRequest),
        formatRatio(ratio.requestsPerSecond),
      ]),
    ),
    '',
  ];
};

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

const externalMethodLines = (comparison: BenchComparison | undefined): readonly string[] =>
  comparison === undefined
    ? []
    : [
        `- External entrant: ${comparison.external.server}, started with plain node from its file's own folder, without --conditions, with NODE_ENV=production and the runner's environment minus SKELD_DIAG_ variables, pinned the same way as skeld. It passes the same start check, and its position rotates with skeld's each round. Its routes and options are whatever its file sets.`,
      ];

const methodLines = (
  options: BenchOptions,
  unpinnedReason: string | null,
  comparison: BenchComparison | undefined,
): readonly string[] => {
  const flags = autocannonFlags(options);
  const perWorker = Math.floor(connections / workers);
  return [
    `- Cores: ${coresText(unpinnedReason)}. Each server process starts under \`taskset --cpu-list ${serverCores}\`; the runner pins every one of its threads to cores ${runnerCores} with \`taskset --all-tasks\` at start, and the autocannon workers it creates later inherit that set. The cores each process was allowed, read from Cpus_allowed_list in /proc/<pid>/status, are in › Rounds and › Machine (ADR-015).`,
    `- autocannon \`${flags}\`, run through its API in the runner's process on ${workers} worker threads; autocannon divides the ${connections} connections ${perWorker} per worker (${perWorker * workers} in all) and applies -p per connection in each worker (ADR-010).`,
    ...options.routes.map((route) => `- ${route}: \`${routeCommandLine(route, flags)}\``),
    `- ${plural(options.rounds, 'measured round', 'measured rounds')} per server and route. Each round starts every server in a fresh process, warms each route up for ${options.warmUpSeconds} s (discarded), measures it for ${options.durationSeconds} s, and stops the server. When a session measures multiple skeld builds, their order rotates each round.`,
    "- Primary statistic: skeld's CPU time per request in each measured round, its utime plus stime from /proc/<pid>/stat over the measured window only (the warm-up excluded) divided by the requests autocannon completed in that window; median, minimum and maximum over the rounds.",
    "- Beside it: autocannon's mean requests per second for each round and its p99 latency, each with median, minimum and maximum over the rounds.",
    `- The load generator runs on the same machine as skeld. A round is generator-bound when the runner process (${workers} workers and the main thread) used ${generatorCeilingPercent} % or more of one core, ${saturationPercent} % of the workers' ${workers} cores, whatever the server used. Generator-bound rounds are marked and warned about; they may understate skeld's capacity.`,
    '- Loggers off except for logging session variants. No TLS. No compression.',
    '- Routes: hello returns { hello: "world" } through a response schema; echo validates a JSON body against { hello: string } (maximum length 64), closed to other keys, and returns it through the response schema.',
    '- Server options: skeld, engine defaults. Diagnostic and logging sessions configure their own instrumentation.',
    ...externalMethodLines(comparison),
  ];
};

const externalRows = (comparison: BenchComparison | undefined): readonly (readonly [string, string])[] =>
  comparison === undefined
    ? []
    : [
        [
          'External server command line',
          `${comparison.external.commandLine.join(' ')}, from ${comparison.external.file}'s folder, NODE_ENV=production`,
        ],
        ...(comparison.external.version === null
          ? []
          : [[comparison.external.server, comparison.external.version] as const]),
      ];

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
    `# skeld benchmark ${run.id}`,
    '',
    `Status: ${run.status}. Started ${run.startedAt}, finished ${run.finishedAt}.`,
    ...(run.statusReason === null ? [] : [run.statusReason]),
    '',
    '## Results',
    '',
    ...resultsSection(run),
    ...splitSection(run),
    ...comparisonSection(run.comparison),
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
      ['skeld', `@skeld/core ${software.skeld}, ${revisionText(run)}, from ${software.skeldResolvedFrom}`],
      ['autocannon', software.autocannon],
      ...externalRows(run.comparison),
    ]),
    '',
    '## Method',
    '',
    ...methodLines(run.options, machine.unpinnedReason, run.comparison),
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
