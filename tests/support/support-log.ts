// Does:  Starts a server child from source whose stdout is captured as parsed log records, or sent to the reader child.
// Holds: Every stdout line is kept and reported, one that does not parse as a JSON object included; none is dropped.

import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type LogObject = Record<string, unknown>;

export interface LogLine {
  text: string;
  byteLength: number;
  object: LogObject | null;
  validUtf8: boolean;
  terminated: boolean;
}

export interface ReaderMode {
  mode: 'read' | 'silent' | 'exit';
  ms?: number;
}

export interface LogChildOptions {
  args?: string[];
  env?: Record<string, string>;
  diag?: boolean;
  reader?: ReaderMode;
  startTimeoutMs?: number;
}

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LogChild {
  port: number;
  lines: () => LogLine[];
  records: () => LogObject[];
  unparsed: () => LogLine[];
  waitForRecord: (predicate: (record: LogObject) => boolean, timeoutMs?: number) => Promise<LogObject>;
  stdoutBytes: () => Buffer;
  stderr: () => string;
  exited: Promise<Exit>;
  reader?: { stderr: () => string; exited: Promise<Exit> };
  stop: (signal?: NodeJS.Signals) => Promise<Exit>;
}

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const readerScript = join(sourceRoot, 'benchmarks/logging/reader.ts');
const newline = 0x0a;

// Does:  Writes the one stderr line the rig waits for; the served module calls it once after listen.
export function announceListening(port: number): void {
  process.stderr.write(`listening ${port}\n`);
}

function isObject(value: unknown): value is LogObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(text: string): LogObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

// Does:  Parses stdout text into its records, one per line; a line that is not a JSON object is returned as null.
export function parseRecords(text: string): (LogObject | null)[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseObject(line));
}

// Does:  Waits until the child's stdout, parsed into records, satisfies the predicate; false when the time runs out.
export function untilStdout(
  child: { stdout: () => string },
  done: (records: (LogObject | null)[]) => boolean,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<boolean> => {
    if (done(parseRecords(child.stdout()))) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await delay(10);
    return poll();
  };
  return poll();
}

class LineSplitter {
  readonly all: LogLine[] = [];
  readonly raw: Buffer[] = [];
  #pending: Buffer = Buffer.alloc(0);
  readonly #strict = new TextDecoder('utf-8', { fatal: true });

