// Does:  Exports @skeld/auth/sqlite: the SQLite store over one node:sqlite connection, its install, attach and close.
// Holds: A unit runs BEGIN IMMEDIATE through COMMIT in one synchronous turn; a busy database is retried on a timer.

import { closeSync, existsSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { BootError } from '@skeld/core/boot-error';
import { count, end, start } from '#diag';
import { sqliteSchema, SCHEMA_VERSION } from '../store/schema.ts';
import { StoreFailure } from '../store/store.ts';
import type { AttachResult, AuthStore, InstallResult, StoreEvent, StoreOperations } from '../store/types.ts';
import type { SqliteStoreOptions } from './types.ts';
import {
  apiKeyIssue,
  apiKeyList,
  apiKeyRead,
  apiKeyRevoke,
  attemptConsume,
  attemptCreate,
  expiredRemove,
  limitCharge,
  type Query,
  RowFault,
  schemaVersion,
  sessionIssue,
  sessionRead,
  sessionRenew,
  sessionRevoke,
  sessionRotate,
  subjectDisable,
  subjectEnable,
  subjectEnsure,
  subjectInvalidate,
  subjectRead,
} from './units.ts';

export type { SqliteStoreOptions } from './types.ts';

const MEMORY = ':memory:';
const DEFAULT_CLEANUP_SECONDS = 60;
const MAX_CLEANUP_SECONDS = 3600;
const CLEANUP_LIMIT = 1000;
const MAX_LIMIT = 1000;
const CLEANUP_AGAIN_MS = 1000;
// Why: Ten attempts 1 ms apart doubling to 256 ms bound a busy unit at about 0.5 s without holding the loop.
const ATTEMPTS = 10;
const SQLITE_BUSY = 5;
const SQLITE_CANTOPEN = 14;
const FILE_MODE = 0o600;

interface Connection {
  readonly db: DatabaseSync;
  readonly q: Query;
}

type Attempt<T> = { readonly busy: false; readonly value: T } | { readonly busy: true; readonly code: number };

function invalidOption(message: string): BootError {
  return new BootError('INVALID_OPTION', message, null, null);
}

function checkOptions(options: SqliteStoreOptions): { readonly path: string; readonly intervalMs: number } {
  if (typeof options !== 'object' || options === null) {
    throw invalidOption('Invalid sqlite store options: must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'path' && key !== 'cleanupIntervalSeconds') {
      throw invalidOption(`Invalid sqlite store option ${String(key)}: is not a key of SqliteStoreOptions`);
    }
  }
  const { path, cleanupIntervalSeconds = DEFAULT_CLEANUP_SECONDS } = options;
  if (typeof path !== 'string' || (path !== MEMORY && !isAbsolute(path))) {
    throw invalidOption("Invalid sqlite store option path: must be an absolute path or ':memory:'");
  }
  if (
    !Number.isSafeInteger(cleanupIntervalSeconds) ||
    cleanupIntervalSeconds < 1 ||
    cleanupIntervalSeconds > MAX_CLEANUP_SECONDS
  ) {
    throw invalidOption(
      `Invalid sqlite store option cleanupIntervalSeconds: must be an integer from 1 to ${MAX_CLEANUP_SECONDS}`,
    );
  }
  return { path, intervalMs: cleanupIntervalSeconds * 1000 };
}

function sqliteCode(error: unknown): number | null {
  return error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode : null;
}

// Why: The primary result code is the low byte; SQLITE_BUSY_RECOVERY and SQLITE_BUSY_SNAPSHOT are busy too.
function isBusy(error: unknown): boolean {
  const code = sqliteCode(error);
  return code !== null && (code & 0xff) === SQLITE_BUSY;
}

function failure(
  operation: string,
  reason: 'unavailable' | 'fault',
  applied: 'no' | 'unknown',
  error: unknown,
): StoreFailure {
  const code = sqliteCode(error);
  return new StoreFailure(operation, reason, applied, code === null ? null : String(code));
}

function connect(db: DatabaseSync): Connection {
  const prepared = new Map<string, StatementSync>();
  const q: Query = (text) => {
    let statement = prepared.get(text);
    if (statement === undefined) {
      statement = db.prepare(text);
      prepared.set(text, statement);
    }
    return statement;
  };
  return { db, q };
}

// Does:  Opens the database file without creating it; null when it does not exist.
function openFile(path: string): DatabaseSync | null {
  const url = pathToFileURL(path);
  url.searchParams.set('mode', 'rw');
  try {
    return new DatabaseSync(url, { timeout: 0, readBigInts: true });
  } catch (error) {
    if (sqliteCode(error) === SQLITE_CANTOPEN && !existsSync(path)) {
      return null;
    }
    throw error;
  }
}

// Does:  Creates the database file at mode 0600 when it is absent; an existing file is left as it is.
function createFile(path: string): void {
  try {
    closeSync(openSync(path, 'wx', FILE_MODE));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }
}

function configure(db: DatabaseSync): void {
  const mode = db.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode;
  if (mode !== 'wal') {
    throw new Error(`journal mode ${String(mode)}`);
  }
  db.exec('PRAGMA synchronous = FULL');
}

// Does:  Opens the one connection, creating the file only for install; null when attach finds no file.
function open(operation: string, path: string, create: boolean): Connection | null {
  let db: DatabaseSync | null = null;
  try {
    if (path === MEMORY) {
      return connect(new DatabaseSync(MEMORY, { timeout: 0, readBigInts: true }));
    }
    if (create) {
      createFile(path);
    }
    db = openFile(path);
    if (db === null) {
      return null;
    }
    configure(db);
    return connect(db);
  } catch (error) {
    db?.close();
    throw failure(operation, isBusy(error) ? 'unavailable' : 'fault', 'no', error);
  }
}

/**
 * Creates the SQLite auth store; it opens nothing until `install` or `attach`.
 * Throws BootError `INVALID_OPTION` for an unknown key, a relative path or an interval outside 1 to 3,600 seconds.
 * @example createSqliteStore({ path: '/var/lib/app/auth.db' })
 */
export function createSqliteStore(options: SqliteStoreOptions): AuthStore {
  const { path, intervalMs } = checkOptions(options);
  let connection: Connection | null = null;
  let state: 'open' | 'claimed' | 'attached' | 'closing' | 'closed' = 'open';
  let onFailure: ((event: StoreEvent) => void) | null = null;
  let cleanup: NodeJS.Timeout | null = null;
  let closing: Promise<void> | null = null;
  const inFlight = new Set<Promise<unknown>>();
  const closer = new AbortController();

  function report(operation: string, cause: StoreEvent['cause'], code: string | null): void {
    onFailure?.(Object.freeze({ operation, cause, code }));
  }

  function bodyFailure(operation: string, error: unknown): StoreFailure {
    if (error instanceof RowFault) {
      return new StoreFailure(operation, 'record', 'no', null);
    }
    return failure(operation, 'fault', 'no', error);
  }

  function rollback(db: DatabaseSync, operation: string, applied: 'no' | 'unknown'): void {
    if (!db.isTransaction) {
      return;
    }
    try {
      db.exec('ROLLBACK');
    } catch (error) {
      throw failure(operation, 'fault', applied, error);
    }
  }

  // Does:  Runs one write unit, BEGIN IMMEDIATE to COMMIT, in this turn; a lost or refused result is rolled back.
  function writeOnce<T>(
    c: Connection,
    operation: string,
    body: (c: Connection) => T,
    commits: (value: T) => boolean,
  ): Attempt<T> {
    try {
      c.db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (isBusy(error)) {
        return { busy: true, code: sqliteCode(error) ?? SQLITE_BUSY };
      }
      throw failure(operation, 'fault', 'no', error);
    }
    let value: T;
    try {
      value = body(c);
    } catch (error) {
      rollback(c.db, operation, 'no');
      throw bodyFailure(operation, error);
    }
    if (!commits(value)) {
      rollback(c.db, operation, 'no');
      return { busy: false, value };
    }
    try {
      c.db.exec('COMMIT');
    } catch (error) {
      rollback(c.db, operation, 'unknown');
      throw failure(operation, 'unavailable', 'unknown', error);
    }
    return { busy: false, value };
  }

  function readOnce<T>(c: Connection, operation: string, body: (q: Query) => T): Attempt<T> {
    try {
      return { busy: false, value: body(c.q) };
    } catch (error) {
      if (isBusy(error)) {
        return { busy: true, code: sqliteCode(error) ?? SQLITE_BUSY };
      }
      throw bodyFailure(operation, error);
    }
  }

  // Does:  Repeats a busy attempt on a timer, never inside a turn, until it runs or its attempts are spent.
  async function attempt<T>(
    operation: string,
    signal: AbortSignal | undefined,
    once: () => Attempt<T>,
    tried: number,
  ): Promise<T> {
    const outcome = once();
    if (!outcome.busy) {
      return outcome.value;
    }
    if (tried + 1 === ATTEMPTS) {
      count('auth.store.deadline', operation);
      throw new StoreFailure(operation, 'unavailable', 'no', String(outcome.code));
    }
    count('auth.store.busy_retry', operation);
    const wake = signal === undefined ? closer.signal : AbortSignal.any([closer.signal, signal]);
    try {
      await sleep(2 ** tried, undefined, { signal: wake });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
    }
    if (signal?.aborted === true) {
      throw new StoreFailure(operation, 'aborted', 'no', null);
    }
    if (closer.signal.aborted) {
      throw new StoreFailure(operation, 'unavailable', 'no', null);
    }
    return attempt(operation, signal, once, tried + 1);
  }

  function track<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const span = start('auth.store.op', operation);
    const pending = run().finally(() => {
      end(span);
      inFlight.delete(pending);
    });
    inFlight.add(pending);
    return pending;
  }

  function unit<T>(
    operation: string,
    signal: AbortSignal | undefined,
    once: (c: Connection) => Attempt<T>,
  ): Promise<T> {
    if (state !== 'attached' || connection === null) {
      return Promise.reject(new StoreFailure(operation, 'unavailable', 'no', null));
    }
    if (signal?.aborted === true) {
      return Promise.reject(new StoreFailure(operation, 'aborted', 'no', null));
    }
    const c = connection;
    return track(operation, () => attempt(operation, signal, () => once(c), 0));
  }

  function write<T extends { readonly kind: 'done' | 'lost' }>(
    operation: string,
    signal: AbortSignal | undefined,
    body: (q: Query) => T,
  ): Promise<T> {
    return unit(operation, signal, (c) =>
      writeOnce(
        c,
        operation,
        (held) => body(held.q),
        (value) => value.kind === 'done',
      ),
    );
  }

  function read<T>(operation: string, signal: AbortSignal | undefined, body: (q: Query) => T): Promise<T> {
    return unit(operation, signal, (c) => readOnce(c, operation, body));
  }

  // Does:  Refuses a limit outside 1 to 1,000 before any statement runs.
  function bounded<T>(operation: string, limit: number, run: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return Promise.reject(new StoreFailure(operation, 'fault', 'no', null));
    }
    return run();
  }

  function removedFrom(table: string, removed: number): void {
    for (let row = 0; row < removed; row += 1) {
      count('auth.store.cleanup_rows', table);
    }
  }

  const ops: StoreOperations = {
    subjectEnsure: (input, signal) => write('subjectEnsure', signal, (q) => subjectEnsure(q, input)),
    subjectRead: (input, signal) => read('subjectRead', signal, (q) => subjectRead(q, input)),
    subjectDisable: (input, signal) => write('subjectDisable', signal, (q) => subjectDisable(q, input)),
    subjectEnable: (input, signal) => write('subjectEnable', signal, (q) => subjectEnable(q, input)),
    subjectInvalidate: (input, signal) => write('subjectInvalidate', signal, (q) => subjectInvalidate(q, input)),
    sessionIssue: (input, signal) => write('sessionIssue', signal, (q) => sessionIssue(q, input)),
    sessionRead: (input, signal) => read('sessionRead', signal, (q) => sessionRead(q, input)),
    sessionRenew: (input, signal) => write('sessionRenew', signal, (q) => sessionRenew(q, input)),
    sessionRotate: (input, signal) => write('sessionRotate', signal, (q) => sessionRotate(q, input)),
    sessionRevoke: (input, signal) => write('sessionRevoke', signal, (q) => sessionRevoke(q, input)),
    apiKeyIssue: (input, signal) => write('apiKeyIssue', signal, (q) => apiKeyIssue(q, input)),
    apiKeyRead: (input, signal) => read('apiKeyRead', signal, (q) => apiKeyRead(q, input)),
    apiKeyList: (input, signal) =>
      bounded('apiKeyList', input.limit, () => read('apiKeyList', signal, (q) => apiKeyList(q, input))),
    apiKeyRevoke: (input, signal) => write('apiKeyRevoke', signal, (q) => apiKeyRevoke(q, input)),
    limitCharge: (input, signal) => write('limitCharge', signal, (q) => limitCharge(q, input)),
    attemptCreate: (input, signal) => write('attemptCreate', signal, (q) => attemptCreate(q, input)),
    attemptConsume: (input, signal) => write('attemptConsume', signal, (q) => attemptConsume(q, input)),
    expiredRemove: (input, signal) =>
      bounded('expiredRemove', input.limit, () =>
        write('expiredRemove', signal, (q) => expiredRemove(q, input, removedFrom)),
      ),
  };
  Object.freeze(ops);

  function schedule(delayMs: number): void {
    cleanup = setTimeout(pass, delayMs);
    // Why: A store left unclosed must not keep the process alive for its maintenance timer alone.
    cleanup.unref();
  }

  function pass(): void {
    ops.expiredRemove({ limit: CLEANUP_LIMIT }).then(
      (result) => {
        if (state === 'attached') {
          schedule(result.removed === CLEANUP_LIMIT ? CLEANUP_AGAIN_MS : intervalMs);
        }
      },
      (error: unknown) => {
        if (state !== 'attached') {
          return;
        }
        if (error instanceof StoreFailure && error.reason !== 'aborted') {
          report(error.operation, error.applied === 'unknown' ? 'unknown' : error.reason, error.code);
        } else {
          report('expiredRemove', 'fault', null);
        }
        schedule(intervalMs);
      },
    );
  }

  function installBody(c: Connection): InstallResult {
    const found = schemaVersion(c.q);
    if (found === null) {
      for (const statement of sqliteSchema) {
        c.db.exec(statement);
      }
      return Object.freeze({ kind: 'installed' });
    }
    return Object.freeze(found === SCHEMA_VERSION ? { kind: 'current' } : { kind: 'mismatch', found });
  }

  function install(): Promise<InstallResult> {
    if (state === 'closing' || state === 'closed') {
      return Promise.reject(new StoreFailure('install', 'unavailable', 'no', null));
    }
    return track('install', async () => {
      connection ??= open('install', path, true);
      const c = connection;
      if (c === null) {
        throw new StoreFailure('install', 'fault', 'no', null);
      }
      return await attempt(
        'install',
        undefined,
        () => writeOnce(c, 'install', installBody, (r) => r.kind === 'installed'),
        0,
      );
    });
  }

  async function attach(config: Parameters<AuthStore['attach']>[0]): Promise<AttachResult> {
    if (state === 'closing' || state === 'closed') {
      throw new StoreFailure('attach', 'unavailable', 'no', null);
    }
    if (state !== 'open') {
      return Object.freeze({ kind: 'in_use' });
    }
    state = 'claimed';
    try {
      connection ??= open('attach', path, false);
      const c = connection;
      if (c === null) {
        state = 'open';
        return Object.freeze({ kind: 'not_installed' });
      }
      const found = await attempt('attach', undefined, () => readOnce(c, 'attach', schemaVersion), 0);
      if (found !== SCHEMA_VERSION) {
        state = 'open';
        return Object.freeze(found === null ? { kind: 'not_installed' } : { kind: 'mismatch', found });
      }
    } catch (error) {
      state = 'open';
      throw error;
    }
    state = 'attached';
    onFailure = config.onFailure;
    // Why: A first delay drawn from half to all of the interval keeps instances that start together out of step.
    schedule((0.5 + Math.random() / 2) * intervalMs);
    return Object.freeze({ kind: 'attached' });
  }

  async function shut(): Promise<void> {
    state = 'closing';
    if (cleanup !== null) {
      clearTimeout(cleanup);
    }
    closer.abort();
    await Promise.allSettled(inFlight);
    try {
      connection?.db.close();
    } catch (error) {
      const code = sqliteCode(error);
      report('close', 'fault', code === null ? null : String(code));
    }
    connection = null;
    state = 'closed';
  }

  return Object.freeze({
    install,
    attach,
    close: () => {
      closing ??= shut();
      return closing;
    },
    ops,
  });
}
