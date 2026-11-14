// Does:  Runs the schedule: for each visit, start the server, warm up, measure and stop.
// Holds: One server runs at a time; an interrupt ends the schedule after the current step.

import { BenchError } from './bench-error.ts';
import { preflightRoutes } from './check.ts';
import { classifyBound, splitPerRequest, startCpuSample } from './cpu.ts';
import { startTarget, type Target } from './diag/builds.ts';
import { type Autocannon, type AutocannonResult, startLoad } from './load.ts';
import { allowedCores, type Command } from './pinning.ts';
import { preflightFailure } from './preflight.ts';
import { scheduleVisits } from './schedule.ts';
import { describeExit, type ExitStatus, indentTail, type ServerProcess } from './server-process.ts';
import {
  entrantLabel,
  generatorWarning,
  killedWarning,
  measuredLine,
  procUnavailableWarning,
  startedLine,
  stoppedLine,
  warmUpLine,
} from './terminal.ts';
import type { BenchSample, RouteId, RunOptions, Visit } from './types.ts';

interface ScheduleContext {
  readonly options: RunOptions;
  readonly external: string | null;
  readonly autocannon: Autocannon;
  readonly serverCommand: Command;
  readonly target: (visit: Visit) => Target;
  readonly samples: BenchSample[];
  readonly interruption: Promise<void>;
  readonly interrupted: () => boolean;
  readonly track: (server: ServerProcess | null) => void;
  readonly enterRound: (round: number) => void;
  readonly warn: (text: string) => void;
  readonly progress: (line: string) => void;
}

type LoadOutcome =
  | { readonly kind: 'result'; readonly result: AutocannonResult }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'exited'; readonly status: ExitStatus }
  | { readonly kind: 'interrupted' };

const inRound = (error: BenchError, round: number): BenchError => {
  const marker = ' Its last output:';
  const message = error.message.endsWith(marker)
    ? `${error.message.slice(0, -marker.length)} In round ${round}.${marker}`
    : `${error.message} In round ${round}.`;
  return new BenchError(4, message, error.detail);
};

const statusCounts = (result: AutocannonResult): string => {
  const counts = Object.entries(result.statusCodeStats)
    .filter(([code]) => !code.startsWith('2'))
    .map(([code, stats]) => `${code}: ${stats.count}`);
  return counts.length === 0 ? '' : ` (${counts.join(', ')})`;
};

const invalidReason = (label: string, sample: BenchSample): string => {
  const parts = [
    sample.errors > 0 ? `${sample.errors} errors` : null,
    sample.timeouts > 0 ? `${sample.timeouts} timeouts` : null,
    sample.non2xx > 0 ? `${sample.non2xx} non-2xx responses` : null,
  ].filter((part) => part !== null);
  return `${label} ${parts.length === 0 ? 'completed no requests' : `had ${parts.join(' and ')}`}`;
};

const isValid = (sample: BenchSample): boolean =>
  sample.errors === 0 && sample.timeouts === 0 && sample.non2xx === 0 && sample.requests > 0;

const awaitLoad = (
  context: ScheduleContext,
  server: ServerProcess,
  run: PromiseLike<AutocannonResult>,
): Promise<LoadOutcome> =>
  Promise.race([
    Promise.resolve(run).then(
      (result): LoadOutcome => ({ kind: 'result', result }),
      (error: unknown): LoadOutcome => ({ kind: 'failed', error }),
    ),
    server.exited.then((status): LoadOutcome => ({ kind: 'exited', status })),
    context.interruption.then((): LoadOutcome => ({ kind: 'interrupted' })),
  ]);

