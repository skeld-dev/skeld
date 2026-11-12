// Does:  Drives one failing-destination fixture: a healthy run, then a failing run, each at 1,000 requests per second.
// Holds: The report is printed only after both runs completed, and every work request is timed by this process's clock.

import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';
import { Agent, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { LogStats } from '@skeld/core/log';
import { host } from '../values.ts';

type Fixture = 'reader-silent' | 'reader-exited' | 'sink-throws' | 'sink-rejects' | 'sink-hangs' | 'sink-reenters';

interface Setup {
  readonly reader: readonly string[];
  readonly sink: 'none' | 'throws' | 'rejects' | 'hangs' | 'reenters';
}

interface Sample {
  readonly stats: LogStats;
  readonly sinkCalls: number | null;
}

interface RunResult {
  readonly requests: number;
  readonly statuses: ReadonlyMap<string, number>;
  readonly latencies: readonly number[];
  readonly samples: readonly Sample[];
  readonly last: Sample;
  readonly peakRssBytes: number;
  readonly readerFile: string;
}

const fixtures: Readonly<Record<Fixture, Setup>> = {
  'reader-silent': { reader: ['--mode', 'silent', '--ms', '5000'], sink: 'none' },
  'reader-exited': { reader: ['--mode', 'exit', '--ms', '1000'], sink: 'none' },
  'sink-throws': { reader: ['--mode', 'read'], sink: 'throws' },
  'sink-rejects': { reader: ['--mode', 'read'], sink: 'rejects' },
  'sink-hangs': { reader: ['--mode', 'read'], sink: 'hangs' },
  'sink-reenters': { reader: ['--mode', 'read'], sink: 'reenters' },
};
const healthy: Setup = { reader: ['--mode', 'read'], sink: 'none' };

const ratePerSecond = 1000;
const durationMs = 10_000;
const pollMs = 100;
const readyTimeoutMs = 10_000;
const requestTimeoutMs = 10_000;
const stopGraceMs = 5000;
const readerScript = join(import.meta.dirname, 'reader.ts');
const serviceScript = join(import.meta.dirname, 'service.ts');
const readyPattern = /^\{"service":"logging","port":(\d+)\}$/;

class DriveError extends Error {
  override readonly name = 'DriveError';
}

const fail = (exitCode: 1 | 2, message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
};

const parseFixture = (argv: readonly string[]): Fixture => {
  const names = Object.keys(fixtures);
  const fixture = names.find((name): name is Fixture => name === argv[1]);
  if (argv.length !== 2 || argv[0] !== '--fixture' || fixture === undefined) {
    return fail(2, `usage: node benchmarks/logging/drive.ts --fixture <${names.join('|')}>`);
  }
  return fixture;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const statsKeys = ['created', 'written', 'queued', 'queuedBytes', 'inFlight', 'inFlightBytes', 'pendingMs'] as const;
const dropKeys = ['queue_full', 'reserve', 'write_failed', 'sink_failed', 'shutdown'] as const;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DriveError(`the stats route answered ${JSON.stringify(text.slice(0, 120))}, which is not JSON`);
    }
    throw error;
  }
};

const parseSample = (text: string): Sample => {
  const body = parseJson(text);
  const stats = isRecord(body) ? body.stats : undefined;
  const dropped = isRecord(stats) ? stats.dropped : undefined;
  const sinkCalls = isRecord(body) ? body.sinkCalls : undefined;
  if (
    !isRecord(stats) ||
    !isRecord(dropped) ||
    !statsKeys.every((key) => isCount(stats[key])) ||
    !isCount(stats.suppressed) ||
    !dropKeys.every((key) => isCount(dropped[key])) ||
    (sinkCalls !== undefined && !isCount(sinkCalls))
  ) {
    throw new DriveError(`the stats route answered ${JSON.stringify(text.slice(0, 120))}, not the log counts`);
  }
  const count = (record: Record<string, unknown>, key: string): number => Number(record[key]);
  return {
    stats: {
      created: count(stats, 'created'),
      written: count(stats, 'written'),
      queued: count(stats, 'queued'),
      queuedBytes: count(stats, 'queuedBytes'),
      inFlight: count(stats, 'inFlight'),
      inFlightBytes: count(stats, 'inFlightBytes'),
      pendingMs: count(stats, 'pendingMs'),
      suppressed: count(stats, 'suppressed'),
      dropped: {
        queue_full: count(dropped, 'queue_full'),
        reserve: count(dropped, 'reserve'),
        write_failed: count(dropped, 'write_failed'),
        sink_failed: count(dropped, 'sink_failed'),
        shutdown: count(dropped, 'shutdown'),
      },
    },
    sinkCalls: sinkCalls === undefined ? null : Number(sinkCalls),
  };
};

