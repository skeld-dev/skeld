// Does:  Binds database work to an owner: queries, transactions and reservations over sessions leased from the pool.
// Holds: Every lease is released exactly once, and each failure handed to a caller writes at most one record.

import { count, end, start } from '#diag';
import type { Infer, ObjectSchema } from '@skeld/core/schema';
import { DataError } from '../data-error/data-error.ts';
import type { DataErrorCode } from '../data-error/types.ts';
import { markReason, reasonOf } from '../data-error/reason.ts';
import type {
  BoundDatabase,
  Owner,
  Queryable,
  ReservedConnection,
  Row,
  TransactionOptions,
} from '../database/types.ts';
import { failureFields } from '../events/events.ts';
import type { Lease } from '../pool/types.ts';
import { checkRowSchema, readRows } from '../rows/rows.ts';
import type { Session } from '../session/types.ts';
import { renderQuery } from '../sql/render.ts';
import type { Parameter, Query } from '../sql/types.ts';
import type { DatabaseInternals } from './internals-types.ts';

type Verdict = 'return' | 'restore' | 'destroy';

interface Work {
  readonly internals: DatabaseInternals;
  readonly owner: Owner;
}

interface Prepared {
  readonly text: string;
  readonly parameters: readonly Parameter[];
  readonly schema: ObjectSchema | null;
}

// Why: These four are the failures of a statement itself, each recorded as data.statement.failed.
const STATEMENT_FAILURES: ReadonlySet<DataErrorCode> = new Set([
  'QUERY_FAILED',
  'ROW_INVALID',
  'RESULT_TOO_LARGE',
  'COMMIT_UNKNOWN',
]);

// Does:  Writes the one record of a failure handed to the caller, on the owner's logger; closed: the session ended.
function record(work: Work, failure: DataError, closed: boolean): void {
  if (closed) {
    countClosed(failure);
  }
  const { events, engine } = work.internals;
  const fields = failureFields(failure, engine.name);
  if (STATEMENT_FAILURES.has(failure.code)) {
    count('data.statement.failed', failure.code);
    events?.statementFailed(work.owner.log, fields);
  } else if (failure.code === 'CONNECT_FAILED') {
    events?.connectFailed(work.owner.log, fields);
  } else if (
    failure.code === 'CONNECTION_LOST' ||
    failure.code === 'PROTOCOL_VIOLATION' ||
    (failure.code === 'INVALID_QUERY' && closed)
  ) {
    events?.connectionClosed(work.owner.log, fields);
  }
}

function countClosed(failure: DataError): void {
  const reason = reasonOf(failure);
  if (reason !== null) {
    count('data.connection.closed', reason);
  }
}

// Why: Closing SQLite's one connection would empty a :memory: database, so SQLite is restored where PostgreSQL closes.
function controlVerdict(work: Work): Verdict {
  return work.internals.engine.name === 'postgres' ? 'destroy' : 'restore';
}

function isControl(failure: unknown): boolean {
  return failure instanceof DataError && reasonOf(failure) === 'transaction-control';
}

// Does:  Chooses how a session is given back after a failed call: closed or mid-cancel it is destroyed, else returned.
function verdictAfter(work: Work, session: Session, failure: unknown): Verdict {
  if (!(failure instanceof DataError) || session.status === 'closed') {
    return 'destroy';
  }
  if (isControl(failure)) {
    return controlVerdict(work);
  }
  return failure.code === 'CANCELLED' && !session.reusable ? 'destroy' : 'return';
}

// Why: A statement that changed a setting leaves the session unreusable; restore keeps SQLite's one connection alive.
function settledVerdict(session: Session): Verdict {
  return session.reusable ? 'return' : 'restore';
}

// Why: A cancelling PostgreSQL session closes itself once its cancel is sent; destroying it first stops the cancel.
const cancelling = new WeakSet<Session>();

function isCancelling(session: Session): boolean {
  return cancelling.has(session) && session.status !== 'closed';
}

// Does:  Releases a lease now, or once a cancelling session has closed itself.
function releaseLease(lease: Lease<Session>, verdict: Verdict): void {
  const { session } = lease;
  if (!isCancelling(session)) {
    lease.release(verdict);
    return;
  }
  // Why: The lease stays held, so the pool counts it and close cuts it; closed never rejects.
  void session.closed.then(() => lease.release(verdict));
}

