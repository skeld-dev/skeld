// Does:  Reads the CPU cost per request of the browser-boundary paths against a plain GET on one skeld server.
// Holds: A variant counts only when every response had its expected status; the lock keeps it from overlapping a run.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BenchError } from './bench-error.ts';
import { startCpuSample } from './cpu.ts';
import { childEnvironment, refuseConditions } from './environment.ts';
import { type LoadRequest, loadAutocannon, startRequestLoad } from './load.ts';
import { takeLock } from './lock.ts';
import { pinRunner } from './pinning.ts';
import { type ServerProcess, startServer } from './server-process.ts';
import { browserOrigin, defaultDurationSeconds, defaultWarmUpSeconds, durationRange, publicOrigin } from './values.ts';

interface Variant {
  readonly name: string;
  readonly request: LoadRequest;
  readonly status: number;
}

interface Reading {
  readonly name: string;
  readonly requestsPerSecond: number;
  readonly cpuMicroseconds: number;
}

const json = { 'content-type': 'application/json' };
const body = '{"hello":"world"}';
const cookie = { cookie: 'sid=abc123; theme=dark' };

const variants: readonly Variant[] = [
  { name: 'plain GET', request: { path: '/plain' }, status: 200 },
  { name: 'raw cookie read', request: { path: '/raw-cookie', headers: cookie }, status: 200 },
  { name: 'declared cookie', request: { path: '/declared-cookie', headers: cookie }, status: 200 },
  { name: '302 to a local path', request: { path: '/redirect' }, status: 302 },
  { name: 'CORS GET, allowed origin', request: { path: '/cors', headers: { origin: browserOrigin } }, status: 200 },
  {
    name: 'CORS preflight',
    request: {
      method: 'OPTIONS',
      path: '/cors',
      headers: { origin: browserOrigin, 'access-control-request-method': 'GET' },
    },
    status: 204,
  },
  {
    name: 'POST, Origin and same-origin',
    request: {
      method: 'POST',
      path: '/echo',
      headers: { ...json, origin: publicOrigin, 'sec-fetch-site': 'same-origin' },
      body,
    },
    status: 200,
  },
  { name: 'POST, neither header', request: { method: 'POST', path: '/echo', headers: json, body }, status: 200 },
];

function seconds(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < durationRange.min || parsed > durationRange.max) {
    throw new BenchError(
      2,
      `${name} must be a whole number of seconds from ${durationRange.min} to ${durationRange.max}.`,
    );
  }
  return parsed;
}

async function measure(server: ServerProcess, variant: Variant, durationSeconds: number): Promise<Reading> {
  const autocannon = loadAutocannon();
  const sample = startCpuSample(server.pid);
  const result = await startRequestLoad(autocannon, server.port, variant.request, durationSeconds);
  const cpu = sample().serverCpuMicroseconds;
  const total = result.requests.total;
  const statuses = Object.keys(result.statusCodeStats);
  if (
    result.errors > 0 ||
    result.timeouts > 0 ||
    total === 0 ||
    statuses.some((code) => code !== String(variant.status))
  ) {
    throw new BenchError(
      4,
      `${variant.name}: expected only ${variant.status}, got statuses ${statuses.join(', ') || 'none'}, ${result.errors} errors, ${result.timeouts} timeouts.`,
    );
  }
  if (cpu === null) {
    throw new BenchError(3, 'server CPU time could not be read from /proc; no reading is possible.');
  }
  return { name: variant.name, requestsPerSecond: result.requests.average, cpuMicroseconds: cpu / total };
}

function report(readings: readonly Reading[]): void {
  const reference = readings[0]?.cpuMicroseconds ?? Number.NaN;
  process.stdout.write('variant                          req/s   CPU us/req   ratio\n');
  for (const reading of readings) {
    const ratio = reading.cpuMicroseconds / reference;
    process.stdout.write(
      `${reading.name.padEnd(30)} ${reading.requestsPerSecond.toFixed(0).padStart(7)} ${reading.cpuMicroseconds.toFixed(2).padStart(12)} ${ratio.toFixed(3).padStart(7)}\n`,
    );
  }
}

async function main(): Promise<void> {
  refuseConditions();
  const { values } = parseArgs({ options: { duration: { type: 'string' }, 'warm-up': { type: 'string' } } });
  const durationSeconds = seconds(values.duration, '--duration', defaultDurationSeconds);
  const warmUpSeconds = seconds(values['warm-up'], '--warm-up', defaultWarmUpSeconds);
  const lock = takeLock();
  let server: ServerProcess | null = null;
  try {
    const pinning = pinRunner();
    if (pinning.deviation !== null) {
      process.stderr.write(`warning: ${pinning.deviation}; the readings are not comparable with a pinned run\n`);
    }
    server = await startServer(
      {
        name: 'skeld-browser',
        readyLabel: 'skeld-browser',
        args: [join(import.meta.dirname, 'browser-server.ts'), '--port', '0'],
        env: { ...childEnvironment(), NODE_ENV: 'production' },
      },
      pinning.serverCommand,
    );
    const readings: Reading[] = [];
    for (const variant of variants) {
      // biome-ignore lint/performance/noAwaitInLoops: one load at a time; concurrent load would measure itself.
      await measure(server, variant, warmUpSeconds);
      readings.push(await measure(server, variant, durationSeconds));
    }
    report(readings);
  } finally {
    await server?.stop();
    lock.release();
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof BenchError)) {
    throw error;
  }
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = error.exitCode;
}
