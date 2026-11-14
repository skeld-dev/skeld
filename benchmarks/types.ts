// Does:  Declares the benchmark's shapes: options, samples, summaries and the run.
// Holds: HTTP samples measure skeld; optional sessions distinguish its builds.

export type ServerId = 'skeld';
export type RouteId = 'hello' | 'echo';
export type LoggingBuildId = 'before-a' | 'before-b' | 'off' | 'default' | 'access';
export type BuildId = 'skeld' | 'skeld-diag' | LoggingBuildId;
type RunStatus = 'complete' | 'invalid' | 'interrupted';
export type Bound = 'server' | 'generator' | 'neither' | 'unknown';

export interface LoggingSession {
  readonly baseline: string;
  readonly controlOnly: boolean;
}

export interface RunOptions {
  readonly pipelining: number;
  readonly warmUpSeconds: number;
  readonly durationSeconds: number;
  readonly rounds: number;
  readonly servers: readonly ServerId[];
  readonly routes: readonly RouteId[];
  readonly out: string;
  readonly check: boolean;
  readonly diag: boolean;
  readonly logging: LoggingSession | null;
  readonly stepN: number;
  readonly cpuN: number;
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
  readonly diag: boolean;
  readonly logging: LoggingSession | null;
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
  readonly diagServerCommandLine: readonly string[] | null;
  readonly serverEnvironment: { readonly NODE_ENV: 'production' };
  readonly nodeOptions: string | null;
  readonly skeld: string;
  readonly skeldResolvedFrom: string;
  readonly revision: string | null;
  readonly uncommittedChanges: boolean | null;
  readonly autocannon: string;
}

export interface BenchSample {
  readonly round: number;
  readonly position: number;
  readonly server: ServerId;
  readonly build: BuildId;
  readonly route: RouteId;
  readonly kind: 'warm-up' | 'measured';
  readonly windowStartMs: number;
  readonly windowEndMs: number;
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
  readonly build: BuildId;
  readonly route: RouteId;
  readonly rounds: number;
  readonly serverCpuMicrosecondsPerRequest: BenchSpread | null;
  readonly requestsPerSecond: BenchSpread;
  readonly latencyP99Ms: BenchSpread;
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
  readonly statusReason: string | null;
  readonly warnings: readonly string[];
}

export interface Visit {
  readonly round: number;
  readonly position: number;
  readonly server: ServerId;
  readonly build: BuildId;
}

export interface CheckRow {
  readonly server: string;
  readonly route: RouteId;
  readonly started: boolean;
  readonly status: number | null;
  readonly mediaType: string | null;
  readonly bytes: number | null;
  readonly body: string | null;
  readonly passed: boolean;
}
