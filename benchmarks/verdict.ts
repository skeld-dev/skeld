import { routeIds, serverIds } from './options.ts';
import type { BenchSample, BenchSummary, BenchVerdict, RouteId, RunOptions } from './types.ts';
import {
  defaultDurationSeconds,
  defaultPipelining,
  defaultRounds,
  keepLinePercent,
  protocolFastify,
  protocolNode,
} from './values.ts';

interface Installed {
  readonly node: string;
  readonly fastify: string;
  readonly nodeOptions: string | null;
}

export type RunEnding =
  | { readonly status: 'complete' }
  | { readonly status: 'interrupted'; readonly round: number }
  | { readonly status: 'invalid'; readonly reason: string };

const roundsText = (count: number): string => `${count} ${count === 1 ? 'round' : 'rounds'}`;

export function deviations(options: RunOptions, installed: Installed): readonly string[] {
  const found: string[] = [];
  if (options.pipelining !== defaultPipelining) {
    found.push(`-p ${options.pipelining}, not -p ${defaultPipelining}`);
  }
  if (options.durationSeconds !== defaultDurationSeconds) {
    found.push(`-d ${options.durationSeconds}, not -d ${defaultDurationSeconds}`);
  }
  if (options.rounds !== defaultRounds) {
    found.push(`${roundsText(options.rounds)}, not ${defaultRounds}`);
  }
  if (options.servers.length !== serverIds.length) {
    found.push(`servers ${options.servers.join(',')} only`);
  }
  if (options.routes.length !== routeIds.length) {
    found.push(`route ${options.routes.join(',')} only`);
  }
  if (installed.node !== protocolNode) {
    found.push(`Node ${installed.node.replace(/^v/, '')}, not ${protocolNode.replace(/^v/, '')}`);
  }
  if (installed.fastify !== protocolFastify) {
    found.push(`Fastify ${installed.fastify}, not ${protocolFastify}`);
  }
  if (installed.nodeOptions !== null) {
    found.push(`NODE_OPTIONS=${JSON.stringify(installed.nodeOptions)}`);
  }
  return found;
}

const darkstartPercent = (summary: readonly BenchSummary[], route: RouteId): number | null =>
  summary.find((group) => group.server === 'darkstart' && group.route === route)?.percentOfFastify ?? null;

export function generatorBottleneckText(generatorBound: number, measured: number): string {
  return `the load generator was the bottleneck in ${generatorBound} of ${measured} measured rounds`;
}

const notAssessedReason = (
  ending: RunEnding,
  found: readonly string[],
  samples: readonly BenchSample[],
): string | null => {
  if (ending.status === 'invalid') {
    return `The run is invalid: ${ending.reason}.`;
  }
  if (ending.status === 'interrupted') {
    return `The run was interrupted in round ${ending.round}.`;
  }
  if (found.length > 0) {
    return `This run differs from the acceptance protocol: ${found.join('; ')}.`;
  }
  const measured = samples.filter((sample) => sample.kind === 'measured');
  if (measured.some((sample) => sample.bound === 'generator' && sample.server !== 'node-http')) {
    const generatorBound = measured.filter((sample) => sample.bound === 'generator').length;
    const text = generatorBottleneckText(generatorBound, measured.length);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }
  return null;
};

export function decideVerdict(
  ending: RunEnding,
  found: readonly string[],
  samples: readonly BenchSample[],
  summary: readonly BenchSummary[],
): BenchVerdict {
  const hello = darkstartPercent(summary, 'hello');
  const echo = darkstartPercent(summary, 'echo');
  const reason = notAssessedReason(ending, found, samples);
  const generatorBoundRounds = samples.filter(
    (sample) => sample.kind === 'measured' && sample.bound === 'generator',
  ).length;
  if (reason !== null) {
    return { kind: 'not-assessed', linePercent: keepLinePercent, hello, echo, reason, generatorBoundRounds };
  }
  if (hello === null || echo === null) {
    throw new Error('a complete, conforming run has no DarkStart ratio for hello or echo');
  }
  const kind = hello >= keepLinePercent && echo >= keepLinePercent ? 'keep' : 'below';
  return { kind, linePercent: keepLinePercent, hello, echo, reason: null, generatorBoundRounds };
}
