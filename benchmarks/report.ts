import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeCommandLine } from './load.ts';
import { autocannonFlags, formatCpu, formatMs, formatPercent, formatRate, plural, verdictLine } from './terminal.ts';
import type { BenchOptions, BenchRun, BenchSample, BenchSummary, RouteId } from './types.ts';
import { connections, generatorCeilingPercent, saturationPercent, workers } from './values.ts';

const gibibyte = 1024 ** 3;

const routeTitles: Readonly<Record<RouteId, string>> = { hello: 'GET /', echo: 'POST /' };

const markdownTable = (headers: readonly string[], rows: readonly (readonly string[])[]): readonly string[] => [
  `| ${headers.join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
];

const resultRow = (group: BenchSummary): readonly string[] => [
  group.server,
  String(group.rounds),
  formatRate(group.requestsPerSecond.median),
  formatRate(group.requestsPerSecond.min),
  formatRate(group.requestsPerSecond.max),
  formatMs(group.latencyP99Ms.median),
  formatMs(group.latencyP99Ms.min),
  formatMs(group.latencyP99Ms.max),
  formatPercent(group.percentOfFastify),
  formatPercent(group.percentOfNodeHttp),
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
          'Median req/s',
          'Min req/s',
          'Max req/s',
          'Median p99 ms',
          'Min p99 ms',
          'Max p99 ms',
          'vs Fastify',
          'vs node:http',
        ],
        groups.map(resultRow),
      ),
      '',
    ];
  });

const roundRow = (sample: BenchSample): readonly string[] => [
  String(sample.round),
  String(sample.position),
  sample.server,
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

const keyValueTable = (rows: readonly (readonly [string, string])[]): readonly string[] => [
  '| | |',
  '|---|---|',
  ...rows.map(([key, value]) => `| ${key} | ${value} |`),
];

const methodLines = (options: BenchOptions): readonly string[] => {
  const flags = autocannonFlags(options);
  const perWorker = Math.floor(connections / workers);
  return [
    `- autocannon \`${flags}\`, run through its API in the runner's process on ${workers} worker threads; autocannon divides the ${connections} connections ${perWorker} per worker (${perWorker * workers} in all) and applies -p per connection in each worker (ADR-010).`,
    ...options.routes.map((route) => `- ${route}: \`${routeCommandLine(route, flags)}\``),
    `- ${plural(options.rounds, 'measured round', 'measured rounds')} per server and route. Each round starts every server in a fresh process, warms each route up for ${options.durationSeconds} s (discarded), measures it for ${options.durationSeconds} s, and stops the server. The server order rotates each round.`,
    "- Statistic: autocannon's mean requests per second for each round; median, minimum and maximum over the rounds. p99 latency likewise.",
    `- The load generator runs on the same machine as the servers and competes with them for CPU; every server carries the same handicap. A round is generator-bound when the runner process (${workers} workers and the main thread) used ${generatorCeilingPercent} % or more of one core, ${saturationPercent} % of the workers' ${workers} cores, whatever the server used. No process is pinned to a core.`,
    '- Loggers off. No TLS. No compression.',
    '- Routes: hello returns { hello: "world" } through a response schema; echo parses a JSON body and returns it. DarkStart and Fastify validate the echo body against { hello: string }, closed to other keys; node:http parses and serializes with JSON.parse and JSON.stringify and validates nothing. fastify/benchmarks\' POST route does not validate; this one does, so both frameworks do the same work. Hono and Express, when run, parse the echo body and validate nothing, like node:http.',
    '- Server options: darkstart, engine defaults; fastify, { logger: false }; node-http, http.createServer with no options; hono, @hono/node-server serve() with no options; express, express() with express.json() on the echo route.',
  ];
};

function renderReport(run: BenchRun): string {
  const { machine, software } = run;
  const lines = [
    `# DarkStart benchmark ${run.id}`,
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
      ['NODE_OPTIONS', software.nodeOptions === null ? 'unset' : JSON.stringify(software.nodeOptions)],
      [
        'DarkStart',
        `@darkstart/core ${software.darkstart}, ${revisionText(run)}, from ${software.darkstartResolvedFrom}`,
      ],
      ['Fastify', software.fastify],
      ['autocannon', software.autocannon],
      ['typebox', software.typebox],
      ['fast-json-stringify', software.fastJsonStringify],
      ['Hono', `hono ${software.hono}, @hono/node-server ${software.honoNodeServer}`],
      ['Express', software.express],
    ]),
    '',
    '## Method',
    '',
    ...methodLines(run.options),
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