const droppedTotal = (stats: LogStats): number => dropKeys.reduce((total, key) => total + stats.dropped[key], 0);
const sumHolds = (stats: LogStats): boolean =>
  stats.created === stats.written + stats.queued + stats.inFlight + droppedTotal(stats);
const heldBytes = (stats: LogStats): number => stats.queuedBytes + stats.inFlightBytes;

// Does:  Sends one GET and settles with its status and its time from send to the last byte, or the transport failure.
const get = (agent: Agent, port: number, path: string): Promise<{ status: string; ms: number; body: string }> =>
  new Promise((resolve) => {
    const started = performance.now();
    const settle = (status: string, body: string): void => {
      resolve({ status, ms: performance.now() - started, body });
    };
    const outgoing = request({ agent, host, port, path, method: 'GET', timeout: requestTimeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.once('end', () => {
        settle(String(response.statusCode ?? 'none'), Buffer.concat(chunks).toString('utf8'));
      });
      response.once('error', () => {
        settle('error', '');
      });
    });
    outgoing.once('timeout', () => {
      outgoing.destroy();
      settle('timeout', '');
    });
    outgoing.once('error', () => {
      settle('error', '');
    });
    outgoing.end();
  });

const awaitReady = async (service: ChildProcess, tail: string[]): Promise<number> => {
  if (service.stderr === null) {
    throw new DriveError('the service has no stderr pipe');
  }
  const lines = createInterface({ input: service.stderr });
  const ready = new Promise<number>((resolve) => {
    lines.on('line', (line) => {
      const match = readyPattern.exec(line);
      if (match === null) {
        tail.push(line);
        return;
      }
      resolve(Number(match[1]));
    });
  });
  const timer = AbortSignal.timeout(readyTimeoutMs);
  const outcome = await Promise.race([
    ready,
    once(service, 'exit').then(() => 'exited' as const),
    once(timer, 'abort').then(() => 'timeout' as const),
  ]);
  if (typeof outcome === 'number') {
    return outcome;
  }
  throw new DriveError(
    `the service ${outcome === 'exited' ? 'exited' : 'did not announce ready'}: ${tail.join(' | ')}`,
  );
};

