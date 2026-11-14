// Does:  Reduces the measured samples to a median and range per server, build and route.
// Holds: A group's CPU figure is null unless every one of its rounds has one.

import { loggingBuilds } from './schedule.ts';
import type { BenchSample, BenchSpread, BenchSummary, BuildId, RouteId, ServerId } from './types.ts';

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
}

const spread = (values: readonly number[]): BenchSpread => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
});

const cpuSpread = (samples: readonly BenchSample[]): BenchSpread | null => {
  const values = samples.flatMap((sample) =>
    sample.serverCpuMicrosecondsPerRequest === null ? [] : [sample.serverCpuMicrosecondsPerRequest],
  );
  return values.length === samples.length ? spread(values) : null;
};

const builds: readonly BuildId[] = ['skeld', 'skeld-diag', ...loggingBuilds];

export function summarize(
  samples: readonly BenchSample[],
  servers: readonly ServerId[],
  routes: readonly RouteId[],
): readonly BenchSummary[] {
  return routes.flatMap((route) =>
    builds.flatMap((build) =>
      servers.flatMap((server): BenchSummary[] => {
        const measured = samples.filter(
          (sample) =>
            sample.kind === 'measured' && sample.server === server && sample.build === build && sample.route === route,
        );
        if (measured.length === 0) {
          return [];
        }
        return [
          {
            server,
            build,
            route,
            rounds: measured.length,
            serverCpuMicrosecondsPerRequest: cpuSpread(measured),
            requestsPerSecond: spread(measured.map((sample) => sample.requestsPerSecond)),
            latencyP99Ms: spread(measured.map((sample) => sample.latencyP99Ms)),
          },
        ];
      }),
    ),
  );
}