// Does:  Applies a verdict to a session still held by a reservation, whose lease is released only when it ends.
function applyHeld(session: Session, verdict: Verdict): void {
  if (isCancelling(session)) {
    return;
  }
  if (verdict === 'destroy' || (verdict === 'restore' && !session.restore())) {
    session.destroy();
  }
}

// Does:  Sends one cycle under the statement span, and marks a session whose statement is being cancelled.
async function cycle<R>(work: Work, session: Session, signal: AbortSignal, send: () => Promise<R>): Promise<R> {
  const token = start('data.statement', work.internals.engine.name);
  // Why: A call made under an aborted signal rejects CANCELLED with nothing sent, so only an earlier call was written.
  const written = !signal.aborted;
  try {
    return await send();
  } catch (error) {
    if (written && error instanceof DataError && error.code === 'CANCELLED' && session.status !== 'closed') {
      cancelling.add(session);
    }
    throw error;
  } finally {
    end(token);
  }
}

function prepare(work: Work, query: Query, row: ObjectSchema | null): Prepared {
  if (row !== null) {
    checkRowSchema(row);
  }
  const { text, parameters } = renderQuery(query, work.internals.engine.style);
  return { text, parameters, schema: row };
}

function refuseControl(): DataError {
  return markReason(new DataError('INVALID_QUERY'), 'transaction-control');
}

// Does:  Holds what one transaction data opened has seen; made per transaction, so nothing reaches the next one.
interface Block {
  savepoint: boolean;
}

// Why: AND CHAIN ends a block and opens another, so only its tag shows it; ROLLBACK is also a savepoint's tag.
function endsBlock(command: string, block: Block): boolean {
  return command === 'COMMIT' || (command === 'ROLLBACK' && !block.savepoint);
}

// Does:  Runs one statement outside a transaction or in the given block, refusing transaction control, and reads rows.
async function execute(
  work: Work,
  session: Session,
  signal: AbortSignal,
  prepared: Prepared,
  block: Block | null,
): Promise<readonly Row[]> {
  const result = await cycle(work, session, signal, () => session.run(prepared.text, prepared.parameters, signal));
  const expected = block === null ? 'idle' : 'transaction';
  if (session.status !== expected || (block !== null && endsBlock(result.command, block))) {
    throw refuseControl();
  }
  if (block !== null && result.command === 'SAVEPOINT') {
    block.savepoint = true;
  }
  try {
    return readRows(result, prepared.schema);
  } catch (error) {
    if (error instanceof DataError) {
      count('data.rows.refused', error.code);
    }
    throw error;
  }
}

async function acquire(work: Work): Promise<Lease<Session>> {
  try {
    return await work.internals.pool.acquire(work.owner.signal);
  } catch (error) {
    if (error instanceof DataError) {
      record(work, error, false);
    }
    throw error;
  }
}

function runSignal(work: Work, lease: Lease<Session>): AbortSignal {
  return AbortSignal.any([work.owner.signal, lease.signal]);
}

type Runner = (query: Query, row: ObjectSchema | null) => Promise<readonly Row[]>;

function queryOf(runner: Runner): Queryable['query'] {
  function run(query: Query): Promise<readonly Row[]>;
  function run<S extends ObjectSchema>(query: Query, row: S): Promise<readonly Infer<S>[]>;
  function run(query: Query, row?: ObjectSchema): Promise<readonly unknown[]> {
    return runner(query, row ?? null);
  }
  return run;
}

// Does:  Gives a handle one queue, so its calls reach the session one at a time and in call order.
// Holds: A step still waiting when its signal aborts rejects CANCELLED at once and never runs; order is kept.
function createQueue(): {
  readonly push: <R>(step: () => Promise<R>, signal: AbortSignal | null) => Promise<R>;
  readonly drained: () => Promise<void>;
} {
  let tail: Promise<void> = Promise.resolve();
  return {
    push<R>(step: () => Promise<R>, signal: AbortSignal | null): Promise<R> {
      const { promise, resolve, reject } = Promise.withResolvers<R>();
      let skipped = false;
      const onAbort = (): void => {
        skipped = true;
        reject(new DataError('CANCELLED'));
      };
      if (signal?.aborted === true) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
      tail = tail.then(async () => {
        signal?.removeEventListener('abort', onAbort);
        if (skipped) {
          return;
        }
        try {
          resolve(await step());
        } catch (error) {
          reject(error);
        }
      });
      return promise;
    },
    drained: () => tail,
  };
}

