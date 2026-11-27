// Does:  Builds and writes the diag readout: per-stage table, diag-to-normal ratio and the security pass.
// Holds: The overhead ratio is taken from server CPU per request of the two builds in the same run.

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { routeIds } from '../options.ts';
import { keyValueTable, markdownTable } from '../report.ts';
import { median } from '../statistics.ts';
import { formatMicroseconds, plural } from '../terminal.ts';
import type { BenchSummary, RouteId, RunOptions } from '../types.ts';
import { defaultCpuN, defaultStepN, overheadLine, readoutFile, spanSumTolerance } from '../values.ts';
import type { RecorderFolder, SnapshotLine } from './diag-files.ts';
import type { ScenarioFinding, ScenarioPassResult } from './scenario.ts';

export type ProcessGroup = 'check' | 'rounds' | 'scenario clean' | 'scenario planted';

export interface DiagProcess {
  readonly group: ProcessGroup;
  readonly folder: RecorderFolder;
}

export interface MeasuredWindow {
  readonly route: RouteId;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly folder: RecorderFolder;
}

type OverheadStatus = 'within' | 'over' | 'watch-only' | 'not assessed';

interface RouteOverhead {
  readonly route: RouteId;
  readonly normal: number;
  readonly diag: number;
  readonly ratio: number;
  readonly status: OverheadStatus;
}

export interface Overhead {
  readonly routes: readonly RouteOverhead[];
  readonly reason: string | null;
}

export interface Readout {
  readonly runId: string;
  readonly revision: string | null;
  readonly node: string;
  readonly sampling: Pick<RunOptions, 'stepN' | 'cpuN'>;
  readonly overhead: Overhead;
  readonly measured: readonly MeasuredWindow[];
  readonly processes: readonly DiagProcess[];
  readonly findings: readonly ScenarioFinding[];
  readonly scenario: readonly ScenarioPassResult[];
  readonly security: string;
  readonly warnings: readonly string[];
}

interface SpanTotals {
  n: number;
  cn: number;
  incl: number;
  self: number;
  cpu: number;
  max: number;
  readonly p50: number[];
  readonly p95: number[];
}

const stepNames: ReadonlySet<string> = new Set([
  'req.preroute.framing',
  'req.preroute.target',
  'req.route.split',
  'req.route.match',
  'req.body.media_type',
  'req.body.forbidden_key',
  'req.query.parse',
  'req.validate.part',
  'req.validate.errors',
  'req.handler.arg',
  'req.respond.serialize',
]);
const rootSpan = 'req.total';
const outsideSum: ReadonlySet<string> = new Set([
  rootSpan,
  'req.sync',
  'req.hook.on_response',
  'req.settle',
  'req.close',
]);
const groupOrder: readonly ProcessGroup[] = ['check', 'rounds', 'scenario clean', 'scenario planted'];
const notMeasured = 'Not measured.';

const baseName = (span: string): string => span.replace(/\{.*\}$/, '');
const isRequestPath = (span: string): boolean => span.startsWith('req.') || span.startsWith('err.');
const isStep = (span: string): boolean => stepNames.has(baseName(span));

const fixed = (value: number, digits: number): string => String(Number(value.toFixed(digits)));
const ratioText = (value: number): string => value.toFixed(2);
const percentText = (value: number): string => `${(value * 100).toFixed(1)} %`;
const perOrDash = (total: number, count: number, format: (value: number) => string): string =>
  count === 0 ? '-' : format(total / count);

const overheadStatus = (route: RouteId, ratio: number, watchOnly: boolean, reason: string | null): OverheadStatus => {
  if (reason !== null) {
    return 'not assessed';
  }
  if (watchOnly || route !== 'hello') {
    return 'watch-only';
  }
  return ratio <= overheadLine ? 'within' : 'over';
};