const paceLoad = async (
  agent: Agent,
  port: number,
): Promise<Pick<RunResult, 'requests' | 'statuses' | 'latencies'>> => {
  const total = (ratePerSecond * durationMs) / 1000;
  const statuses = new Map<string, number>();
  const latencies: number[] = [];
  const pending: Promise<void>[] = [];
  const started = performance.now();
  let sent = 0;
  const send = (): void => {
    sent++;
    pending.push(
      get(agent, port, '/').then(({ status, ms }) => {
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
        latencies.push(ms);
      }),
    );
  };
  while (sent < total) {
    const due = Math.min(total, Math.floor(((performance.now() - started) * ratePerSecond) / 1000));
    while (sent < due) {
      send();
    }
    // biome-ignore lint/performance/noAwaitInLoops: the pacing waits one timer tick between batches of due requests.
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await Promise.all(pending);
  return { requests: sent, statuses, latencies };
};

const peakRss = (pid: number): number => {
  const line = readFileSync(`/proc/${pid}/status`, 'utf8')
    .split('\n')
    .find((candidate) => candidate.startsWith('VmHWM:'));
  const kibibytes = Number(line?.replace(/\D+/g, ''));
  if (!Number.isSafeInteger(kibibytes)) {
    throw new DriveError(`/proc/${pid}/status has no VmHWM line`);
  }
  return kibibytes * 1024;
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const grace = setTimeout(() => child.kill('SIGKILL'), stopGraceMs);
  await exited;
  clearTimeout(grace);
};

const running = new Set<ChildProcess>();

const runOnce = async (setup: Setup, label: string): Promise<RunResult> => {
  const readerFile = join(tmpdir(), `skeld-drive-${process.pid}-${label}.out`);
  const reader = spawn(process.execPath, [readerScript, ...setup.reader, '--out', readerFile], {
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  running.add(reader);
  const readerExited = new Promise((resolve) => reader.once('exit', resolve));
  const service = spawn(process.execPath, [serviceScript, '--sink', setup.sink], {
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', reader.stdin, 'pipe'],
  });
  running.add(service);
  // Why: The service must hold the only write end, so the reader sees end of file and a dead reader breaks its pipe.
  reader.stdin?.destroy();
  const tail: string[] = [];
  const port = await awaitReady(service, tail);
  const pid = service.pid;
  if (pid === undefined) {
    throw new DriveError('the service has no pid');
  }
  const loadAgent = new Agent({ keepAlive: true, maxSockets: 256 });
  const statsAgent = new Agent({ keepAlive: true, maxSockets: 1 });
  const samples: Sample[] = [];
  const poll = async (): Promise<Sample> => {
    const answer = await get(statsAgent, port, '/stats');
    if (answer.status !== '200') {
      throw new DriveError(`the stats route answered ${answer.status}`);
    }
    const sample = parseSample(answer.body);
    samples.push(sample);
    return sample;
  };
  const polls: Promise<unknown>[] = [];
  const poller = setInterval(() => {
    // Why: A failed poll is kept as its value until the load ends, so it is reported rather than left unhandled.
    polls.push(poll().catch((error: unknown) => error));
  }, pollMs);
  const load = await paceLoad(loadAgent, port);
  clearInterval(poller);
  const failed = (await Promise.all(polls)).find((outcome) => outcome instanceof Error);
  if (failed !== undefined) {
    throw failed;
  }
  const last = await poll();
  const peakRssBytes = peakRss(pid);
  loadAgent.destroy();
  statsAgent.destroy();
  await stopChild(service);
  await readerExited;
  running.delete(service);
  running.delete(reader);
  return { ...load, samples, last, peakRssBytes, readerFile };
};

const p99 = (latencies: readonly number[]): number => {
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? Number.NaN;
};

const readerCounts = (file: string): { lines: number; malformed: number } => {
  const parts = readFileSync(file, 'utf8').split('\n');
  const partial = parts.pop() ?? '';
  const malformed = parts.filter((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return !isRecord(value) || Array.isArray(value);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return true;
      }
      throw error;
    }
  }).length;
  return { lines: parts.length + (partial === '' ? 0 : 1), malformed: malformed + (partial === '' ? 0 : 1) };
};

const fixture = parseFixture(process.argv.slice(2));
const failing = fixtures[fixture];
try {
  process.stderr.write(`${fixture}: healthy run, ${durationMs / 1000} s\n`);
  const healthyRun = await runOnce(healthy, 'healthy');
  process.stderr.write(`${fixture}: failing run, ${durationMs / 1000} s\n`);
  const failingRun = await runOnce(failing, 'failing');
  const statuses = new Map(healthyRun.statuses);
  for (const [status, total] of failingRun.statuses) {
    statuses.set(status, (statuses.get(status) ?? 0) + total);
  }
  const p99Ms = { healthy: p99(healthyRun.latencies), failing: p99(failingRun.latencies) };
  const all = [...failingRun.samples, failingRun.last];
  const { stats } = failingRun.last;
  const report = {
    fixture,
    requests: healthyRun.requests + failingRun.requests,
    answered: statuses.get('200') ?? 0,
    statuses: Object.fromEntries(statuses),
    p99Ms,
    ratio: p99Ms.failing / p99Ms.healthy,
    stats: {
      samples: all.length,
      sumHeld: all.every((sample) => sumHolds(sample.stats)),
      maxHeldBytes: Math.max(...all.map((sample) => heldBytes(sample.stats))),
      last: stats,
    },
    sinkCalls: failingRun.last.sinkCalls,
    peakRssBytes: failingRun.peakRssBytes,
    droppedShare: stats.created === 0 ? 0 : droppedTotal(stats) / stats.created,
    reader: failing.sink === 'none' ? readerCounts(failingRun.readerFile) : null,
  };
  rmSync(healthyRun.readerFile, { force: true });
  rmSync(failingRun.readerFile, { force: true });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
} catch (error) {
  for (const child of running) {
    child.kill('SIGKILL');
  }
  if (error instanceof DriveError) {
    fail(1, error.message);
  }
  throw error;
}
