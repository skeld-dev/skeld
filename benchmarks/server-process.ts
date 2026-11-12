// Does:  Starts a server as a child process, waits for its ready line, counts its other stdout lines and stops it.
// Holds: A child that does not announce ready in time fails the start, with the tail of its stderr.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { BenchError } from './bench-error.ts';
import type { Command } from './pinning.ts';
import { readyTimeoutMs, stderrTailLines, stopGraceMs } from './values.ts';

export interface ExitStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface Launch {
  readonly name: string;
  readonly readyLabel: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export interface ServerProcess {
  readonly name: string;
  readonly pid: number;
  readonly port: number;
  readonly startMs: number;
  readonly exited: Promise<ExitStatus>;
  readonly stdoutLines: Promise<number>;
  exitStatus(): ExitStatus | null;
  stderrTail(): readonly string[];
  stop(): Promise<boolean>;
  kill(): void;
}

const readyLinePattern = /^\{"server":"([a-z-]+)","port":(\d+)\}$/;
const readyLinePreview = 80;
const maxPort = 65_535;

export const serversFolder = join(import.meta.dirname, 'servers');

export function describeExit(status: ExitStatus): string {
  return status.signal === null ? `code ${status.code ?? 'unknown'}` : `signal ${status.signal}`;
}

export function indentTail(tail: readonly string[]): readonly string[] {
  return tail.map((line) => `  ${line}`);
}

type ReadyOutcome =
  | { readonly kind: 'ready'; readonly port: number }
  | { readonly kind: 'wrong'; readonly line: string }
  | { readonly kind: 'exited'; readonly status: ExitStatus }
  | { readonly kind: 'timeout' };

const parseReady = (label: string, line: string): ReadyOutcome => {
  const match = readyLinePattern.exec(line);
  const port = Number(match?.[2]);
  if (match?.[1] !== label || !Number.isSafeInteger(port) || port < 1 || port > maxPort) {
    return { kind: 'wrong', line };
  }
  return { kind: 'ready', port };
};

export async function startServer(launch: Launch, command: Command): Promise<ServerProcess> {
  const { name: server, readyLabel } = launch;
  const startedAt = performance.now();
  const [program, ...prefix] = command;
  const child = spawn(program, [...prefix, ...launch.args], {
    env: launch.env,
    ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail: string[] = [];
  createInterface({ input: child.stderr }).on('line', (line) => {
    tail.push(line);
    if (tail.length > stderrTailLines) {
      tail.shift();
    }
  });
  let status: ExitStatus | null = null;
  const exited = new Promise<ExitStatus>((resolve) => {
    child.once('exit', (code, signal) => {
      status = { code, signal };
      resolve(status);
    });
  });
  const spawned = once(child, 'spawn').then(
    () => null,
    (error: unknown) => error,
  );

  const readyLine = Promise.withResolvers<ReadyOutcome>();
  const stdoutLines = Promise.withResolvers<number>();
  let ready = false;
  let counted = 0;
  const stdout = createInterface({ input: child.stdout });
  // Why: Every other line is drained and counted, so a server that logs is known to have logged and never blocks.
  stdout.on('line', (line) => {
    if (!ready && readyLinePattern.test(line)) {
      ready = true;
      readyLine.resolve(parseReady(readyLabel, line));
      return;
    }
    counted++;
  });
  stdout.once('close', () => {
    stdoutLines.resolve(counted);
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ReadyOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' });
    }, readyTimeoutMs);
  });
  const spawnError = await spawned;
  if (spawnError !== null) {
    clearTimeout(timer);
    throw spawnError;
  }
  const outcome = await Promise.race([
    readyLine.promise,
    exited.then((exit): ReadyOutcome => ({ kind: 'exited', status: exit })),
    timeout,
  ]);
  clearTimeout(timer);
  const readyMs = performance.now() - startedAt;

  if (outcome.kind !== 'ready') {
    if (status === null) {
      child.kill('SIGKILL');
      await exited;
    }
    if (outcome.kind === 'exited') {
      throw new BenchError(
        3,
        `${server} exited with ${describeExit(outcome.status)} before it was ready. Its last output:`,
        indentTail(tail),
      );
    }
    if (outcome.kind === 'timeout') {
      throw new BenchError(
        3,
        `${server} did not report ready within ${readyTimeoutMs / 1000} s. Its last output:`,
        indentTail(tail),
      );
    }
    throw new BenchError(
      3,
      `${server} printed ${JSON.stringify(outcome.line.slice(0, readyLinePreview))} instead of its ready line {"server":"${readyLabel}","port":<n>}.`,
    );
  }

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`${server} has no pid after it reported ready`);
  }
  const grace = (): Promise<'grace'> =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve('grace');
      }, stopGraceMs).unref();
    });

  return {
    name: server,
    pid,
    port: outcome.port,
    startMs: readyMs,
    exited,
    stdoutLines: stdoutLines.promise,
    exitStatus: () => status,
    stderrTail: () => [...tail],
    stop: async (): Promise<boolean> => {
      if (status !== null) {
        return false;
      }
      child.kill('SIGTERM');
      if ((await Promise.race([exited, grace()])) !== 'grace') {
        return false;
      }
      child.kill('SIGKILL');
      await exited;
      return true;
    },
    kill: (): void => {
      if (status === null) {
        child.kill('SIGKILL');
      }
    },
  };
}
