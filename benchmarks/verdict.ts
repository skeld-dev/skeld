// Does:  Decides the verdict: keep, below the line, or not assessed with the reason.
// Holds: A run that deviates from the protocol, was interrupted or was generator-bound is never assessed.

import { defaultServerIds, routeIds } from './options.ts';
import type { BenchSample, BenchSummary, BenchVerdict, RouteId, RunOptions } from './types.ts';
import {
  defaultDurationSeconds,
  defaultPipelining,
  defaultRounds,
  defaultWarmUpSeconds,
  keepLinePercent,
  protocolFastify,
  protocolNode,
  serverCores,
} from './values.ts';

interface Installed {
  readonly node: string;
  readonly fastify: string;
  readonly nodeOptions: string | null;
  readonly pinning: string | null;
}

export type RunEnding =
  | { readonly status: 'complete' }
  | { readonly status: 'interrupted'; readonly round: number | null }
  | { readonly status: 'invalid'; readonly reason: string };

const roundsText = (count: number): string => `${count} ${count === 1 ? 'round' : 'rounds'}`;

export function deviations(options: RunOptions, installed: Installed): readonly string[] {
  const found: string[] = [];
  if (options.pipelining !== defaultPipelining) {
    found.push(`-p ${options.pipelining}, not -p ${defaultPipelining}`);
  }
  if (options.warmUpSeconds !== defaultWarmUpSeconds) {
    found.push(`warm-up ${options.warmUpSeconds} s, not ${defaultWarmUpSeconds} s`);
  }
  if (options.durationSeconds !== defaultDurationSeconds) {
    found.push(`-d ${options.durationSeconds}, not -d ${defaultDurationSeconds}`);
  }
  if (options.rounds !== defaultRounds) {
    found.push(`${roundsText(options.rounds)}, not ${defaultRounds}`);
  }
  const missing = defaultServerIds.filter((server) => !options.servers.includes(server));
  if (!options.diag && missing.length > 0) {
    found.push(`servers ${options.servers.join(',')} only`);
  }
  if (!options.diag && options.routes.length !== routeIds.length) {
    found.push(`route ${options.routes.join(',')} only`);
  }
  if (installed.node !== protocolNode) {
    found.push(`Node ${installed.node.replace(/^v/, '')}, not ${protocolNode.replace(/^v/, '')}`);
  }
  if (!options.diag && installed.fastify !== protocolFastify) {
    found.push(`Fastify ${installed.fastify}, not ${protocolFastify}`);
  }
  if (installed.nodeOptions !== null) {
    found.push(`NODE_OPTIONS=${JSON.stringify(installed.nodeOptions)}`);
  }
  if (installed.pinning !== null) {
    found.push(installed.pinning);
  }
  return found;
}

const skeldPercent = (summary: readonly BenchSummary[], route: RouteId): number | null =>
  summary.find((group) => group.server === 'skeld' && group.route === route)?.cpuPercentOfFastify ?? null;

export function generatorBottleneckText(generatorBound: number, measured: number): string {
  return `the load generator was the bottleneck in ${generatorBound} of ${measured} measured rounds`;
}

const endingReason = (ending: RunEnding): string | null => {
  if (ending.status === 'invalid') {
    return `The run is invalid: ${ending.reason}.`;
  }
  if (ending.status === 'interrupted') {
    return ending.round === null
      ? 'The run was interrupted during the security scenario.'
      : `The run was interrupted in round ${ending.round}.`;
  }
  return null;
};

const diagReason = 'Diag mode compares builds, not frameworks.';

export function notAssessedReason(
  ending: RunEnding,
  found: readonly string[],
  samples: readonly BenchSample[],
): string | null {
  const ended = endingReason(ending);
  if (ended !== null) {
    return ended;
  }
  if (found.length > 0) {
    return `This run differs from the acceptance protocol: ${found.join('; ')}.`;
  }
  const measured = samples.filter((sample) => sample.kind === 'measured');
  const strayCores = measured.find((sample) => sample.serverCores !== serverCores);
  if (strayCores !== undefined) {
    return `The run was not pinned: ${strayCores.server} in round ${strayCores.round} was allowed cores ${strayCores.serverCores ?? 'unknown'}, not ${serverCores}.`;
  }
  if (measured.some((sample) => sample.bound === 'generator' && sample.server !== 'node-http')) {
    const generatorBound = measured.filter((sample) => sample.bound === 'generator').length;
    const text = generatorBottleneckText(generatorBound, measured.length);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }
  return null;
}

export function decideVerdict(
  ending: RunEnding,
  found: readonly string[],
  samples: readonly BenchSample[],
  summary: readonly BenchSummary[],
  diag: boolean,
): BenchVerdict {
  const hello = skeldPercent(summary, 'hello');
  const echo = skeldPercent(summary, 'echo');
  const reason =
    (diag ? (endingReason(ending) ?? diagReason) : notAssessedReason(ending, found, samples)) ??
    (echo === null ? 'The server CPU per request could not be read on this system.' : null);
  const generatorBoundRounds = samples.filter(
    (sample) => sample.kind === 'measured' && sample.bound === 'generator',
  ).length;
  if (reason !== null || echo === null) {
    return { kind: 'not-assessed', linePercent: keepLinePercent, hello, echo, reason, generatorBoundRounds };
  }
  const kind = echo >= keepLinePercent ? 'keep' : 'below';
  return { kind, linePercent: keepLinePercent, hello, echo, reason: null, generatorBoundRounds };
}
