// Does:  Holds the benchmark protocol's constants: load, cores, timings, lines and expected answers.
// Holds: A run whose settings differ from these is a deviation and is not assessed.

import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const connections = 100;
export const workers = 3;
export const saturationPercent = 90;
export const generatorCeilingPercent = saturationPercent * workers;
export const keepLinePercent = 100;

export const defaultPipelining = 1;
export const defaultWarmUpSeconds = 3;
export const defaultDurationSeconds = 10;
export const defaultRounds = 3;
export const pipeliningRange = { min: 1, max: 100 } as const;
export const durationRange = { min: 1, max: 600 } as const;
export const roundsRange = { min: 1, max: 50 } as const;
export const defaultOut = 'benchmarks/results';

export const defaultStepN = 8;
export const defaultCpuN = 32;
export const stepRange = { min: 1, max: 1024 } as const;
export const overheadLine = 1.1;
export const spanSumTolerance = 0.1;
export const startProofMs = 2000;
export const startProofPollMs = 50;
export const readoutFile = 'readout.md';

// Why: Unset until the 21-round control session measures it; a logging session needs --rounds until then.
export const loggingRounds: number | null = null;
export const controlBand = { min: 0.98, max: 1.02 } as const;
export const roundCountBand = { min: 0.99, max: 1.01 } as const;
export const roundCountRange = { min: 5, max: 15 } as const;
export const defaultLogBudget = 1.05;
export const accessLogBudget = 1.1;
export const loggingReadoutFile = 'logging-readout.md';

export const host = '127.0.0.1';
export const standalonePort = 3000;
export const readyTimeoutMs = 10_000;
export const stopGraceMs = 5000;
export const preflightTimeoutMs = 2000;
export const expectedBody = '{"hello":"world"}';
export const expectedMediaType = 'application/json';
export const stderrTailLines = 20;
export const publicOrigin = 'http://bench.test';
export const browserOrigin = 'http://app.bench.test';

export const busyLoadAverage = 1.0;
export const protocolNode = 'v26.13.0';
export const protocolFastify = '5.12.7';
export const tasksetPath = '/usr/bin/taskset';
export const serverCores = '7';
export const runnerCores = '3-6';
export const minimumHostCores = 8;
export const lockFile = join(tmpdir(), 'skeld-bench.lock');
