export type ServerId = 'darkstart' | 'fastify' | 'node-http' | 'hono' | 'express' | 'light';
export type RouteId = 'hello' | 'echo';
type RunStatus = 'complete' | 'invalid' | 'interrupted';
export type Bound = 'server' | 'generator' | 'neither' | 'unknown';
type VerdictKind = 'keep' | 'below' | 'not-assessed';

export interface RunOptions {
  readonly pipelining: number;
  readonly warmUpSeconds: number;
  readonly durationSeconds: number;
  readonly rounds: number;
  readonly servers: readonly ServerId[];
  readonly routes: readonly RouteId[];
  readonly out: string;
  readonly check: boolean;
}

export interface BenchOptions {
  readonly connections: 100;
  readonly workers: 3;
  readonly pipelining: number;
  readonly warmUpSeconds: number;
  readonly durationSeconds: number;
  readonly rounds: number;
  readonly servers: readonly ServerId[];
  readonly routes: readonly RouteId[];
}

export interface BenchMachine {
  readonly cpuModel: string | null;
  readonly cores: number;
  readonly memoryBytes: number;
  readonly osName: string | null;
  readonly kernel: string;
  readonly virtualMachine: boolean | null;
  readonly runnerCores: string | null;
  readonly unpinnedReason: string | null;
  readonly loadAverageStart: number;
  readonly loadAverageEnd: number;
}

export interface BenchSoftware {
  readonly node: string;
  readonly runnerCommandLine: readonly string[];
  readonly serverCommandLine: readonly string[];
  readonly serverEnvironment: { readonly NODE_ENV: 'production' };
  readonly nodeOptions: string | null;
  readonly darkstart: string;
  readonly darkstartResolvedFrom: string;
  readonly revision: string | null;
  readonly uncommittedChanges: boolean | null;
  readonly fastify: string;
  readonly autocannon: string;
  readonly typebox: string;
  readonly fastJsonStringify: string;
  readonly hono: string;
  readonly honoNodeServer: string;
  readonly express: string;
  readonly light: string;
}

export interface BenchSample {
  readonly round: number;
  readonly position: number;
  readonly server: ServerId;
  readonly route: RouteId;
  readonly kind: 'warm-up' | 'measured';
  readonly requestsPerSecond: number;
  readonly latencyP99Ms: number;
  readonly requests: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly non2xx: number;
  readonly bytesPerResponse: number;
  readonly generatorCpuPercent: number | null;
  readonly serverCpuPercent: number | null;
  readonly serverCpuMicrosecondsPerRequest: number | null;
  readonly serverCores: string | null;
  readonly bound: Bound | null;
  readonly autocannon: unknown;
}

export interface BenchSpread {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

export interface BenchSummary {
  readonly server: ServerId;
  readonly route: RouteId;
  readonly rounds: number;
  readonly serverCpuMicrosecondsPerRequest: BenchSpread | null;
  readonly cpuPercentOfFastify: number | null;
  readonly requestsPerSecond: BenchSpread;
  readonly latencyP99Ms: BenchSpread;
  readonly percentOfFastify: number | null;
  readonly percentOfNodeHttp: number | null;
}

export interface BenchVerdict {
  readonly kind: VerdictKind;
  readonly linePercent: 100;
  readonly hello: number | null;
  readonly echo: number | null;
  readonly reason: string | null;
  readonly generatorBoundRounds: number;
}

export interface BenchRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly options: BenchOptions;
  readonly conforming: boolean;
  readonly deviations: readonly string[];
  readonly machine: BenchMachine;
  readonly software: BenchSoftware;
  readonly samples: readonly BenchSample[];
  readonly summary: readonly BenchSummary[];
  readonly verdict: BenchVerdict;
  readonly warnings: readonly string[];
}

export interface Visit {
  readonly round: number;
  readonly position: number;
  readonly server: ServerId;
}

export interface CheckRow {
  readonly server: ServerId;
  readonly route: RouteId;
  readonly started: boolean;
  readonly status: number | null;
  readonly mediaType: string | null;
  readonly bytes: number | null;
  readonly body: string | null;
  readonly passed: boolean;
}
