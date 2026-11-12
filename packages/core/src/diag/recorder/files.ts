// Does:  Claims the diag folder and writes the run, snapshot and journal files.
// Holds: A folder held by a live process is refused; after one failed write the recorder writes nothing more.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { refuse } from './config.ts';
import { counter } from './counts.ts';

interface Paths {
  readonly run: string;
  readonly snapshot: string;
  readonly journal: string;
}

const RUN_FILE = 'run.json';
const SNAPSHOT_FILE = 'snapshot.jsonl';
const JOURNAL_FILE = 'journal.jsonl';

const writeFailed = counter('diag.write_failed');
const files: { paths: Paths | null; stopped: boolean } = { paths: null, stopped: false };

export function errorCode(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  if (typeof code !== 'string') {
    throw error;
  }
  return code;
}

function recordedPid(run: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(run, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  const pid: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'pid') : undefined;
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ESRCH') {
      return false;
    }
    // Why: EPERM means the process exists but belongs to another user, so it counts as alive.
    if (code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

const notWritable = (dir: string, error: unknown): Error =>
  refuse(`SKELD_DIAG_DIR ${dir} is not writable: ${errorCode(error)}`);

function takeOver(dir: string, run: string, header: string): void {
  let pid: number | null;
  try {
    pid = recordedPid(run);
  } catch (error) {
    throw notWritable(dir, error);
  }
  if (pid !== null && isAlive(pid)) {
    throw refuse(`SKELD_DIAG_DIR ${dir} holds the run of live process ${pid}; give each diag run its own folder`);
  }
  try {
    writeFileSync(run, header);
  } catch (error) {
    throw notWritable(dir, error);
  }
}

export function claimFolder(dir: string, header: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw refuse(`SKELD_DIAG_DIR ${dir} cannot be created: ${errorCode(error)}`);
  }
  const paths: Paths = {
    run: join(dir, RUN_FILE),
    snapshot: join(dir, SNAPSHOT_FILE),
    journal: join(dir, JOURNAL_FILE),
  };
  try {
    // Why: Exclusive create, so two processes cannot both claim an empty folder.
    writeFileSync(paths.run, header, { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw notWritable(dir, error);
    }
    takeOver(dir, paths.run, header);
  }
  try {
    writeFileSync(paths.snapshot, '');
    writeFileSync(paths.journal, '');
  } catch (error) {
    throw notWritable(dir, error);
  }
  files.paths = paths;
}

function guarded(file: string, write: (paths: Paths) => void): void {
  const { paths } = files;
  if (paths === null || files.stopped) {
    return;
  }
  try {
    write(paths);
  } catch (error) {
    const code = errorCode(error);
    files.stopped = true;
    writeFailed.total += 1;
    process.stderr.write(`skeld diag: writing ${file} failed: ${code}; diag files stop here\n`);
  }
}

export function writeRunFile(header: string): void {
  guarded(RUN_FILE, (paths) => writeFileSync(paths.run, header));
}

export function appendSnapshot(line: string): void {
  guarded(SNAPSHOT_FILE, (paths) => appendFileSync(paths.snapshot, `${line}\n`));
}

export function appendJournal(lines: readonly string[]): void {
  guarded(JOURNAL_FILE, (paths) => appendFileSync(paths.journal, `${lines.join('\n')}\n`));
}