  push(chunk: Buffer): void {
    this.raw.push(chunk);
    let rest = Buffer.concat([this.#pending, chunk]);
    for (let end = rest.indexOf(newline); end !== -1; end = rest.indexOf(newline)) {
      this.all.push(this.#line(rest.subarray(0, end), true));
      rest = rest.subarray(end + 1);
    }
    this.#pending = Buffer.from(rest);
  }

  finish(): void {
    if (this.#pending.length > 0) {
      this.all.push(this.#line(this.#pending, false));
      this.#pending = Buffer.alloc(0);
    }
  }

  #line(bytes: Buffer, terminated: boolean): LogLine {
    let validUtf8 = true;
    try {
      this.#strict.decode(bytes);
    } catch {
      validUtf8 = false;
    }
    const text = bytes.toString('utf8');
    return { text, byteLength: bytes.length, object: parseObject(text), validUtf8, terminated };
  }
}

function exitOf(child: ChildProcess): Promise<Exit> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function collectStderr(child: ChildProcess): () => string {
  let text = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    text += chunk;
  });
  return () => text;
}

function announcedPort(child: ChildProcess, stderr: () => string, exited: Promise<Exit>, ms: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server child announced no port within ${ms} ms`)), ms);
    const look = () => {
      const match = /^listening (\d+)$/m.exec(stderr());
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };
    child.stderr?.on('data', look);
    void exited.then(() => {
      clearTimeout(timer);
      reject(new Error(`the server child exited before announcing a port: ${stderr()}`));
    });
  });
}

// Does:  Starts node --conditions=skeld-source script serve args; the script must call announceListening(port).
export async function startLogChild(script: string, options: LogChildOptions = {}): Promise<LogChild> {
  const splitter = new LineSplitter();
  const scratch = options.reader === undefined ? null : mkdtempSync(join(tmpdir(), 'skeld-log-rig-'));
  const outFile = scratch === null ? null : join(scratch, 'out.log');
  let reader: ChildProcess | null = null;
  if (options.reader !== undefined && outFile !== null) {
    const readerArgs = ['--mode', options.reader.mode, '--out', outFile];
    if (options.reader.ms !== undefined) {
      readerArgs.push('--ms', String(options.reader.ms));
    }
    reader = spawn(process.execPath, [readerScript, ...readerArgs], { stdio: ['pipe', 'ignore', 'pipe'] });
  }
  const readerStderr = reader === null ? null : collectStderr(reader);
  const readerExited = reader === null ? null : exitOf(reader);
  const conditions = ['--conditions=skeld-source', ...(options.diag === true ? ['--conditions=skeld-diag'] : [])];
  const stdoutTarget = reader?.stdin ?? 'pipe';
  const child = spawn(process.execPath, [...conditions, script, 'serve', ...(options.args ?? [])], {
    env: { ...process.env, ...options.env },
    stdio: ['ignore', stdoutTarget, 'pipe'],
  });
  // Why: the child holds its own copy of the pipe; the rig's copy would keep the reader from seeing end of input.
  reader?.stdin?.destroy();
  child.stdout?.on('data', (chunk: Buffer) => splitter.push(chunk));
  const stderr = collectStderr(child);
  const exited = exitOf(child);
  let offset = 0;
  let fileClosed = false;
  const refresh = (): void => {
    if (outFile === null || fileClosed) {
      return;
    }
    let size = 0;
    try {
      size = statSync(outFile).size;
    } catch {
      return;
    }
    if (size <= offset) {
      return;
    }
    const descriptor = openSync(outFile, 'r');
    try {
      const buffer = Buffer.alloc(size - offset);
      const got = readSync(descriptor, buffer, 0, buffer.length, offset);
      offset += got;
      splitter.push(buffer.subarray(0, got));
    } finally {
      closeSync(descriptor);
    }
  };
  const teardown = (): void => {
    child.kill('SIGKILL');
    reader?.kill('SIGKILL');
    if (scratch !== null) {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  let port: number;
  try {
    port = await announcedPort(child, stderr, exited, options.startTimeoutMs ?? 20_000);
  } catch (error) {
    teardown();
    throw error;
  }
  const lines = (): LogLine[] => {
    refresh();
    return splitter.all.filter((line) => line.terminated);
  };
  const records = (): LogObject[] => lines().flatMap((line) => (line.object === null ? [] : [line.object]));
  const waitForRecord = (predicate: (record: LogObject) => boolean, timeoutMs = 10_000): Promise<LogObject> => {
    const deadline = Date.now() + timeoutMs;
    const poll = async (): Promise<LogObject> => {
      const found = records().find(predicate);
      if (found !== undefined) {
        return found;
      }
      if (Date.now() >= deadline) {
        throw new Error(`no matching record within ${timeoutMs} ms; ${splitter.all.length} lines seen`);
      }
      await delay(10);
      return poll();
    };
    return poll();
  };
  const stop = async (signal: NodeJS.Signals = 'SIGTERM'): Promise<Exit> => {
    child.kill(signal);
    const exit = await exited;
    if (readerExited !== null) {
      await readerExited;
    }
    refresh();
    fileClosed = true;
    splitter.finish();
    if (scratch !== null) {
      rmSync(scratch, { recursive: true, force: true });
    }
    return exit;
  };
  const unparsed = (): LogLine[] => {
    refresh();
    return splitter.all.filter((line) => line.object === null || !line.terminated);
  };
  return {
    port,
    lines,
    records,
    unparsed,
    waitForRecord,
    stdoutBytes: () => {
      refresh();
      return Buffer.concat(splitter.raw);
    },
    stderr,
    exited,
    ...(readerStderr === null || readerExited === null
      ? {}
      : { reader: { stderr: readerStderr, exited: readerExited } }),
    stop,
  };
}
