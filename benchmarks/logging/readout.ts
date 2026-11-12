// Does:  Decides a logging session from round-paired ratios of server CPU per request and writes its readout.
// Holds: A ratio pairs two entrants of the same round and route; the verdict is void unless the control is in its band.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyValueTable, markdownTable } from '../report.ts';
import { sessionBuilds } from '../schedule.ts';
import { median } from '../statistics.ts';
import { formatMicroseconds, plural } from '../terminal.ts';
import type { BenchSample, BenchSummary, LoggingBuildId, LoggingSession, RouteId } from '../types.ts';
import { accessLogBudget, controlBand, defaultLogBudget, loggingReadoutFile } from '../values.ts';

type SessionVerdict = 'void' | 'within' | 'over';
type RatioName = 'control' | 'default' | 'access';

interface RatioRule {
  readonly name: RatioName;
  readonly numerator: LoggingBuildId;
  readonly denominator: LoggingBuildId;
  readonly budget: number | null;
}

export type CpuSample = Pick<BenchSample, 'round' | 'kind' | 'build' | 'route' | 'serverCpuMicrosecondsPerRequest'>;

export interface RoundRatio {
  readonly round: number;
  readonly ratio: number;
}

interface PairedMedian {
  readonly rule: RatioRule;
  readonly ratios: readonly RoundRatio[];
  readonly median: number | null;
}

export interface SessionResult {
  readonly medians: readonly PairedMedian[];
  readonly verdict: SessionVerdict;
  readonly sentence: string;
}

export interface VisitLines {
  readonly build: LoggingBuildId;
  readonly lines: number;
}

export interface LoggingReadout {
  readonly runId: string;
  readonly status: string;
  readonly revision: string | null;
  readonly node: string;
  readonly session: LoggingSession;
  readonly commandLines: readonly string[];
  readonly rounds: number;
  readonly routes: readonly RouteId[];
  readonly deviations: readonly string[];
  readonly result: SessionResult;
  readonly samples: readonly BenchSample[];
  readonly summary: readonly BenchSummary[];
  readonly lines: readonly VisitLines[];
  readonly warnings: readonly string[];
}

const judgedRoute: RouteId = 'echo';
const controlRule: RatioRule = { name: 'control', numerator: 'before-b', denominator: 'before-a', budget: null };
const variantRules: readonly RatioRule[] = [
  { name: 'default', numerator: 'default', denominator: 'before-a', budget: defaultLogBudget },
  { name: 'access', numerator: 'access', denominator: 'default', budget: accessLogBudget },
];

const ratioText = (value: number | null): string => (value === null ? '-' : value.toFixed(3));
const bandText = `${controlBand.min.toFixed(2)} to ${controlBand.max.toFixed(2)}`;
const ruleText = (rule: RatioRule): string => `${rule.numerator} over ${rule.denominator}`;

const cpuOf = (samples: readonly CpuSample[], build: LoggingBuildId, route: RouteId, round: number): number | null =>
  samples.find(
    (sample) =>
      sample.kind === 'measured' && sample.build === build && sample.route === route && sample.round === round,
  )?.serverCpuMicrosecondsPerRequest ?? null;

// Does:  Takes one ratio per round in which both entrants were measured on the route, in round order.
function pairedRatios(
  samples: readonly CpuSample[],
  numerator: LoggingBuildId,
  denominator: LoggingBuildId,
  route: RouteId,
): readonly RoundRatio[] {
  const rounds = [...new Set(samples.map((sample) => sample.round))].sort((a, b) => a - b);
  return rounds.flatMap((round) => {
    const top = cpuOf(samples, numerator, route, round);
    const bottom = cpuOf(samples, denominator, route, round);
    return top === null || bottom === null || bottom === 0 ? [] : [{ round, ratio: top / bottom }];
  });
}

export const controlRatios = (samples: readonly CpuSample[]): readonly RoundRatio[] =>
  pairedRatios(samples, controlRule.numerator, controlRule.denominator, judgedRoute);

