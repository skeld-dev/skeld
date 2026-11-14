// Does:  Records protocol deviations and gates the diagnostic and logging overhead assessments.
// Holds: A run that deviates from the protocol, was interrupted or was generator-bound is never assessed.

import { routeIds } from './options.ts';
import type { BenchSample, RunOptions } from './types.ts';
import {
  defaultDurationSeconds,
  defaultPipelining,
  defaultRounds,
  defaultWarmUpSeconds,
  loggingRounds,
  protocolNode,
  serverCores,
} from './values.ts';

interface Installed {
  readonly node: string;
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
  const protocolRounds = options.logging === null ? defaultRounds : loggingRounds;
  if (protocolRounds === null) {
    found.push(`${roundsText(options.rounds)}; the logging round count is not measured yet`);
  } else if (options.rounds !== protocolRounds) {
    found.push(`${roundsText(options.rounds)}, not ${protocolRounds}`);
  }
  if (!options.diag && options.logging === null && options.routes.length !== routeIds.length) {
    found.push(`route ${options.routes.join(',')} only`);
  }
  if (installed.node !== protocolNode) {
    found.push(`Node ${installed.node.replace(/^v/, '')}, not ${protocolNode.replace(/^v/, '')}`);
  }
  if (installed.nodeOptions !== null) {
    found.push(`NODE_OPTIONS=${JSON.stringify(installed.nodeOptions)}`);
  }
  if (installed.pinning !== null) {
    found.push(installed.pinning);
  }
  return found;
}

function generatorBottleneckText(generatorBound: number, measured: number): string {
  return `the load generator was the bottleneck in ${generatorBound} of ${measured} measured rounds`;
}

export const endingReason = (ending: RunEnding): string | null => {
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
  if (measured.some((sample) => sample.bound === 'generator')) {
    const generatorBound = measured.filter((sample) => sample.bound === 'generator').length;
    const text = generatorBottleneckText(generatorBound, measured.length);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }
  return null;
}
