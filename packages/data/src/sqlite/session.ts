// Does:  Opens the one SQLite connection with its open-time settings and implements the session on it.
// Holds: run executes a text only when its first statement is the whole of it, so no statement is dropped unseen.

// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { count } from '#diag';
import { DataError } from '../data-error/data-error.ts';
import { markReason } from '../data-error/reason.ts';
import type { TransactionOptions } from '../database/types.ts';
import type { ResolvedBounds } from '../options/bounds.ts';
import { ROW_COST, VALUE_COST } from '../session/result-cost.ts';
import type { Session, SessionResult } from '../session/types.ts';
import type { Parameter } from '../sql/types.ts';
import { createDatabaseFile } from './file.ts';

const MEMORY = ':memory:';
const OPTIONS = { timeout: 0, readBigInts: true, returnArrays: true } as const;

const MEMORY_SETTINGS =
  'PRAGMA query_only = 0; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL;';
const FILE_SETTINGS =
  'PRAGMA query_only = 0; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; PRAGMA journal_mode = WAL;';
const READ_SETTINGS =
  'SELECT * FROM pragma_query_only, pragma_foreign_keys, pragma_busy_timeout, pragma_synchronous, pragma_journal_mode';
// Why: The values READ_SETTINGS returns, in its column order, once the settings above hold; synchronous FULL is 2.
const MEMORY_EXPECTED: readonly unknown[] = [0n, 1n, 0n, 2n, 'memory'];
const FILE_EXPECTED: readonly unknown[] = [0n, 1n, 0n, 2n, 'wal'];

// Why: sourceSQL ends at the first statement's semicolon and leaves out the whitespace after it, which runs nothing.
const BLANK = /^[\t\n\f\r ]*$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const NUMBER_BYTES = 8;

function wholeText(source: string, text: string): boolean {
  return text.startsWith(source) && BLANK.test(text.slice(source.length));
}

function bindable(parameter: Parameter): SQLInputValue {
  if (typeof parameter === 'number') {
    // Why: node:sqlite binds every number as REAL, which a column without affinity keeps as 42.0.
    return Number.isSafeInteger(parameter) ? BigInt(parameter) : parameter;
  }
  if (typeof parameter === 'bigint') {
    if (parameter < INT64_MIN || parameter > INT64_MAX) {
      throw new DataError('INVALID_QUERY');
    }
    return parameter;
  }
  if (typeof parameter === 'boolean') {
    return parameter ? 1n : 0n;
  }
  if (parameter instanceof Date) {
    return parameter.toISOString();
  }
  return parameter;
}

function valueBytes(value: SQLInputValue): number {
  if (value === null) {
    return 0;
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8');
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return NUMBER_BYTES;
  }
  return value.byteLength;
}

function sameValues(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

// Does:  Turns SQLite's own refusal into QUERY_FAILED with its extended code; any other throw passes on as a defect.
function failure(error: unknown, text: string): DataError {
  if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number') {
    return new DataError('QUERY_FAILED', { sqliteCode: error.errcode, detail: { message: error.message, sql: text } });
  }
  throw error;
}

