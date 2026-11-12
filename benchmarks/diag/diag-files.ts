// Does:  Reads and checks the three files a recorder writes: run, snapshots and journal.
// Holds: The files are untrusted input: every read is size-bounded and every field checked before use.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { BenchError, errorCode } from '../bench-error.ts';

const runFile = 'run.json';
const snapshotFile = 'snapshot.jsonl';
const journalFile = 'journal.jsonl';
const recorderFormat = 'darkstart-diag/2';
const runLimitBytes = 1_048_576;
const linesLimitBytes = 16_777_216;
const countChunkBytes = 65_536;
const newline = 0x0a;

interface RunRoute {
  readonly id: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
}

interface RunSampling {
  readonly step_n: number;
  readonly cpu_n: number;
  readonly block_ms: number;
}

export interface RunHeader {
  readonly format: typeof recorderFormat;
  readonly recorder: string;
  readonly status: 'booting' | 'listening' | 'closed';
  readonly commit: string | null;
  readonly branch: string | null;
  readonly node: string;
  readonly pid: number;
  readonly build: 'source' | 'dist';
  readonly started_at: number;
  readonly listening_at: number | null;
  readonly closed_at: number | null;
  readonly address: unknown;
  readonly ready_ms: number | null;
  readonly sampling: RunSampling;
  readonly canary: boolean;
  readonly options: unknown;
  readonly capacity: unknown;
  readonly routes: readonly RunRoute[];
}

interface LoopDelay {
  readonly p50_us: number;
  readonly p99_us: number;
  readonly max_us: number;
}

interface ProcessFigures {
  readonly cpu: number;
  readonly main_cpu: number;
  readonly offthread_cpu: number;
  readonly unattributed_cpu: number;
  readonly elu: number;
  readonly alloc_bytes: number;
  readonly heap: unknown;
  readonly gc: unknown;
  readonly 'loop.delay': LoopDelay;
}

interface SampledFigures {
  readonly n: number;
  readonly incl: number;
}

interface SpanFigures {
  readonly n: number;
  readonly cn: number;
  readonly incl: number;
  readonly self: number;
  readonly cpu: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

interface LimitFigures {
  readonly n: number;
  readonly used: number;
  readonly max: number;
  readonly ratio: number;
  readonly near: number;
  readonly over: number;
  readonly run_peak: number;
  readonly armed: boolean;
}

interface EventFigures {
  readonly n: number;
  readonly run_n: number;
  readonly suppressed: number;
  readonly run_suppressed: number;
}

export interface SnapshotLine {
  readonly t: number;
  readonly at: unknown;
  readonly window_ms: number;
  readonly final: boolean;
  readonly requests: number;
  readonly sampled: SampledFigures;
  readonly process: ProcessFigures;
  readonly spans: Readonly<Record<string, SpanFigures>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly limits: Readonly<Record<string, LimitFigures>>;
  readonly events: Readonly<Record<string, EventFigures>>;
  readonly gauges: Readonly<Record<string, unknown>>;
  readonly failing: readonly string[];
}

export interface JournalLine {
  readonly t: number;
  readonly hook: string;
  readonly route: string | null;
  readonly status: number | null;
  readonly subject: string | number | null;
  readonly fails_run: boolean;
}

export interface RecorderFolder {
  readonly folder: string;
  readonly run: RunHeader;
  readonly snapshots: readonly SnapshotLine[];
  readonly journal: readonly JournalLine[];
}

type JsonObject = Readonly<Record<string, unknown>>;

interface Place {
  readonly where: string;
  readonly prefix: string;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (at: Place, problem: string): BenchError => new BenchError(4, `${at.where} ${problem}`);

const inside = (at: Place, key: string): Place => ({ where: at.where, prefix: `${at.prefix}${key}.` });

function field(record: JsonObject, key: string, at: Place): unknown {
  if (!Object.hasOwn(record, key)) {
    throw malformed(at, `lacks ${at.prefix}${key}`);
  }
  return record[key];
}

function numberAt(record: JsonObject, key: string, at: Place): number {
  const value = field(record, key, at);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(at, `has ${at.prefix}${key} that is not a number`);
  }
  return value;
}

function numberOrNullAt(record: JsonObject, key: string, at: Place): number | null {
  return field(record, key, at) === null ? null : numberAt(record, key, at);
}

function stringAt(record: JsonObject, key: string, at: Place): string {
  const value = field(record, key, at);
  if (typeof value !== 'string') {
    throw malformed(at, `has ${at.prefix}${key} that is not a string`);
  }
  return value;
}

function stringOrNullAt(record: JsonObject, key: string, at: Place): string | null {
  return field(record, key, at) === null ? null : stringAt(record, key, at);
}

function booleanAt(record: JsonObject, key: string, at: Place): boolean {
  const value = field(record, key, at);
  if (typeof value !== 'boolean') {
    throw malformed(at, `has ${at.prefix}${key} that is not true or false`);
  }
  return value;
}

function objectAt(record: JsonObject, key: string, at: Place): JsonObject {
  const value = field(record, key, at);
  if (!isObject(value)) {
    throw malformed(at, `has ${at.prefix}${key} that is not an object`);
  }
  return value;
}

function oneOf<const T extends string>(record: JsonObject, key: string, at: Place, allowed: readonly T[]): T {
  const value = stringAt(record, key, at);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw malformed(at, `has ${at.prefix}${key} "${value.slice(0, 32)}", not one of ${allowed.join(', ')}`);
  }
  return match;
}