export function decideOverhead(
  summary: readonly BenchSummary[],
  sampling: Readout['sampling'],
  reason: string | null,
): Overhead {
  const watchOnly = sampling.stepN !== defaultStepN || sampling.cpuN !== defaultCpuN;
  const medianOf = (build: BenchSummary['build'], route: RouteId): number | null =>
    summary.find((group) => group.build === build && group.route === route)?.serverCpuMicrosecondsPerRequest?.median ??
    null;
  const routes = routeIds.flatMap((route): RouteOverhead[] => {
    const normal = medianOf('skeld', route);
    const diag = medianOf('skeld-diag', route);
    if (normal === null || diag === null) {
      return [];
    }
    const ratio = diag / normal;
    return [{ route, normal, diag, ratio, status: overheadStatus(route, ratio, watchOnly, reason) }];
  });
  return { routes, reason };
}

export function overheadSentence(overhead: Overhead): string {
  const [first, ...rest] = overhead.routes;
  if (first === undefined) {
    return 'Overhead: not measured.';
  }
  if (overhead.reason !== null) {
    return `Overhead: not assessed. ${overhead.reason}`;
  }
  const line =
    first.status === 'within' || first.status === 'over' ? ` (line ${overheadLine.toFixed(2)}, ${first.status})` : '';
  const others = rest.map((route) => ` and ${ratioText(route.ratio)} times on ${route.route}`).join('');
  const watchOnly = overhead.routes.every((route) => route.status === 'watch-only')
    ? '; watch-only, no line applies'
    : '';
  return `Overhead: the diag build costs ${ratioText(first.ratio)} times the normal build's CPU per ${first.route} request${line}${others}${watchOnly}.`;
}

const lastLine = (folder: RecorderFolder): SnapshotLine | undefined => folder.snapshots.at(-1);

const windowLines = (window: MeasuredWindow): readonly SnapshotLine[] =>
  window.folder.snapshots.filter(
    (line) => line.t - line.window_ms >= window.windowStartMs && line.t <= window.windowEndMs,
  );

const routeLines = (measured: readonly MeasuredWindow[], route: RouteId): readonly SnapshotLine[] =>
  measured.filter((window) => window.route === route).flatMap(windowLines);

const spanTotals = (lines: readonly SnapshotLine[]): ReadonlyMap<string, SpanTotals> => {
  const totals = new Map<string, SpanTotals>();
  for (const line of lines) {
    for (const [name, figures] of Object.entries(line.spans)) {
      const total = totals.get(name) ?? { n: 0, cn: 0, incl: 0, self: 0, cpu: 0, max: 0, p50: [], p95: [] };
      total.n += figures.n;
      total.cn += figures.cn;
      total.incl += figures.incl;
      total.self += figures.self;
      total.cpu += figures.cpu;
      total.max = Math.max(total.max, figures.max);
      if (figures.n > 0) {
        total.p50.push(figures.p50);
        total.p95.push(figures.p95);
      }
      totals.set(name, total);
    }
  }
  return totals;
};

const medianOrDash = (values: readonly number[]): string =>
  values.length === 0 ? '-' : formatMicroseconds(median(values));

const spanRow = (name: string, total: SpanTotals, rootIncl: number | null): readonly string[] => [
  name,
  String(total.n),
  perOrDash(total.self, total.n, (value) => fixed(value, 3)),
  medianOrDash(total.p50),
  medianOrDash(total.p95),
  formatMicroseconds(total.max),
  perOrDash(total.cpu, total.cn, (value) => fixed(value, 3)),
  ...(rootIncl === null
    ? []
    : [outsideSum.has(baseName(name)) || rootIncl === 0 ? '-' : percentText(total.self / rootIncl)]),
];

const spanHeaders = ({ stepN, cpuN }: Readout['sampling']): readonly string[] => [
  'Span',
  `Instances (sampled 1 in ${stepN})`,
  'Mean self µs',
  'Self p50 µs',
  'Self p95 µs',
  'Self max µs',
  `Self CPU µs (sampled, 1 in ${cpuN})`,
];