const pairedMedian = (samples: readonly CpuSample[], rule: RatioRule): PairedMedian => {
  const ratios = pairedRatios(samples, rule.numerator, rule.denominator, judgedRoute);
  return { rule, ratios, median: ratios.length === 0 ? null : median(ratios.map(({ ratio }) => ratio)) };
};

const medianStatus = (paired: PairedMedian): string => {
  if (paired.median === null) {
    return 'not measured';
  }
  const { budget } = paired.rule;
  if (budget === null) {
    return paired.median >= controlBand.min && paired.median <= controlBand.max ? 'inside' : 'outside';
  }
  return paired.median <= budget ? 'within' : 'over';
};

const controlText = (control: PairedMedian): string =>
  control.median === null
    ? 'no round measured both before-a and before-b on echo'
    : `the control pair reads ${ratioText(control.median)}, ${medianStatus(control)} ${bandText}`;

const judge = (control: PairedMedian, variants: readonly PairedMedian[]): SessionResult => {
  const medians = [control, ...variants];
  const voided = (sentence: string): SessionResult => ({ medians, verdict: 'void', sentence });
  const controlSentence = controlText(control);
  if (medianStatus(control) !== 'inside') {
    return voided(`${controlSentence}.`);
  }
  const missing = variants.find((variant) => variant.median === null);
  if (missing !== undefined) {
    return voided(`${controlSentence}, but no round paired ${ruleText(missing.rule)} on echo.`);
  }
  const parts = variants.map(
    (paired) =>
      `${ruleText(paired.rule)} ${ratioText(paired.median)} (at most ${paired.rule.budget?.toFixed(2) ?? '-'}, ${medianStatus(paired)})`,
  );
  const over = variants.some((paired) => medianStatus(paired) !== 'within');
  return {
    medians,
    verdict: over ? 'over' : 'within',
    sentence: `${controlSentence}, inside ${bandText}; ${parts.join('; ')}.`,
  };
};

// Does:  Decides the session's verdict; a control-only or off-protocol run is void with the reason given.
export function decideSession(
  samples: readonly BenchSample[],
  session: LoggingSession,
  notAssessed: string | null,
): SessionResult {
  const control = pairedMedian(samples, controlRule);
  const variants = session.controlOnly ? [] : variantRules.map((rule) => pairedMedian(samples, rule));
  if (session.controlOnly) {
    const reason = notAssessed === null ? '' : ` ${notAssessed}`;
    return {
      medians: [control],
      verdict: 'void',
      sentence: `no budget is judged in a control-only session; ${controlText(control)}.${reason}`,
    };
  }
  if (notAssessed !== null) {
    return { medians: [control, ...variants], verdict: 'void', sentence: notAssessed };
  }
  return judge(control, variants);
}

export const sessionVerdictLine = (result: SessionResult): string =>
  `Verdict: ${result.verdict}. ${result.sentence.charAt(0).toUpperCase()}${result.sentence.slice(1)}`;

const mediansSection = (result: SessionResult): readonly string[] => [
  '## Round-paired medians on echo',
  '',
  ...markdownTable(
    ['Ratio', 'Paired rounds', 'Median', 'Min', 'Max', 'Band or budget', 'Status'],
    result.medians.map((paired) => {
      const values = paired.ratios.map(({ ratio }) => ratio);
      return [
        `${paired.rule.name}: ${ruleText(paired.rule)}`,
        String(paired.ratios.length),
        ratioText(paired.median),
        ratioText(values.length === 0 ? null : Math.min(...values)),
        ratioText(values.length === 0 ? null : Math.max(...values)),
        paired.rule.budget === null ? bandText : `at most ${paired.rule.budget.toFixed(2)}`,
        medianStatus(paired),
      ];
    }),
  ),
  '',
  'Each ratio is taken inside one round, between two entrants measured minutes apart on the same pinned core; the median is over rounds.',
  '',
];