async function runQuery(work: Work, query: Query, row: ObjectSchema | null): Promise<readonly Row[]> {
  const prepared = prepare(work, query, row);
  const lease = await acquire(work);
  const { session } = lease;
  let rows: readonly Row[];
  try {
    rows = await execute(work, session, runSignal(work, lease), prepared, null);
  } catch (error) {
    const after = verdictAfter(work, session, error);
    const verdict = after === 'return' ? settledVerdict(session) : after;
    releaseLease(lease, verdict);
    if (error instanceof DataError) {
      record(work, error, verdict === 'destroy');
    }
    throw error;
  }
  lease.release(settledVerdict(session));
  return rows;
}

type Phase = 'running' | 'failed' | 'aborted' | 'ended-by-text' | 'finishing';

// Does:  Runs a callback in a transaction on a held session and gives the session's verdict once, before it settles.
// Holds: No commit follows a failed statement; a statement not started when the callback is seen settled fails it.
async function transact<T>(
  work: Work,
  session: Session,
  signal: AbortSignal,
  cut: AbortSignal,
  run: (tx: Queryable) => Promise<T>,
  options: TransactionOptions,
  dispose: (verdict: Verdict) => void,
): Promise<T> {
  let disposed = false;
  const settle = (verdict: Verdict): void => {
    if (!disposed) {
      disposed = true;
      dispose(verdict);
    }
  };
  const fail = (failure: unknown, verdict: Verdict): never => {
    settle(verdict);
    if (failure instanceof DataError) {
      record(work, failure, verdict === 'destroy');
    }
    throw failure;
  };

  try {
    await cycle(work, session, signal, () => session.begin(options, signal));
  } catch (error) {
    return fail(error, verdictAfter(work, session, error));
  }

  let phase: Phase = 'running';
  let handleOpen = true;
  const queue = createQueue();
  const block: Block = { savepoint: false };

  // Why: The rollback is sent under the lease's signal, since the owner's has already aborted.
  const rollback = async (): Promise<boolean> => {
    if (session.status === 'closed' || isCancelling(session)) {
      return false;
    }
    try {
      await session.rollback(cut);
    } catch (error) {
      if (!(error instanceof DataError)) {
        throw error;
      }
      return false;
    }
    return true;
  };

  let aborting: Promise<boolean> | null = null;
  const onAbort = (): void => {
    if (phase !== 'running' && phase !== 'failed') {
      return;
    }
    phase = 'aborted';
    // Why: Once the callback settles, the queued finishing step rolls back itself; a rollback behind it would wait.
    if (handleOpen) {
      aborting = queue.push(rollback, null);
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }

  const statement = async (query: Query, row: ObjectSchema | null): Promise<readonly Row[]> => {
    if (phase === 'aborted' || signal.aborted) {
      throw new DataError('CANCELLED');
    }
    // Why: A statement not started before the callback settled runs unseen, so it is refused and the work undone.
    if (!handleOpen) {
      if (phase === 'running') {
        phase = 'failed';
      }
      throw new DataError('HANDLE_CLOSED');
    }
    if (phase !== 'running') {
      throw new DataError('TRANSACTION_FAILED');
    }
    try {
      return await execute(work, session, signal, prepare(work, query, row), block);
    } catch (error) {
      if (phase === 'running') {
        phase = isControl(error) ? 'ended-by-text' : 'failed';
      }
      if (error instanceof DataError) {
        record(work, error, session.status === 'closed' || (isControl(error) && controlVerdict(work) === 'destroy'));
      }
      throw error;
    }
  };

  const tx: Queryable = Object.freeze({
    query: queryOf((query, row) =>
      handleOpen ? queue.push(() => statement(query, row), signal) : Promise.reject(new DataError('HANDLE_CLOSED')),
    ),
  });

  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await Promise.try(run, tx) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  handleOpen = false;

  return queue.push(async (): Promise<T> => {
    signal.removeEventListener('abort', onAbort);
    try {
      if (phase === 'ended-by-text') {
        return fail(new DataError('COMMIT_UNKNOWN'), controlVerdict(work));
      }
      if (phase === 'aborted' || (outcome.ok && signal.aborted)) {
        const rolledBack = await (aborting ?? rollback());
        settle(rolledBack ? 'return' : 'destroy');
        throw outcome.ok ? new DataError('CANCELLED') : outcome.error;
      }
      if (!outcome.ok || phase === 'failed') {
        settle((await rollback()) ? 'return' : 'destroy');
        throw outcome.ok ? new DataError('TRANSACTION_FAILED') : outcome.error;
      }
      phase = 'finishing';
      return await commit(outcome.value);
    } finally {
      settle('destroy');
    }
  }, null);

  async function commit(value: T): Promise<T> {
    let ended: 'committed' | 'rolled-back';
    try {
      ended = await cycle(work, session, signal, () => session.commit(signal));
    } catch (error) {
      if (!(error instanceof DataError)) {
        return fail(error, 'destroy');
      }
      // Why: The commit was sent, so a session lost or cancelled under it may have committed.
      if (session.status === 'closed' || error.code === 'CANCELLED') {
        countClosed(error);
        return fail(new DataError('COMMIT_UNKNOWN', { cause: error }), 'destroy');
      }
      // Why: SQLite keeps the transaction open when COMMIT itself is refused, so it is rolled back before release.
      const verdict = session.status === 'transaction' && !(await rollback()) ? 'destroy' : 'return';
      return fail(error, verdict);
    }
    settle('return');
    if (ended === 'rolled-back') {
      throw new DataError('TRANSACTION_FAILED');
    }
    return value;
  }
}

// Does:  Binds a database to an owner, whose signal each call follows and whose logger takes its records.
export function bindDatabase(internals: DatabaseInternals, owner: Owner): BoundDatabase {
  const work: Work = { internals, owner };
  return Object.freeze({
    query: queryOf((query, row) => runQuery(work, query, row)),
    async transaction<T>(run: (tx: Queryable) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
      const lease = await acquire(work);
      return transact(work, lease.session, runSignal(work, lease), lease.signal, run, options, (verdict) =>
        releaseLease(lease, verdict),
      );
    },
    async reserve<T>(run: (connection: ReservedConnection) => Promise<T>): Promise<T> {
      const lease = await acquire(work);
      return lendReserved(work, lease, run);
    },
  });
}

// Does:  Lends a leased session to a callback and releases it with restore once the callback and its calls settle.
async function lendReserved<T>(
  work: Work,
  lease: Lease<Session>,
  run: (connection: ReservedConnection) => Promise<T>,
): Promise<T> {
  const { session } = lease;
  const signal = runSignal(work, lease);
  const queue = createQueue();
  let handleOpen = true;
  const guarded = <R>(step: () => Promise<R>): Promise<R> =>
    handleOpen ? queue.push(step, signal) : Promise.reject(new DataError('HANDLE_CLOSED'));
  const failed = (error: unknown): never => {
    const verdict = verdictAfter(work, session, error);
    applyHeld(session, verdict);
    if (error instanceof DataError) {
      record(work, error, verdict === 'destroy' || session.status === 'closed');
    }
    throw error;
  };

  const script = async (text: string): Promise<void> => {
    try {
      await cycle(work, session, signal, () => session.script(text, signal));
    } catch (error) {
      return failed(error);
    }
    if (session.status !== 'idle') {
      failed(refuseControl());
    }
  };

  const connection: ReservedConnection = Object.freeze({
    query: queryOf((query, row) =>
      guarded(async () => {
        try {
          return await execute(work, session, signal, prepare(work, query, row), null);
        } catch (error) {
          return failed(error);
        }
      }),
    ),
    transaction: <R>(inner: (tx: Queryable) => Promise<R>, options: TransactionOptions = {}): Promise<R> =>
      guarded(() =>
        transact(work, session, signal, lease.signal, inner, options, (verdict) => applyHeld(session, verdict)),
      ),
    script: (text: string): Promise<void> => guarded(() => script(text)),
  });

  try {
    return await Promise.try(run, connection);
  } finally {
    handleOpen = false;
    await queue.drained();
    releaseLease(lease, 'restore');
  }
}