const sumLine = (totals: ReadonlyMap<string, SpanTotals>, sampledIncl: number): string => {
  const sum = [...totals]
    .filter(([name]) => isRequestPath(name) && !outsideSum.has(baseName(name)))
    .reduce((accumulated, [, total]) => accumulated + total.self, 0);
  if (sampledIncl === 0) {
    return 'Span sum: the sampled requests recorded no time.';
  }
  const share = sum / sampledIncl;
  const verdict = Math.abs(share - 1) <= spanSumTolerance ? 'within' : 'over';
  return `Span sum: the self wall of every request-path span inside req.total is ${fixed(sum, 3)} µs against the step-timed requests' ${fixed(sampledIncl, 3)} µs of req.total inclusive, ${percentText(share)} (line ±${percentText(spanSumTolerance)}, ${verdict}). It covers each request from the opening of req.total to the response write; rows marked - in the share column lie outside it.`;
};

const sampleNote = ({ stepN, cpuN }: Readout['sampling']): string =>
  stepN === cpuN
    ? `Wall and CPU columns come from the same requests, 1 in ${stepN}.`
    : `The wall columns come from 1 in ${stepN} requests and the CPU column from 1 in ${cpuN}, so a row's wall and CPU means describe different sets of requests.`;

const clockNote = (readout: Readout, route: RouteId, root: SpanTotals): string => {
  const step = readout.measured.find((window) => window.route === route)?.folder.run.sampling.cpu_step_us ?? null;
  const measured =
    step === null
      ? 'The thread CPU clock did not move while the recorder measured its step at open'
      : `The thread CPU clock's measured step on this run is ${fixed(step, 3)} µs`;
  return `${measured}; the CPU column samples 1 in ${readout.sampling.cpuN} requests and rests on ${plural(root.cn, 'CPU-sampled request', 'CPU-sampled requests')}, so a span shorter than the step needs many samples for its mean to hold.`;
};

const timedSpans = (totals: ReadonlyMap<string, SpanTotals>): number =>
  [...totals]
    .filter(([name]) => isRequestPath(name) && !outsideSum.has(baseName(name)))
    .reduce((count, [, total]) => count + total.n, 0);

const rootLines = (
  root: SpanTotals,
  lines: readonly SnapshotLine[],
  totals: ReadonlyMap<string, SpanTotals>,
): readonly string[] => {
  const timedN = lines.reduce((total, line) => total + line.sampled.n, 0);
  const timedIncl = lines.reduce((total, line) => total + line.sampled.incl, 0);
  const untimedN = root.n - timedN;
  const timed = timedN === 0 ? null : timedIncl / timedN;
  const untimed = untimedN === 0 ? null : (root.incl - timedIncl) / untimedN;
  const cpu =
    root.cn === 0
      ? ''
      : ` Active CPU ${fixed(root.cpu / root.cn, 3)} µs per request on ${root.cn} CPU-sampled requests (thread CPU while the request was current, from req.total's opening to its close).`;
  const spansPer = timedN === 0 ? 0 : timedSpans(totals) / timedN;
  const cost =
    timed === null || untimed === null
      ? ''
      : ` Cost of step timing: ${fixed(timed - untimed, 3)} µs per step-timed request (the step-timed mean less the other requests' mean).`;
  const perSpan =
    timed === null || untimed === null || spansPer === 0
      ? []
      : [
          '',
          `Timing cost per span (derived average): (${fixed(timed, 3)} − ${fixed(untimed, 3)}) µs / ${fixed(spansPer, 3)} timed spans per step-timed request (stage and step spans inside req.total) = ${fixed((timed - untimed) / spansPer, 3)} µs. A stage's own time includes about that much for itself and for each child span it opens; no figure here is corrected for it.`,
        ];
  return [
    `req.total: ${plural(root.n, 'request', 'requests')}, mean ${fixed(root.incl / root.n, 3)} µs inclusive.${cpu}`,
    '',
    `Step-timed requests: ${timedN}, mean ${timed === null ? '-' : fixed(timed, 3)} µs. Other requests: ${untimedN}, mean ${untimed === null ? '-' : fixed(untimed, 3)} µs.${cost} Stage shares are taken against the step-timed requests' req.total.`,
    ...perSpan,
  ];
};

