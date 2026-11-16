// Does:  Runs one store unit on a client of the application's pool: a bounded wait, auth's own transaction, a deadline.
// Holds: A client returns to the pool only after a confirmed COMMIT, ROLLBACK or clean read; any other end destroys it.

import { count, end, limit, start } from '#diag';
import { StoreFailure } from '../store/store.ts';
import { RecordError } from './rows.ts';
import type { PgClient, PgPool } from './types.ts';

// Why: Every operation ends at 5,000 ms, the pool wait included.
const DEADLINE_MS = 5_000;
const MAX_WAITERS = 1_000;
// Why: Transaction-local settings end with the transaction, so a released client carries none of them.
const BEGIN =
  'BEGIN ISOLATION LEVEL READ COMMITTED; ' +
  "SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '4s'; " +
  "SET LOCAL idle_in_transaction_session_timeout = '5s'";
const SQLSTATE = /^[0-9A-Z]{5}$/;

interface QueryResult {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

export interface Tx {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
}

export interface Runner {
  write<T extends { readonly kind: string }>(
    operation: string,
    signal: AbortSignal | undefined,
    body: (tx: Tx) => Promise<T>,
  ): Promise<T>;
  read<T>(
    operation: string,
    signal: AbortSignal | undefined,
    text: string,
    values: readonly unknown[],
    parse: (rows: readonly unknown[]) => T,
  ): Promise<T>;
  refuseWaiters(): void;
}

interface Waiter {
  granted: boolean;
  wake: (outcome: 'granted' | 'closed') => void;
}

type Stop = 'deadline' | 'aborted' | 'closed';
type Step = <V>(promise: Promise<V>) => Promise<V>;

class Stopped extends Error {
  readonly stop: Stop;
  constructor(stop: Stop) {
    super(stop);
    this.stop = stop;
  }
}

interface Failure {
  readonly reason: 'unavailable' | 'fault' | 'record';
  readonly code: string | null;
  readonly connectionLost: boolean;
}

function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('severity' in error) || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' && SQLSTATE.test(error.code) ? error.code : null;
}

// Why: A FATAL or PANIC message, a class 08 code or an error the server did not send all mean the session is gone.
function classify(error: unknown): Failure {
  const code = sqlState(error);
  const severity =
    typeof error === 'object' && error !== null && 'severity' in error && typeof error.severity === 'string'
      ? error.severity
      : null;
  if (code === null || severity === 'FATAL' || severity === 'PANIC' || code.startsWith('08')) {
    return { reason: 'unavailable', code, connectionLost: true };
  }
  // Why: lock_not_available and query_canceled are the lock and statement timeouts, which mean the store is busy.
  if (code === '55P03' || code === '57014') {
    return { reason: 'unavailable', code, connectionLost: false };
  }
  return { reason: 'fault', code, connectionLost: false };
}

// Why: The client was destroyed and the outcome reported; the rejection that follows carries nothing new.
function abandon(promise: Promise<unknown>): void {
  promise.then(undefined, () => undefined);
}