function entriesAt<T>(
  record: JsonObject,
  key: string,
  at: Place,
  read: (value: unknown, name: string, place: Place) => T,
): Readonly<Record<string, T>> {
  const place = inside(at, key);
  return Object.fromEntries(
    Object.entries(objectAt(record, key, at)).map(([name, value]) => [name, read(value, name, place)]),
  );
}

function entryObject(value: unknown, name: string, at: Place): JsonObject {
  if (!isObject(value)) {
    throw malformed(at, `has ${at.prefix}${name} that is not an object`);
  }
  return value;
}

function readSpan(value: unknown, name: string, at: Place): SpanFigures {
  const span = entryObject(value, name, at);
  const place = inside(at, name);
  return {
    n: numberAt(span, 'n', place),
    cn: numberAt(span, 'cn', place),
    incl: numberAt(span, 'incl', place),
    self: numberAt(span, 'self', place),
    cpu: numberAt(span, 'cpu', place),
    p50: numberAt(span, 'p50', place),
    p95: numberAt(span, 'p95', place),
    max: numberAt(span, 'max', place),
  };
}

function readLimit(value: unknown, name: string, at: Place): LimitFigures {
  const limit = entryObject(value, name, at);
  const place = inside(at, name);
  return {
    n: numberAt(limit, 'n', place),
    used: numberAt(limit, 'used', place),
    max: numberAt(limit, 'max', place),
    ratio: numberAt(limit, 'ratio', place),
    near: numberAt(limit, 'near', place),
    over: numberAt(limit, 'over', place),
    run_peak: numberAt(limit, 'run_peak', place),
    armed: booleanAt(limit, 'armed', place),
  };
}

function readEvent(value: unknown, name: string, at: Place): EventFigures {
  const event = entryObject(value, name, at);
  const place = inside(at, name);
  return {
    n: numberAt(event, 'n', place),
    run_n: numberAt(event, 'run_n', place),
    suppressed: numberAt(event, 'suppressed', place),
    run_suppressed: numberAt(event, 'run_suppressed', place),
  };
}

function readCount(value: unknown, name: string, at: Place): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(at, `has ${at.prefix}${name} that is not a number`);
  }
  return value;
}

function readProcess(line: JsonObject, at: Place): ProcessFigures {
  const figures = objectAt(line, 'process', at);
  const place = inside(at, 'process');
  const delay = objectAt(figures, 'loop.delay', place);
  const delayPlace = inside(place, 'loop.delay');
  return {
    cpu: numberAt(figures, 'cpu', place),
    main_cpu: numberAt(figures, 'main_cpu', place),
    offthread_cpu: numberAt(figures, 'offthread_cpu', place),
    unattributed_cpu: numberAt(figures, 'unattributed_cpu', place),
    elu: numberAt(figures, 'elu', place),
    alloc_bytes: numberAt(figures, 'alloc_bytes', place),
    heap: field(figures, 'heap', place),
    gc: field(figures, 'gc', place),
    'loop.delay': {
      p50_us: numberAt(delay, 'p50_us', delayPlace),
      p99_us: numberAt(delay, 'p99_us', delayPlace),
      max_us: numberAt(delay, 'max_us', delayPlace),
    },
  };
}

function readFailing(line: JsonObject, at: Place): readonly string[] {
  const value = field(line, 'failing', at);
  if (!Array.isArray(value)) {
    throw malformed(at, 'has failing that is not a list');
  }
  return value.map((name: unknown) => {
    if (typeof name !== 'string') {
      throw malformed(at, 'has a failing entry that is not a string');
    }
    return name;
  });
}

function readSampled(line: JsonObject, at: Place): SampledFigures {
  const sampled = objectAt(line, 'sampled', at);
  const place = inside(at, 'sampled');
  return { n: numberAt(sampled, 'n', place), incl: numberAt(sampled, 'incl', place) };
}

function readSnapshot(line: JsonObject, at: Place): SnapshotLine {
  return {
    t: numberAt(line, 't', at),
    at: field(line, 'at', at),
    window_ms: numberAt(line, 'window_ms', at),
    final: booleanAt(line, 'final', at),
    requests: numberAt(line, 'requests', at),
    sampled: readSampled(line, at),
    process: readProcess(line, at),
    spans: entriesAt(line, 'spans', at, readSpan),
    counts: entriesAt(line, 'counts', at, readCount),
    limits: entriesAt(line, 'limits', at, readLimit),
    events: entriesAt(line, 'events', at, readEvent),
    gauges: objectAt(line, 'gauges', at),
    failing: readFailing(line, at),
  };
}