const roundsSection = (readout: LoggingReadout): readonly string[] => {
  const builds = sessionBuilds(readout.session);
  const rules = readout.result.medians.map((paired) => paired.rule);
  const rounds = [...new Set(readout.samples.map((sample) => sample.round))].sort((a, b) => a - b);
  const rows = readout.routes.flatMap((route) =>
    rounds.map((round) => {
      const ratioIn = (rule: RatioRule): number | null =>
        pairedRatios(readout.samples, rule.numerator, rule.denominator, route).find((paired) => paired.round === round)
          ?.ratio ?? null;
      return [
        String(round),
        route,
        ...builds.map((build) => formatMicroseconds(cpuOf(readout.samples, build, route, round))),
        ...rules.map((rule) => ratioText(ratioIn(rule))),
      ];
    }),
  );
  return [
    '## Server CPU µs per request, per round and route',
    '',
    ...(rows.length === 0
      ? ['Not measured.']
      : markdownTable(['Round', 'Route', ...builds, ...rules.map((rule) => ruleText(rule))], rows)),
    '',
  ];
};

const spreadSection = (readout: LoggingReadout): readonly string[] => {
  const rows = readout.summary.flatMap((group) => {
    const cpu = group.serverCpuMicrosecondsPerRequest;
    return cpu === null
      ? [[group.build, group.route, String(group.rounds), '-', '-', '-', '-']]
      : [
          [
            group.build,
            group.route,
            String(group.rounds),
            formatMicroseconds(cpu.median),
            formatMicroseconds(cpu.min),
            formatMicroseconds(cpu.max),
            `${(((cpu.max - cpu.min) / cpu.median) * 100).toFixed(1)} %`,
          ],
        ];
  });
  return [
    '## Spread per variant',
    '',
    ...(rows.length === 0
      ? ['Not measured.']
      : markdownTable(['Variant', 'Route', 'Rounds', 'Median', 'Min', 'Max', 'Max minus min over median'], rows)),
    '',
  ];
};

const linesSection = (readout: LoggingReadout): readonly string[] => {
  const rows = sessionBuilds(readout.session).map((build) => {
    const visits = readout.lines.filter((visit) => visit.build === build);
    const lines = visits.reduce((total, visit) => total + visit.lines, 0);
    const requests = readout.samples
      .filter((sample) => sample.build === build)
      .reduce((total, sample) => total + sample.requests, 0);
    return [
      build,
      String(visits.length),
      String(lines),
      String(requests),
      requests === 0 ? '-' : (lines / requests).toFixed(4),
    ];
  });
  return [
    '## Stdout lines per variant',
    '',
    ...markdownTable(
      ['Variant', 'Visits', 'Lines counted', 'Requests (warm-up and measured)', 'Lines per request'],
      rows,
    ),
    '',
    "Every stdout line but the ready line, from each measured visit's start to its exit; stdout is a pipe the runner drains.",
    '',
  ];
};

function renderReadout(readout: LoggingReadout): string {
  return [
    `# Skeld logging readout ${readout.runId}`,
    '',
    sessionVerdictLine(readout.result),
    '',
    '## Session',
    '',
    ...keyValueTable([
      ['Status', readout.status],
      ['Commit', readout.revision ?? 'unknown'],
      ['Baseline', readout.session.baseline],
      ['Node', readout.node],
      ['Entrants', sessionBuilds(readout.session).join(', ')],
      ['Servers', readout.commandLines.join('; ')],
      ['Rounds', plural(readout.rounds, 'round', 'rounds')],
      ['Routes', `${readout.routes.join(', ')}; echo is judged`],
      ['Protocol', readout.deviations.length === 0 ? 'conforming' : readout.deviations.join('; ')],
    ]),
    '',
    ...mediansSection(readout.result),
    ...roundsSection(readout),
    ...spreadSection(readout),
    ...linesSection(readout),
    '## Warnings',
    '',
    ...(readout.warnings.length === 0 ? ['None.'] : readout.warnings.map((warning) => `- ${warning}`)),
    '',
  ].join('\n');
}

export function loggingReadoutPath(runDirectory: string): string {
  return join(runDirectory, loggingReadoutFile);
}

export function writeLoggingReadout(runDirectory: string, readout: LoggingReadout): void {
  writeFileSync(loggingReadoutPath(runDirectory), renderReadout(readout));
}