const stageSection = (readout: Readout, route: RouteId): readonly string[] => {
  const lines = routeLines(readout.measured, route);
  const totals = spanTotals(lines);
  const root = totals.get(rootSpan);
  if (root === undefined || root.n === 0) {
    return [`### ${route}`, '', notMeasured, ''];
  }
  const sampledIncl = lines.reduce((total, line) => total + line.sampled.incl, 0);
  const rows = [...totals]
    .filter(([name]) => isRequestPath(name) && !isStep(name) && name !== rootSpan)
    .map(([name, total]) => spanRow(name, total, sampledIncl));
  return [
    `### ${route}`,
    '',
    ...rootLines(root, lines, totals),
    '',
    `${sampleNote(readout.sampling)} ${clockNote(readout, route, root)}`,
    '',
    ...markdownTable([...spanHeaders(readout.sampling), 'Share of sampled req.total'], rows),
    '',
    sumLine(totals, sampledIncl),
    '',
  ];
};

const stepSection = (readout: Readout, route: RouteId): readonly string[] => {
  const totals = spanTotals(routeLines(readout.measured, route));
  const rows = [...totals]
    .filter(([name, total]) => isStep(name) && total.n > 0)
    .map(([name, total]) => spanRow(name, total, null));
  return [
    `### ${route}`,
    '',
    ...(rows.length === 0
      ? [notMeasured]
      : [
          `Steps are timed on 1 in ${readout.sampling.stepN} requests. ${sampleNote(readout.sampling)}`,
          '',
          ...markdownTable(spanHeaders(readout.sampling), rows),
        ]),
    '',
  ];
};

const measuredRoutes = (readout: Readout): readonly RouteId[] =>
  routeIds.filter((route) => readout.measured.some((window) => window.route === route));

const perRouteSections = (
  readout: Readout,
  title: string,
  section: (readout: Readout, route: RouteId) => readonly string[],
  note: string | null,
): readonly string[] => {
  const routes = measuredRoutes(readout);
  return [
    `## ${title}`,
    '',
    ...(routes.length === 0
      ? [notMeasured, '']
      : [...(note === null ? [] : [note, '']), ...routes.flatMap((route) => section(readout, route))]),
  ];
};

const processRow = (route: RouteId, lines: readonly SnapshotLine[]): readonly string[] => {
  const requests = lines.reduce((total, line) => total + line.requests, 0);
  const unattributed = lines.reduce((total, line) => total + line.process.unattributed_cpu, 0);
  const allocated = lines.reduce((total, line) => total + line.process.alloc_bytes, 0);
  const perSecond = lines
    .filter((line) => line.window_ms > 0)
    .map((line) => (line.process.unattributed_cpu * 1000) / line.window_ms);
  return [
    route,
    String(lines.length),
    String(requests),
    perSecond.length === 0 ? '-' : fixed(median(perSecond), 1),
    perOrDash(unattributed, requests, (value) => fixed(value, 3)),
    perOrDash(allocated, requests, (value) => fixed(value, 0)),
  ];
};

const processSection = (readout: Readout): readonly string[] => {
  const rows = measuredRoutes(readout).flatMap((route) => {
    const lines = routeLines(readout.measured, route);
    return lines.length === 0 ? [] : [processRow(route, lines)];
  });
  return [
    '## Process',
    '',
    "Unattributed CPU is main-thread CPU less the estimated synchronous wall time inside spans. It can hold work outside the request clock (before req.total opens, settlement, the close callback, timers), active work inside spans that cross callbacks, the recorder's own cost and Node's. It is not a measure of Node or the kernel alone.",
    '',
    ...(rows.length === 0
      ? [notMeasured]
      : markdownTable(
          [
            'Route',
            'Windows',
            'Requests',
            'Unattributed CPU µs per second (median)',
            'Unattributed CPU µs per request',
            'Allocated bytes per request',
          ],
          rows,
        )),
    '',
  ];
};

