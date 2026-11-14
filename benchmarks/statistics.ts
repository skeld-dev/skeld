// Does:  Reduces the measured samples to a median and range per server, build and route, and skeld's ratios to them.
// Holds: A group's CPU figure is null unless every one of its rounds has one.

import { loggingBuilds } from './schedule.ts';
import type { BenchRatio, BenchSample, BenchSpread, BenchSummary, BuildId, RouteId } from './types.ts';

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

const builds: readonly BuildId[] = ['skeld', 'skeld-diag', 'external', ...loggingBuilds];

export function summarize(
  samples: readonly BenchSample[],
  servers: readonly string[],
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

// Does:  Divides skeld's medians by the external entrant's on each route where both were measured.
export function ratiosToExternal(summary: readonly BenchSummary[], routes: readonly RouteId[]): readonly BenchRatio[] {
  return routes.flatMap((route): BenchRatio[] => {
    const own = summary.find((group) => group.route === route && group.build === 'skeld' && group.server === 'skeld');
    const other = summary.find((group) => group.route === route && group.build === 'external');
    if (own === undefined || other === undefined) {
      return [];
    }
    const ownCpu = own.serverCpuMicrosecondsPerRequest;
    const otherCpu = other.serverCpuMicrosecondsPerRequest;
    return [
      {
        route,
        serverCpuMicrosecondsPerRequest: ownCpu === null || otherCpu === null ? null : ownCpu.median / otherCpu.median,
        requestsPerSecond: own.requestsPerSecond.median / other.requestsPerSecond.median,
      },
    ];
  });
}