function createSqliteSession(db: DatabaseSync, memory: boolean, bounds: ResolvedBounds): Session {
  const settings = memory ? MEMORY_SETTINGS : FILE_SETTINGS;
  const expected = memory ? MEMORY_EXPECTED : FILE_EXPECTED;
  const readSettings = db.prepare(READ_SETTINGS);
  const totalChanges = db.prepare('SELECT total_changes()');
  const maxParameters = db.limits.variableNumber;
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();
  let readOnly = false;

  const status = (): Session['status'] => {
    if (!db.isOpen) {
      return 'closed';
    }
    return db.isTransaction ? 'transaction' : 'idle';
  };

  const enter = (signal: AbortSignal): void => {
    if (signal.aborted) {
      throw new DataError('CANCELLED');
    }
    if (!db.isOpen) {
      throw markReason(new DataError('CONNECTION_LOST'), 'lost');
    }
  };

  const exec = (text: string): void => {
    try {
      db.exec(text);
    } catch (error) {
      throw failure(error, text);
    }
  };

  const prepare = (text: string): StatementSync => {
    let statement: StatementSync;
    try {
      statement = db.prepare(text);
    } catch (error) {
      // Why: node:sqlite refuses text that holds no statement with ERR_INVALID_ARG_VALUE before SQLite sees it.
      if (error instanceof Error && 'code' in error && error.code === 'ERR_INVALID_ARG_VALUE') {
        throw new DataError('INVALID_QUERY');
      }
      throw failure(error, text);
    }
    // Why: SQLite compiles only the first statement and drops the rest of the text without an error.
    if (!wholeText(statement.sourceSQL, text)) {
      throw new DataError('INVALID_QUERY');
    }
    return statement;
  };

  // Does:  Runs a prepared statement, reading its rows when it has columns and refusing them past maxResultBytes.
  const execute = (
    statement: StatementSync,
    hasColumns: boolean,
    values: readonly SQLInputValue[],
    text: string,
  ): (readonly unknown[])[] => {
    const rows: (readonly unknown[])[] = [];
    try {
      if (!hasColumns) {
        statement.run(...values);
        return rows;
      }
      let bytes = 0;
      for (const row of statement.iterate(...values)) {
        const fields = Object.values(row);
        bytes += fields.reduce((sum: number, value) => sum + VALUE_COST + valueBytes(value), ROW_COST);
        if (bytes > bounds.maxResultBytes) {
          throw new DataError('RESULT_TOO_LARGE');
        }
        rows.push(fields);
      }
    } catch (error) {
      throw error instanceof DataError ? error : failure(error, text);
    }
    return rows;
  };

  const changes = (): number => {
    const total = Object.values(totalChanges.get() ?? {})[0];
    if (typeof total !== 'bigint') {
      throw new TypeError('SQLite total_changes() returned no integer');
    }
    return Number(total);
  };

  const settingsHold = (): boolean => {
    try {
      return sameValues(Object.values(readSettings.get() ?? {}), expected);
    } catch {
      // Why: Settings that cannot be read are not proven, so the session is not handed to another caller.
      return false;
    }
  };

  const leaveReadOnly = (): void => {
    if (readOnly) {
      exec('PRAGMA query_only = 0');
      readOnly = false;
    }
  };

  const leaveReadOnlyWhenEnded = (): void => {
    if (!db.isTransaction) {
      leaveReadOnly();
    }
  };

  const run = (text: string, parameters: readonly Parameter[], signal: AbortSignal): SessionResult => {
    enter(signal);
    // Why: SQLite reads text as a C string, so whatever follows a NUL would be dropped unseen.
    if (text.includes('\0')) {
      throw new DataError('INVALID_QUERY');
    }
    if (parameters.length > maxParameters) {
      throw new DataError('PARAMETERS_TOO_LARGE');
    }
    const values = parameters.map(bindable);
    const bytes = values.reduce((sum: number, value) => sum + valueBytes(value), Buffer.byteLength(text, 'utf8'));
    if (bytes > bounds.maxParameterBytes) {
      throw new DataError('PARAMETERS_TOO_LARGE');
    }
    const statement = prepare(text);
    const columns = statement.columns().map((column) => column.name);
    const before = changes();
    const rows = execute(statement, columns.length > 0, values, text);
    return { command: '', rowCount: changes() - before, columns, rows };
  };

  const script = (text: string, signal: AbortSignal): void => {
    enter(signal);
    if (text.includes('\0')) {
      throw new DataError('INVALID_QUERY');
    }
    if (Buffer.byteLength(text, 'utf8') > bounds.maxParameterBytes) {
      throw new DataError('PARAMETERS_TOO_LARGE');
    }
    exec(text);
  };

  const begin = (options: TransactionOptions, signal: AbortSignal): void => {
    enter(signal);
    if (options.readOnly !== true) {
      exec('BEGIN IMMEDIATE');
      return;
    }
    exec('BEGIN');
    try {
      exec('PRAGMA query_only = 1');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    readOnly = true;
  };

  const commit = (signal: AbortSignal): 'committed' | 'rolled-back' => {
    enter(signal);
    // Why: Some errors make SQLite roll the transaction back itself, so there is nothing left to commit.
    if (!db.isTransaction) {
      leaveReadOnly();
      return 'rolled-back';
    }
    try {
      exec('COMMIT');
    } finally {
      leaveReadOnlyWhenEnded();
    }
    return 'committed';
  };

  const rollback = (signal: AbortSignal): void => {
    enter(signal);
    try {
      if (db.isTransaction) {
        exec('ROLLBACK');
      }
    } finally {
      leaveReadOnlyWhenEnded();
    }
  };

  const restore = (): boolean => {
    if (!db.isOpen) {
      return false;
    }
    try {
      if (db.isTransaction) {
        db.exec('ROLLBACK');
      }
      db.exec(settings);
    } catch {
      // Why: A restore that cannot finish leaves the session unproven; false makes the pool destroy it.
      return false;
    }
    readOnly = false;
    return settingsHold();
  };

  const destroy = (): void => {
    if (db.isOpen) {
      db.close();
    }
    resolveClosed();
  };

  return {
    get status() {
      return status();
    },
    get reusable() {
      return status() === 'idle' && settingsHold();
    },
    closed,
    run: (text, parameters, signal) => Promise.try(() => run(text, parameters, signal)),
    script: (text, signal) => Promise.try(() => script(text, signal)),
    begin: (options, signal) => Promise.try(() => begin(options, signal)),
    commit: (signal) => Promise.try(() => commit(signal)),
    rollback: (signal) => Promise.try(() => rollback(signal)),
    restore,
    // Why: SQLite has nothing to send before closing, and closing rolls back an open transaction.
    end: destroy,
    destroy,
  };
}

export function openSqliteSession(path: string, bounds: ResolvedBounds, signal: AbortSignal): Promise<Session> {
  return Promise.try(() => open(path, bounds, signal));
}

function open(path: string, bounds: ResolvedBounds, signal: AbortSignal): Session {
  if (signal.aborted) {
    throw new DataError('CANCELLED');
  }
  const memory = path === MEMORY;
  let db: DatabaseSync | null = null;
  const refuse = (): DataError => {
    if (db?.isOpen === true) {
      db.close();
    }
    count('data.connect.failed', 'open');
    return markReason(new DataError('CONNECT_FAILED'), 'open');
  };
  try {
    if (!memory) {
      createDatabaseFile(path);
    }
    db = new DatabaseSync(path, OPTIONS);
    const session = createSqliteSession(db, memory, bounds);
    // Why: restore applies the open-time settings and proves they hold, which is all that opening still needs.
    if (session.restore()) {
      return session;
    }
  } catch {
    // Why: Each step above fails only as a database that could not be opened, which the reason open names.
    throw refuse();
  }
  throw refuse();
}