export function createRunner(pool: PgPool, maxClients: number, releaseFault: (operation: string) => void): Runner {
  let held = 0;
  const waiters: Waiter[] = [];
  const listeners = new WeakMap<PgClient, (error: Error) => void>();
  const broken = new WeakSet<PgClient>();
  let closed = false;
  // Why: Each waiting unit's own refusal, removed when its wait ends, so close reaches it and nothing outlives it.
  const refusals = new Set<() => void>();

  function freeSlot(): void {
    const next = waiters.shift();
    if (next === undefined) {
      held -= 1;
      return;
    }
    next.granted = true;
    next.wake('granted');
  }

  // Holds: A release that throws changes no answer; the throw is reported once and the caller goes on.
  function release(operation: string, client: PgClient, destroy: boolean): void {
    try {
      client.release(destroy);
    } catch {
      // Why: Only an application listener on the Pool's release event throws here, after the unit's answer is settled.
      releaseFault(operation);
    }
  }

  // Does:  Waits for one of the store's client slots, inside the deadline, while the caller has not aborted.
  async function slot(operation: string, stop: Promise<Stop>): Promise<void> {
    if (held < maxClients) {
      held += 1;
      return;
    }
    if (waiters.length >= MAX_WAITERS) {
      throw new StoreFailure(operation, 'unavailable', 'no', null);
    }
    let wake: Waiter['wake'] = () => undefined;
    const woken = new Promise<'granted' | 'closed'>((resolve) => {
      wake = resolve;
    });
    const waiter: Waiter = { granted: false, wake };
    waiters.push(waiter);
    limit('auth.store.waiting', waiters.length, MAX_WAITERS);
    const outcome = await Promise.race([woken, stop]);
    if (outcome === 'granted') {
      return;
    }
    if (waiter.granted) {
      freeSlot();
    } else {
      const index = waiters.indexOf(waiter);
      // Why: refuseWaiters empties the queue before the stop is seen, and splice(-1, 1) would drop another caller.
      if (index !== -1) {
        waiters.splice(index, 1);
      }
    }
    throw new Stopped(outcome);
  }

  // Does:  Checks out a client inside the deadline; a client that arrives after its caller gave up is released unused.
  // Holds: Its slot is freed exactly once on every end but the client it returns, which finish frees.
  async function acquire(operation: string, stop: Promise<Stop>): Promise<PgClient> {
    await slot(operation, stop);
    let connecting: Promise<PgClient>;
    let outcome: PgClient | Stop;
    try {
      connecting = pool.connect();
      outcome = await Promise.race([connecting, stop]);
    } catch (error) {
      // Why: The stop never rejects, so this is a failed connect, which checked out no client.
      freeSlot();
      throw error;
    }
    if (typeof outcome !== 'string') {
      // Why: The pool drops its listener at checkout, and a lost connection emits error even after the query rejected.
      const listener = (): void => {
        broken.add(outcome);
      };
      outcome.on('error', listener);
      listeners.set(outcome, listener);
      return outcome;
    }
    connecting.then(
      (late) => {
        release(operation, late, false);
        freeSlot();
      },
      () => freeSlot(),
    );
    throw new Stopped(outcome);
  }

  function finish(operation: string, client: PgClient, destroy: boolean): void {
    release(operation, client, destroy || broken.has(client));
    const listener = listeners.get(client);
    // Why: release puts the pool's own listener back synchronously, so removing this one leaves no gap.
    if (listener !== undefined) {
      client.removeListener('error', listener);
    }
    freeSlot();
  }

  // Does:  Runs a unit under one deadline and turns every way it can end into its result or one StoreFailure.
  async function unit<T>(
    operation: string,
    signal: AbortSignal | undefined,
    work: (client: PgClient, step: Step) => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted === true) {
      throw new StoreFailure(operation, 'aborted', 'no', null);
    }
    const token = start('auth.store.op', operation);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Stop>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), DEADLINE_MS);
    });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<Stop>((resolve) => {
      onAbort = () => resolve('aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    let refuse: () => void = () => undefined;
    const refused = new Promise<Stop>((resolve) => {
      refuse = () => resolve('closed');
    });
    if (closed) {
      refuse();
    } else {
      refusals.add(refuse);
    }
    try {
      let client: PgClient;
      try {
        // Why: A unit that has no client yet is waiting, and close refuses every waiting unit at once.
        client = await acquire(operation, Promise.race([deadline, aborted, refused]));
      } catch (error) {
        if (error instanceof Stopped) {
          if (error.stop === 'deadline') {
            count('auth.store.deadline', operation);
          }
          throw new StoreFailure(operation, error.stop === 'aborted' ? 'aborted' : 'unavailable', 'no', null);
        }
        if (error instanceof StoreFailure) {
          throw error;
        }
        throw new StoreFailure(operation, 'unavailable', 'no', classify(error).code);
      } finally {
        refusals.delete(refuse);
        if (onAbort !== undefined) {
          signal?.removeEventListener('abort', onAbort);
        }
      }
      const step: Step = async (promise) => {
        const outcome = await Promise.race([promise, deadline]);
        if (outcome === 'deadline') {
          abandon(promise);
          throw new Stopped('deadline');
        }
        return promise;
      };
      return await work(client, step);
    } finally {
      clearTimeout(timer);
      end(token);
    }
  }

  // Does:  Ends a failed write unit: rolls back what can be rolled back and names whether the change may stand.
  async function failWrite(
    operation: string,
    client: PgClient,
    step: Step,
    error: unknown,
    phase: 'open' | 'rollback' | 'commit',
  ): Promise<never> {
    // Why: Only a COMMIT that was sent and never answered can have applied; before it the server rolls back on its own.
    const applied = phase === 'commit' ? 'unknown' : 'no';
    if (error instanceof Stopped) {
      count('auth.store.deadline', operation);
      finish(operation, client, true);
      throw new StoreFailure(operation, 'unavailable', applied, null);
    }
    const failure: Failure =
      error instanceof RecordError ? { reason: 'record', code: null, connectionLost: false } : classify(error);
    if (failure.connectionLost || phase !== 'open') {
      finish(operation, client, true);
      throw new StoreFailure(operation, failure.reason, failure.connectionLost ? applied : 'no', failure.code);
    }
    let rolledBack = false;
    try {
      await step(client.query('ROLLBACK'));
      rolledBack = true;
    } catch (rollbackError) {
      if (rollbackError instanceof Stopped) {
        count('auth.store.deadline', operation);
      }
    }
    finish(operation, client, !rolledBack);
    throw new StoreFailure(operation, failure.reason, 'no', failure.code);
  }

  return {
    write(operation, signal, body) {
      return unit(operation, signal, async (client, step) => {
        let phase: 'open' | 'rollback' | 'commit' = 'open';
        const tx: Tx = { query: (text, values) => step(client.query(text, values)) };
        try {
          await step(client.query(BEGIN));
          const result = await body(tx);
          // Why: A lost answer changed nothing, so it ends with a rollback and no commit can leave its outcome unknown.
          phase = result.kind === 'lost' ? 'rollback' : 'commit';
          await step(client.query(phase === 'commit' ? 'COMMIT' : 'ROLLBACK'));
          finish(operation, client, false);
          return result;
        } catch (error) {
          return failWrite(operation, client, step, error, phase);
        }
      });
    },
    read(operation, signal, text, values, parse) {
      return unit(operation, signal, async (client, step) => {
        let rows: readonly unknown[];
        try {
          rows = (await step(client.query(text, values))).rows;
          finish(operation, client, false);
        } catch (error) {
          if (error instanceof Stopped) {
            count('auth.store.deadline', operation);
            finish(operation, client, true);
            throw new StoreFailure(operation, 'unavailable', 'no', null);
          }
          const failure = classify(error);
          finish(operation, client, failure.connectionLost);
          throw new StoreFailure(operation, failure.reason, 'no', failure.code);
        }
        try {
          return parse(rows);
        } catch (error) {
          if (!(error instanceof RecordError)) {
            throw error;
          }
          throw new StoreFailure(operation, 'record', 'no', null);
        }
      });
    },
    refuseWaiters() {
      closed = true;
      for (const refuse of refusals) {
        refuse();
      }
      refusals.clear();
      for (const waiter of waiters.splice(0)) {
        waiter.wake('closed');
      }
    },
  };
}