const measureRoute = async (
  context: ScheduleContext,
  visit: Visit,
  server: ServerProcess,
  serverCores: string | null,
  route: RouteId,
  kind: BenchSample['kind'],
): Promise<BenchSample | null> => {
  const { options } = context;
  const name = entrantLabel(visit);
  const label = `round ${visit.round} ${name} ${route}`;
  if (kind === 'warm-up') {
    context.progress(warmUpLine(visit.round, options.rounds, name, route, options.warmUpSeconds));
  }
  const sampleCpu = kind === 'measured' ? startCpuSample(server.pid) : null;
  const seconds = kind === 'measured' ? options.durationSeconds : options.warmUpSeconds;
  const windowStartMs = Date.now();
  const run = startLoad(context.autocannon, server.port, route, options.pipelining, seconds);
  const outcome = await awaitLoad(context, server, run);
  const windowEndMs = Date.now();
  const reading = sampleCpu?.() ?? null;
  if (outcome.kind === 'interrupted') {
    run.stop();
    return null;
  }
  if (outcome.kind === 'exited') {
    run.stop();
    throw new BenchError(
      4,
      `${name} exited with ${describeExit(outcome.status)} during round ${visit.round} ${route}. Its last output:`,
      indentTail(server.stderrTail()),
    );
  }
  if (outcome.kind === 'failed') {
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    throw new BenchError(4, `autocannon failed in ${label}: ${message}.`);
  }
  const { result } = outcome;
  const serverCpuMicroseconds = reading?.serverCpuMicroseconds ?? null;
  const serverCpuSplit = reading?.serverCpuSplitMicroseconds ?? null;
  const sample: BenchSample = {
    round: visit.round,
    position: visit.position,
    server: visit.server,
    build: visit.build,
    route,
    kind,
    windowStartMs,
    windowEndMs,
    requestsPerSecond: result.requests.average,
    latencyP99Ms: result.latency.p99,
    requests: result.requests.total,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    bytesPerResponse: result.requests.total === 0 ? 0 : Math.round(result.throughput.total / result.requests.total),
    generatorCpuPercent: reading?.generatorCpuPercent ?? null,
    serverCpuPercent: reading?.serverCpuPercent ?? null,
    serverCpuMicrosecondsPerRequest:
      serverCpuMicroseconds === null || result.requests.total === 0
        ? null
        : serverCpuMicroseconds / result.requests.total,
    serverCpuSplitMicrosecondsPerRequest:
      serverCpuSplit === null || result.requests.total === 0
        ? null
        : splitPerRequest(serverCpuSplit, result.requests.total),
    serverCores,
    bound: reading === null ? null : classifyBound(reading),
    autocannon: result,
  };
  context.samples.push(sample);
  if (!isValid(sample)) {
    throw new BenchError(
      4,
      `${label} had ${sample.errors} errors, ${sample.timeouts} timeouts and ${sample.non2xx} non-2xx responses${statusCounts(result)}. The run is invalid.`,
      [],
      invalidReason(label, sample),
    );
  }
  if (kind === 'measured') {
    context.progress(measuredLine(options.rounds, sample));
  }
  if (reading !== null && sample.bound === 'generator') {
    context.warn(generatorWarning(sample, reading.generatorCpuPercent));
  }
  if (
    reading !== null &&
    reading.serverCpuPercent === null &&
    context.samples.filter((other) => other.kind === 'measured' && other.serverCpuPercent === null).length === 1
  ) {
    context.warn(procUnavailableWarning);
  }
  return sample;
};

const measureRoutes = async (context: ScheduleContext, visit: Visit, server: ServerProcess): Promise<boolean> => {
  const serverCores = allowedCores(server.pid);
  for (const route of context.options.routes) {
    for (const kind of ['warm-up', 'measured'] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: rounds run one after another; concurrent load would measure itself.
      if ((await measureRoute(context, visit, server, serverCores, route, kind)) === null) {
        return false;
      }
    }
  }
  return true;
};

const startVisit = async (context: ScheduleContext, visit: Visit): Promise<ServerProcess> => {
  try {
    return await startTarget(context.target(visit), context.serverCommand, 4);
  } catch (error) {
    if (error instanceof BenchError) {
      throw inRound(error, visit.round);
    }
    throw error;
  }
};

const runVisit = async (context: ScheduleContext, visit: Visit): Promise<boolean> => {
  const { options } = context;
  context.enterRound(visit.round);
  const name = entrantLabel(visit);
  const server = await startVisit(context, visit);
  context.track(server);
  context.progress(startedLine(visit.round, options.rounds, name, server.port, server.startMs));
  let completed = false;
  try {
    if (context.interrupted()) {
      return false;
    }
    const rows = await preflightRoutes(server, options.routes);
    const failed = rows.find((row) => !row.passed);
    if (failed !== undefined) {
      throw inRound(new BenchError(4, `${preflightFailure(failed)}.`), visit.round);
    }
    completed = !context.interrupted() && (await measureRoutes(context, visit, server));
    return completed;
  } finally {
    if (await server.stop()) {
      context.warn(killedWarning(name));
    }
    context.track(null);
    if (completed) {
      context.progress(stoppedLine(visit.round, options.rounds, name));
    }
  }
};

export async function runSchedule(context: ScheduleContext): Promise<'complete' | 'interrupted'> {
  for (const visit of scheduleVisits(context.options, context.external)) {
    // biome-ignore lint/performance/noAwaitInLoops: one server runs at a time; the schedule is sequential by design.
    if (context.interrupted() || !(await runVisit(context, visit))) {
      return 'interrupted';
    }
  }
  return 'complete';
}
