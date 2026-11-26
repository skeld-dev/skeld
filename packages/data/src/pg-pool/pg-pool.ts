// Does:  Presents a PostgreSQL database as the pool shape auth's PostgreSQL store accepts, on data's own connections.
// Holds: A client releases its lease exactly once, and its statements run one at a time on the session it leased.

import { BootError } from '@skeld/core/boot-error';
import { DataError } from '../data-error/data-error.ts';
import type { Database } from '../database/types.ts';
import { internalsOf } from '../handle/internals.ts';
import type { DatabaseInternals } from '../handle/internals-types.ts';
import type { Lease, Pool } from '../pool/types.ts';
import type { PostgresConnection } from '../postgres/connection-types.ts';
import { readRows } from '../rows/rows.ts';
import { checkParameters } from '../sql/render.ts';

type ErrorListener = (error: Error) => void;

interface PoolAnswer {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

interface StoreClient {
  query(text: string, values?: readonly unknown[]): Promise<PoolAnswer>;
  release(destroy?: boolean): void;
  on(event: 'error', listener: ErrorListener): unknown;
  removeListener(event: 'error', listener: ErrorListener): unknown;
}

interface StorePool {
  connect(): Promise<StoreClient>;
  on(event: 'error', listener: ErrorListener): unknown;
  removeListener(event: 'error', listener: ErrorListener): unknown;
  readonly options: { readonly max: number };
}

type PostgresInternals = Extract<DatabaseInternals, { readonly pool: Pool<PostgresConnection> }>;

// Why: The union's discriminant is the nested engine.name, which TypeScript does not narrow by on its own.
function isPostgres(internals: DatabaseInternals): internals is PostgresInternals {
  return internals.engine.name === 'postgres';
}

// Why: A checkout has no caller signal; the pool's acquireTimeoutMs and its close end every wait.
const NO_SIGNAL = new AbortController().signal;

// Does:  Wraps a session's failure in the fixed error a pg-shaped caller classifies by code and severity.
function statementFailure(failure: unknown): Error {
  const error = new Error('Database statement failed', { cause: failure });
  if (!(failure instanceof DataError) || failure.sqlState === null) {
    return error;
  }
  if (failure.code === 'QUERY_FAILED') {
    return Object.assign(error, { code: failure.sqlState, severity: 'ERROR' });
  }
  if (failure.code === 'CONNECTION_LOST') {
    return Object.assign(error, { code: failure.sqlState, severity: 'FATAL' });
  }
  return error;
}

// Does:  Builds the checked-out client over one lease; its error listeners fire if the session closes while held.
function storeClient(lease: Lease<PostgresConnection>): StoreClient {
  const { session } = lease;
  const listeners = new Set<ErrorListener>();
  let held = true;
  // Why: A session runs one cycle at a time and its holder queues, as a pg client queues its queries.
  let tail: Promise<unknown> = Promise.resolve();
  const abandoned = new AbortController();
  const signal = AbortSignal.any([lease.signal, abandoned.signal]);
  let running = false;
  let cancelling = false;
  void session.closed.then(() => {
    if (!held) {
      return;
    }
    const lost = new DataError('CONNECTION_LOST');
    for (const listener of [...listeners]) {
      listener(lost);
    }
  });
  const statement = async (text: string, values: readonly unknown[] | undefined): Promise<PoolAnswer> => {
    if (!held) {
      throw new DataError('HANDLE_CLOSED');
    }
    const parameters = values === undefined ? null : checkParameters(values);
    running = true;
    try {
      const result =
        parameters === null ? await session.simple(text, signal) : await session.run(text, parameters, signal);
      return { rows: readRows(result, null), rowCount: result.rowCount };
    } catch (failure) {
      if (failure instanceof DataError && failure.code === 'CANCELLED' && session.status !== 'closed') {
        cancelling = true;
      }
      throw failure;
    } finally {
      running = false;
    }
  };
  return {
    query(text, values) {
      const answer = tail.then(() => statement(text, values));
      tail = answer.then(
        () => undefined,
        () => undefined,
      );
      return answer.catch((failure: unknown) => {
        throw statementFailure(failure);
      });
    },
    release(destroy) {
      if (!held) {
        throw new Error('Client released twice');
      }
      held = false;
      listeners.clear();
      const inFlight = running;
      // Why: Aborting a running statement makes the session send its cancel and then close itself.
      if (inFlight) {
        abandoned.abort();
      }
      // Why: Destroying a cancelling session drops its cancel and leaves its statement running on an uncounted backend.
      if ((inFlight || cancelling) && session.status !== 'closed') {
        void session.closed.then(() => lease.release('destroy'));
        return;
      }
      lease.release(destroy === true || !session.reusable ? 'destroy' : 'return');
    },
    on(_event, listener) {
      listeners.add(listener);
      return this;
    },
    removeListener(_event, listener) {
      listeners.delete(listener);
      return this;
    },
  };
}

/**
 * Gives `@skeld/auth`'s PostgreSQL store a pool that runs on this database's own connections.
 * Throws BootError `INVALID_OPTION` for a SQLite database; a failed statement carries `code` and `severity`.
 * @example toPgPool(createPostgresDatabase({ url: new Secret('postgres://app@db.example.com/app') })).options.max
 */
export function toPgPool(database: Database): StorePool {
  const internals = internalsOf(database);
  if (!isPostgres(internals)) {
    throw new BootError('INVALID_OPTION', 'Invalid option database: toPgPool takes a PostgreSQL database', null, null);
  }
  const { pool } = internals;
  const storePool: StorePool = {
    async connect() {
      return storeClient(await pool.acquire(NO_SIGNAL));
    },
    on: () => storePool,
    removeListener: () => storePool,
    options: Object.freeze({ max: internals.engine.maxSessions }),
  };
  return Object.freeze(storePool);
}
