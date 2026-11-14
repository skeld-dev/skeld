// Does:  Takes the machine-wide benchmark lock, so two runs never measure at the same time.
// Holds: The lock is taken with an atomic link; a lock whose holder is dead is replaced, a live one refuses the run.

import { linkSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BenchError, errorCode } from './bench-error.ts';
import { isoSeconds } from './terminal.ts';
import { lockFile } from './values.ts';

interface LockContent {
  readonly pid: number;
  readonly startedAt: string;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
};

const parseLock = (text: string): LockContent | null => {
  const value = parseJson(text);
  if (
    typeof value === 'object' &&
    value !== null &&
    'pid' in value &&
    Number.isSafeInteger(value.pid) &&
    typeof value.pid === 'number' &&
    'startedAt' in value &&
    typeof value.startedAt === 'string'
  ) {
    return { pid: value.pid, startedAt: value.startedAt };
  }
  return null;
};

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') {
      return false;
    }
    if (errorCode(error) === 'EPERM') {
      return true;
    }
    throw error;
  }
};

const tryLink = (staged: string): boolean => {
  try {
    linkSync(staged, lockFile);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
};

const readHolder = (): LockContent => {
  const text = readFileSync(lockFile, 'utf8');
  const holder = parseLock(text);
  if (holder === null) {
    throw new BenchError(3, `${lockFile} is not a benchmark lock. Remove it if no benchmark is running.`);
  }
  return holder;
};

export interface Lock {
  readonly replacedPid: number | null;
  release(): void;
}

export function takeLock(): Lock {
  const stagingDirectory = mkdtempSync(`${lockFile}.`);
  const staged = join(stagingDirectory, 'holder');
  try {
    writeFileSync(staged, JSON.stringify({ pid: process.pid, startedAt: isoSeconds(new Date()) }), {
      flag: 'wx',
      mode: 0o600,
    });
    let replacedPid: number | null = null;
    if (!tryLink(staged)) {
      const holder = readHolder();
      if (isRunning(holder.pid)) {
        throw new BenchError(
          3,
          `another benchmark is running (pid ${holder.pid}, started ${holder.startedAt}). Wait for it to finish: two runs on one machine corrupt each other's numbers.`,
        );
      }
      unlinkSync(lockFile);
      if (!tryLink(staged)) {
        throw new BenchError(3, `another benchmark took the lock ${lockFile} at the same moment. Run again.`);
      }
      replacedPid = holder.pid;
    }
    return {
      replacedPid,
      release: (): void => {
        try {
          if (readHolder().pid === process.pid) {
            unlinkSync(lockFile);
          }
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') {
            throw error;
          }
        }
      },
    };
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}