const limitsSection = (readout: Readout): readonly string[] => {
  const largest = new Map<string, { readonly peak: number; readonly max: number; readonly where: string }>();
  for (const { folder } of readout.processes) {
    for (const [name, limit] of Object.entries(lastLine(folder)?.limits ?? {})) {
      const held = largest.get(name);
      if (held === undefined || limit.run_peak > held.peak) {
        largest.set(name, { peak: limit.run_peak, max: limit.max, where: basename(folder.folder) });
      }
    }
  }
  const rows = [...largest].map(([name, held]) => [name, fixed(held.peak, 3), fixed(held.max, 3), held.where]);
  return [
    '## Limits',
    '',
    ...(rows.length === 0 ? [notMeasured] : markdownTable(['Limit', 'Largest run peak', 'Max', 'Process'], rows)),
    '',
  ];
};

const eventsSection = (readout: Readout): readonly string[] => {
  const groups = groupOrder.filter((group) => readout.processes.some((process) => process.group === group));
  const sums = new Map<string, Map<ProcessGroup, number>>();
  for (const { group, folder } of readout.processes) {
    for (const [name, event] of Object.entries(lastLine(folder)?.events ?? {})) {
      const byGroup = sums.get(name) ?? new Map<ProcessGroup, number>();
      byGroup.set(group, (byGroup.get(group) ?? 0) + event.run_n);
      sums.set(name, byGroup);
    }
  }
  const rows = [...sums]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, byGroup]) => [name, ...groups.map((group) => String(byGroup.get(group) ?? 0))]);
  return [
    '## Events',
    '',
    ...(rows.length === 0
      ? [readout.processes.length === 0 ? notMeasured : 'None.']
      : markdownTable(['Event', ...groups], rows)),
    '',
  ];
};

export function findingText(finding: ScenarioFinding): string {
  const subject = finding.subject === null ? '' : ` (${finding.subject})`;
  const route = finding.route === null ? '' : ` on route ${finding.route}`;
  return `${finding.kind}${subject}${route} in ${finding.where}`;
}

const findingsSection = (readout: Readout): readonly string[] => {
  const lines = readout.findings.map((finding) => `- ${findingText(finding)}`);
  return ['## Findings', '', readout.security, '', ...(lines.length === 0 ? [] : [...lines, ''])];
};

const figureText = (figures: Readonly<Record<string, number>>, name: string): string => {
  const value = figures[name];
  return value === undefined ? '-' : String(value);
};

const passSection = (result: ScenarioPassResult): readonly string[] => {
  const rows = result.steps.flatMap((step) => {
    const names = [...new Set([...Object.keys(step.expected), ...Object.keys(step.observed)])];
    return names.map((name) => [
      step.step,
      String(step.requests),
      name,
      figureText(step.expected, name),
      figureText(step.observed, name),
      step.mismatches.some((mismatch) => mismatch.startsWith(`${name} `)) ? 'differs' : 'ok',
    ]);
  });
  const planted =
    result.pass === 'planted'
      ? [
          `Planted leaks detected: ${result.plantedDetected.length === 0 ? 'none' : result.plantedDetected.join(', ')}.`,
          `Planted leaks missing: ${result.plantedMissing.length === 0 ? 'none' : result.plantedMissing.join(', ')}.`,
          '',
        ]
      : [];
  return [
    `### ${result.pass} pass`,
    '',
    ...(rows.length === 0
      ? [notMeasured, '']
      : [...markdownTable(['Step', 'Requests', 'Figure', 'Expected', 'Observed', 'Result'], rows), '']),
    ...planted,
  ];
};

const scenarioSection = (readout: Readout): readonly string[] => [
  '## Scenario',
  '',
  ...(readout.scenario.length === 0 ? [notMeasured, ''] : readout.scenario.flatMap(passSection)),
];

