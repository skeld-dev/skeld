// Does:  Declares the benchmark's shapes: options, samples, summaries, the comparison and the run.
// Holds: HTTP samples measure skeld, and at most one external entrant whose build is always external.

export type ServerId = 'skeld';
export type RouteId = 'hello' | 'echo';
export type LoggingBuildId = 'before-a' | 'before-b' | 'off' | 'default' | 'access';
export type BuildId = 'skeld' | 'skeld-diag' | 'external' | LoggingBuildId;
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
  readonly against: string | null;
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
  readonly servers: readonly string[];
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
  readonly server: string;
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
  readonly serverCpuSplitMicrosecondsPerRequest: CpuSplit | null;
  readonly serverCores: string | null;
  readonly bound: Bound | null;
  readonly autocannon: unknown;
}

// Does:  Splits a server's CPU microseconds two ways: user against system, and main thread against the others.
// Holds: In one reading, user + system and mainThread + otherThreads each equal the total; medians need not.
export interface CpuSplit {
  readonly user: number;
  readonly system: number;
  readonly mainThread: number;
  readonly otherThreads: number;
}

export interface BenchSpread {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

export interface BenchSummary {
  readonly server: string;
  readonly build: BuildId;
  readonly route: RouteId;
  readonly rounds: number;
  readonly serverCpuMicrosecondsPerRequest: BenchSpread | null;
  readonly serverCpuSplitMicrosecondsPerRequest: CpuSplit | null;
  readonly requestsPerSecond: BenchSpread;
  readonly latencyP99Ms: BenchSpread;
}

export interface BenchExternal {
  readonly server: string;
  readonly file: string;
  readonly version: string | null;
  readonly commandLine: readonly string[];
}

export interface BenchRatio {
  readonly route: RouteId;
  readonly serverCpuMicrosecondsPerRequest: number | null;
  readonly requestsPerSecond: number;
}

export interface BenchComparison {
  readonly external: BenchExternal;
  readonly ratios: readonly BenchRatio[];
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
  readonly comparison?: BenchComparison;
}

export interface Visit {
  readonly round: number;
  readonly position: number;
  readonly server: string;
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
