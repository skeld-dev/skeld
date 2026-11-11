// Does:  Reduces the measured samples to a median and range per server and route, with ratios to Fastify.
// Holds: A group's CPU figure is null unless every one of its rounds has one.

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

interface Group {
  readonly server: ServerId;
  readonly build: BuildId;
  readonly route: RouteId;
  readonly rounds: number;
  readonly serverCpuMicrosecondsPerRequest: BenchSpread | null;
  readonly requestsPerSecond: BenchSpread;
  readonly latencyP99Ms: BenchSpread;
}

const percentOf = (value: number, reference: Group | undefined): number | null =>
  reference === undefined ? null : (value / reference.requestsPerSecond.median) * 100;

const cpuPercentOf = (group: Group, reference: Group | undefined): number | null => {
  const own = group.serverCpuMicrosecondsPerRequest;
  const other = reference?.serverCpuMicrosecondsPerRequest ?? null;
  return own === null || other === null ? null : (other.median / own.median) * 100;
};

const cpuSpread = (samples: readonly BenchSample[]): BenchSpread | null => {
  const values = samples.flatMap((sample) =>
    sample.serverCpuMicrosecondsPerRequest === null ? [] : [sample.serverCpuMicrosecondsPerRequest],
  );
  return values.length === samples.length ? spread(values) : null;
};

const builds: readonly BuildId[] = ['darkstart', 'darkstart-diag'];

export function summarize(
  samples: readonly BenchSample[],
  servers: readonly ServerId[],
  routes: readonly RouteId[],
): readonly BenchSummary[] {
  const groups = routes.flatMap((route) =>
    builds.flatMap((build) =>
      servers.flatMap((server): Group[] => {
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
  return groups.map((group) => {
    const sameRoute = (server: ServerId): Group | undefined =>
      groups.find((other) => other.route === group.route && other.build === group.build && other.server === server);
    return {
      ...group,
      cpuPercentOfFastify: cpuPercentOf(group, sameRoute('fastify')),
      percentOfFastify: percentOf(group.requestsPerSecond.median, sameRoute('fastify')),
      percentOfNodeHttp: percentOf(group.requestsPerSecond.median, sameRoute('node-http')),
    };
  });
}