const canaryText = (readout: Readout): string => {
  const names = (canary: boolean): string =>
    readout.processes
      .filter(({ folder }) => folder.run.canary === canary)
      .map(({ folder }) => basename(folder.folder))
      .join(', ') || 'none';
  return `on in ${names(true)}; off in ${names(false)}. The token is written to no file.`;
};

const commitText = (readout: Readout): string => {
  const recorded = [...new Set(readout.processes.map(({ folder }) => folder.run.commit ?? 'unknown'))];
  const runner = readout.revision ?? 'unknown';
  return recorded.length === 0 ? runner : `${runner} (runner); ${recorded.join(', ')} (run.json)`;
};

const samplingText = (readout: Readout): string => {
  const blockMs = readout.processes[0]?.folder.run.sampling.block_ms;
  const block = blockMs === undefined ? '' : `, event-loop block over ${blockMs} ms`;
  return `steps on 1 in ${readout.sampling.stepN} requests, CPU on 1 in ${readout.sampling.cpuN}${block}`;
};

const overheadSection = (readout: Readout): readonly string[] => {
  const { overhead } = readout;
  if (overhead.routes.length === 0) {
    return ['## Overhead', '', notMeasured, ''];
  }
  return [
    '## Overhead',
    '',
    overheadSentence(overhead),
    '',
    ...markdownTable(
      ['Route', 'Normal CPU µs/req', 'Diag CPU µs/req', 'Ratio', 'Status'],
      overhead.routes.map((route) => [
        route.route,
        formatMicroseconds(route.normal),
        formatMicroseconds(route.diag),
        ratioText(route.ratio),
        route.status,
      ]),
    ),
    '',
    `Medians of the server CPU per request over the measured rounds of each build; the line is ${overheadLine.toFixed(2)} on hello at the default sampling.`,
    '',
  ];
};

function renderReadout(readout: Readout): string {
  return [
    `# skeld diag readout ${readout.runId}`,
    '',
    '## Run header',
    '',
    ...keyValueTable([
      ['Commit', commitText(readout)],
      ['Node', readout.node],
      ['Sampling', samplingText(readout)],
      ['Canary', canaryText(readout)],
    ]),
    '',
    ...overheadSection(readout),
    ...perRouteSections(
      readout,
      'Stages per route',
      stageSection,
      'Self wall is inclusive time minus children. Self CPU is the thread CPU a request used while it was the current request, so a span that crosses callbacks counts its active work and not its waiting. p50 and p95 are medians of per-window values, not run-wide percentiles.',
    ),
    ...perRouteSections(readout, 'Steps per route', stepSection, null),
    ...processSection(readout),
    ...limitsSection(readout),
    ...eventsSection(readout),
    ...findingsSection(readout),
    ...scenarioSection(readout),
    '## Warnings',
    '',
    ...(readout.warnings.length === 0 ? ['None.'] : readout.warnings.map((warning) => `- ${warning}`)),
    '',
  ].join('\n');
}

export function recorderWarnings(processes: readonly DiagProcess[], revision: string | null): readonly string[] {
  const warnings: string[] = [];
  for (const { folder } of processes) {
    const name = basename(folder.folder);
    const { commit } = folder.run;
    if (revision !== null && commit !== null && !commit.startsWith(revision) && !revision.startsWith(commit)) {
      warnings.push(`${name}/run.json records commit ${commit}, not the runner's ${revision}.`);
    }
    const suppressed = Object.values(lastLine(folder)?.events ?? {}).reduce(
      (total, event) => total + event.run_suppressed,
      0,
    );
    if (suppressed > 0) {
      warnings.push(
        `${name}: ${plural(suppressed, 'journal line was', 'journal lines were')} suppressed past 10 per event per second; the snapshot counts every event.`,
      );
    }
  }
  return warnings;
}

export function readoutPath(diagFolder: string): string {
  return join(diagFolder, readoutFile);
}

export function writeReadout(diagFolder: string, readout: Readout): void {
  writeFileSync(readoutPath(diagFolder), renderReadout(readout));
}
