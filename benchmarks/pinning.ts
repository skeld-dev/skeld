import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { errorCode } from './bench-error.ts';
import { minimumHostCores, runnerCores, serverCores, tasksetPath } from './values.ts';

export type Command = readonly [string, ...string[]];

export interface Pinning {
  readonly serverCommand: Command;
  readonly runnerCores: string | null;
  readonly deviation: string | null;
}

export function allowedCores(pid: number): string | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const line = status.split('\n').find((candidate) => candidate.startsWith('Cpus_allowed_list:'));
    return line === undefined ? null : line.slice('Cpus_allowed_list:'.length).trim();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

const unpinned = (deviation: string): Pinning => ({
  serverCommand: [process.execPath],
  runnerCores: allowedCores(process.pid),
  deviation: `not pinned: ${deviation}`,
});

const tasksetFailure = (error: unknown): string | null => {
  if (errorCode(error) === 'ENOENT') {
    return `${tasksetPath} is not installed`;
  }
  if (error instanceof Error && 'stderr' in error) {
    return `taskset could not pin the runner (${String(error.stderr).trim()})`;
  }
  return null;
};

export function pinRunner(): Pinning {
  const hostCores = cpus().length;
  if (hostCores < minimumHostCores) {
    return unpinned(`this host has ${hostCores} vCPUs, not ${minimumHostCores} or more`);
  }
  try {
    execFileSync(tasksetPath, ['--all-tasks', '--cpu-list', '--pid', runnerCores, String(process.pid)], {
      stdio: 'pipe',
    });
  } catch (error) {
    const failure = tasksetFailure(error);
    if (failure === null) {
      throw error;
    }
    return unpinned(failure);
  }
  const cores = allowedCores(process.pid);
  if (cores !== runnerCores) {
    return unpinned(`the runner is allowed cores ${cores ?? 'unknown'}, not ${runnerCores}`);
  }
  return {
    serverCommand: [tasksetPath, '--cpu-list', serverCores, process.execPath],
    runnerCores: cores,
    deviation: null,
  };
}
