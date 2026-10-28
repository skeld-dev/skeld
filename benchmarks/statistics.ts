import type { BenchSample, BenchSpread, BenchSummary, RouteId, ServerId } from './types.ts';

function median(values: readonly number[]): number {
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
  readonly route: RouteId;
  readonly rounds: number;
  readonly requestsPerSecond: BenchSpread;
  readonly latencyP99Ms: BenchSpread;
}

const percentOf = (value: number, reference: Group | undefined): number | null =>
  reference === undefined ? null : (value / reference.requestsPerSecond.median) * 100;

export function summarize(
  samples: readonly BenchSample[],
  servers: readonly ServerId[],
  routes: readonly RouteId[],
): readonly BenchSummary[] {
  const groups = routes.flatMap((route) =>
    servers.flatMap((server): Group[] => {
      const measured = samples.filter(
        (sample) => sample.kind === 'measured' && sample.server === server && sample.route === route,
      );
      if (measured.length === 0) {
        return [];
      }
      return [
        {
          server,
          route,
          rounds: measured.length,
          requestsPerSecond: spread(measured.map((sample) => sample.requestsPerSecond)),
          latencyP99Ms: spread(measured.map((sample) => sample.latencyP99Ms)),
        },
      ];
    }),
  );
  return groups.map((group) => {
    const sameRoute = (server: ServerId): Group | undefined =>
      groups.find((other) => other.route === group.route && other.server === server);
    return {
      ...group,
      percentOfFastify: percentOf(group.requestsPerSecond.median, sameRoute('fastify')),
      percentOfNodeHttp: percentOf(group.requestsPerSecond.median, sameRoute('node-http')),
    };
  });
}