function readJournal(line: JsonObject, at: Place): JournalLine {
  const subject = field(line, 'subject', at);
  if (subject !== null && typeof subject !== 'string' && typeof subject !== 'number') {
    throw malformed(at, 'has subject that is not a string, a number or null');
  }
  return {
    t: numberAt(line, 't', at),
    hook: stringAt(line, 'hook', at),
    route: stringOrNullAt(line, 'route', at),
    status: numberOrNullAt(line, 'status', at),
    subject,
    fails_run: booleanAt(line, 'fails_run', at),
  };
}

function readRoute(value: unknown, index: number, at: Place): RunRoute {
  const name = String(index);
  const route = entryObject(value, name, at);
  const place = inside(at, name);
  return {
    id: stringAt(route, 'id', place),
    name: stringAt(route, 'name', place),
    method: stringAt(route, 'method', place),
    path: stringAt(route, 'path', place),
  };
}

function readRun(header: JsonObject, at: Place): RunHeader {
  const routes = field(header, 'routes', at);
  if (!Array.isArray(routes)) {
    throw malformed(at, 'has routes that is not a list');
  }
  const sampling = objectAt(header, 'sampling', at);
  const samplingPlace = inside(at, 'sampling');
  const routesPlace = inside(at, 'routes');
  return {
    format: oneOf(header, 'format', at, [recorderFormat]),
    recorder: stringAt(header, 'recorder', at),
    status: oneOf(header, 'status', at, ['booting', 'listening', 'closed']),
    commit: stringOrNullAt(header, 'commit', at),
    branch: stringOrNullAt(header, 'branch', at),
    node: stringAt(header, 'node', at),
    pid: numberAt(header, 'pid', at),
    build: oneOf(header, 'build', at, ['source', 'dist']),
    started_at: numberAt(header, 'started_at', at),
    listening_at: numberOrNullAt(header, 'listening_at', at),
    closed_at: numberOrNullAt(header, 'closed_at', at),
    address: field(header, 'address', at),
    ready_ms: numberOrNullAt(header, 'ready_ms', at),
    sampling: {
      step_n: numberAt(sampling, 'step_n', samplingPlace),
      cpu_n: numberAt(sampling, 'cpu_n', samplingPlace),
      block_ms: numberAt(sampling, 'block_ms', samplingPlace),
    },
    canary: booleanAt(header, 'canary', at),
    options: field(header, 'options', at),
    capacity: field(header, 'capacity', at),
    routes: routes.map((route: unknown, index) => readRoute(route, index, routesPlace)),
  };
}

function couldNotRead(path: string, error: unknown): never {
  const code = errorCode(error);
  if (code === null) {
    throw error;
  }
  throw new BenchError(
    3,
    code === 'ENOENT' ? `${path} is missing; the recorder did not write it.` : `cannot read ${path}: ${code}.`,
  );
}

function readBounded(path: string, limitBytes: number): string {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    couldNotRead(path, error);
  }
  try {
    const size = fstatSync(fd).size;
    if (size > limitBytes) {
      throw new BenchError(
        4,
        `${path} holds ${size} bytes, more than the ${limitBytes} a recorder file is read up to.`,
      );
    }
    const buffer = Buffer.alloc(size);
    let filled = 0;
    let read = -1;
    while (filled < size && read !== 0) {
      read = readSync(fd, buffer, filled, size - filled, filled);
      filled += read;
    }
    return buffer.toString('utf8', 0, filled);
  } catch (error) {
    if (error instanceof BenchError) {
      throw error;
    }
    couldNotRead(path, error);
  } finally {
    closeSync(fd);
  }
}

function parseJson(text: string, at: Place): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw malformed(at, 'is not JSON');
    }
    throw error;
  }
  if (!isObject(value)) {
    throw malformed(at, 'is not a JSON object');
  }
  return value;
}

function readLines<T>(path: string, read: (line: JsonObject, at: Place) => T): readonly T[] {
  const lines = readBounded(path, linesLimitBytes).split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.map((text, index) => {
    const at: Place = { where: `${path} line ${index + 1}`, prefix: '' };
    return read(parseJson(text, at), at);
  });
}

export function readRecorderFolder(folder: string): RecorderFolder {
  const runPath = join(folder, runFile);
  const runAt: Place = { where: runPath, prefix: '' };
  return {
    folder,
    run: readRun(parseJson(readBounded(runPath, runLimitBytes), runAt), runAt),
    snapshots: readLines(join(folder, snapshotFile), readSnapshot),
    journal: readLines(join(folder, journalFile), readJournal),
  };
}

export function countSnapshotLines(folder: string): number {
  const path = join(folder, snapshotFile);
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    couldNotRead(path, error);
  }
  try {
    const chunk = Buffer.alloc(countChunkBytes);
    let lines = 0;
    let position = 0;
    let read = -1;
    while (read !== 0) {
      read = readSync(fd, chunk, 0, countChunkBytes, position);
      position += read;
      for (let index = 0; index < read; index++) {
        if (chunk[index] === newline) {
          lines++;
        }
      }
    }
    return lines;
  } catch (error) {
    couldNotRead(path, error);
  } finally {
    closeSync(fd);
  }
}
