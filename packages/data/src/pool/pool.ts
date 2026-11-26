// Does:  Creates the pool that lends an engine's sessions to callers first come first served, and closes them in order.
// Holds: Sessions open or opening never pass maxSessions: a slot is freed only when a session's closed has resolved.

import { end as endSpan, limit, start as startSpan } from '#diag';
import { DataError } from '../data-error/data-error.ts';
import type { ResolvedBounds } from '../options/bounds.ts';
import type { Engine, Session } from '../session/types.ts';
import type { Lease, Pool } from './types.ts';

type Verdict = 'return' | 'restore' | 'destroy';

interface Entry<S extends Session> {
  readonly session: S;
  readonly expiresAt: number;
}

interface Waiter<S extends Session> {
  readonly resolve: (lease: Lease<S>) => void;
  readonly reject: (failure: DataError) => void;
  readonly signal: AbortSignal;
  readonly timer: NodeJS.Timeout;
  readonly onAbort: () => void;
  readonly token: number;
}

// Why: A lifetime is stretched by 0 to 20 % per session so that sessions opened together do not all end together.
const JITTER = 0.2;
const LEASE_SHARE = 0.4;
const CANCEL_SHARE = 0.1;

function asFailure(error: unknown): DataError {
  return error instanceof DataError ? error : new DataError('CONNECT_FAILED', { cause: error });
}

export function createPool<S extends Session>(
  engine: Engine<S>,
  bounds: ResolvedBounds,
  orphan: (failure: DataError) => void,
): Pool<S> {
  let state: 'opening' | 'open' | 'closing' = 'opening';
  let connecting = 0;
  let closing: Promise<void> | null = null;
  const live = new Set<Entry<S>>();
  const idle: Entry<S>[] = [];
  const held = new Map<Lease<S>, Entry<S>>();
  const waiters = new Set<Waiter<S>>();
  // Why: Every lease shares one signal, aborted once when close stops waiting for holders.
  const cut = new AbortController();
  // Why: One controller per connect in flight, oldest first, so a connect no waiter needs can be stopped alone.
  const connects: AbortController[] = [];
  let stopped = false;
  let opened: AbortSignal | null = null;
  const changed = new Set<() => void>();

  // Why: Once the open signal aborts or close begins, a connect beyond the waiters is work nobody waits for.
  function trim(): void {
    while (stopped && connects.length > waiters.size) {
      connects.pop()?.abort();
    }
  }

  function stop(): void {
    stopped = true;
    opened?.removeEventListener('abort', stop);
    trim();
  }

  function notify(): void {
    for (const check of changed) {
      check();
    }
  }

  function expiresAt(): number {
    return engine.lifetimeMs === null
      ? Number.POSITIVE_INFINITY
      : performance.now() + engine.lifetimeMs * (1 + Math.random() * JITTER);
  }

  function track(session: S): Entry<S> {
    const entry: Entry<S> = { session, expiresAt: expiresAt() };
    live.add(entry);
    // Why: This chain is tracked by live, which close waits to empty, and closed never rejects.
    void session.closed.then(() => {
      live.delete(entry);
      const at = idle.indexOf(entry);
      if (at !== -1) {
        idle.splice(at, 1);
      }
      notify();
      fill();
    });
    return entry;
  }

  function settle(waiter: Waiter<S>): void {
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    endSpan(waiter.token);
  }

  function refuse(waiter: Waiter<S>, failure: DataError): void {
    settle(waiter);
    waiter.reject(failure);
    trim();
  }

  function oldest(): Waiter<S> | undefined {
    return waiters.values().next().value;
  }

  function lend(entry: Entry<S>): Lease<S> {
    const lease: Lease<S> = {
      session: entry.session,
      signal: cut.signal,
      release: (verdict) => release(lease, verdict),
    };
    held.set(lease, entry);
    return lease;
  }

  function serve(entry: Entry<S>): void {
    const waiter = oldest();
    if (waiter === undefined) {
      idle.push(entry);
      return;
    }
    settle(waiter);
    waiter.resolve(lend(entry));
  }

  function keeps(entry: Entry<S>, verdict: Verdict): boolean {
    const { session } = entry;
    if (verdict === 'destroy') {
      session.destroy();
      return false;
    }
    if (state !== 'open') {
      session.end();
      return false;
    }
    if (verdict === 'restore') {
      if (session.restore()) {
        return true;
      }
      session.destroy();
      return false;
    }
    if (session.reusable && performance.now() < entry.expiresAt) {
      return true;
    }
    session.end();
    return false;
  }

  function release(lease: Lease<S>, verdict: Verdict): void {
    const entry = held.get(lease);
    // Why: A lease that close already destroyed is released later by its holder; that release has nothing left to do.
    if (entry === undefined) {
      return;
    }
    held.delete(lease);
    if (keeps(entry, verdict) && live.has(entry)) {
      serve(entry);
    }
    notify();
  }

  function connect(): void {
    connecting += 1;
    limit('data.pool.open', live.size + connecting, engine.maxSessions);
    const controller = new AbortController();
    connects.push(controller);
    const done = (): void => {
      connecting -= 1;
      const at = connects.indexOf(controller);
      if (at !== -1) {
        connects.splice(at, 1);
      }
    };
    engine.open(controller.signal).then(
      (session) => {
        done();
        const entry = track(session);
        if (state === 'open') {
          serve(entry);
        } else {
          session.destroy();
        }
        notify();
      },
      (error: unknown) => {
        done();
        const waiter = oldest();
        // Why: A connect the pool stopped itself failed for that reason, which is no failure to report.
        if (controller.signal.aborted) {
          notify();
          return;
        }
        if (waiter === undefined) {
          orphan(asFailure(error));
        } else {
          refuse(waiter, asFailure(error));
        }
        notify();
        fill();
      },
    );
  }

  // Why: One connect per waiter not yet covered, so an outage costs at most one attempt per waiter and none is retried.
  function fill(): void {
    while (state === 'open' && connecting < waiters.size && live.size + connecting < engine.maxSessions) {
      connect();
    }
  }

  // Why: A queued caller with a session slot still open to it counts as running, so only the rest meet maxWaiters.
  function beyondCapacity(): number {
    return Math.max(0, waiters.size - Math.max(0, engine.maxSessions - live.size));
  }

  function enqueue(signal: AbortSignal, token: number): Promise<Lease<S>> {
    return new Promise<Lease<S>>((resolve, reject) => {
      const waiter: Waiter<S> = {
        resolve,
        reject,
        signal,
        token,
        timer: setTimeout(() => refuse(waiter, new DataError('POOL_TIMEOUT')), bounds.acquireTimeoutMs),
        onAbort: () => refuse(waiter, new DataError('CANCELLED')),
      };
      waiters.add(waiter);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      limit('data.pool.waiting', beyondCapacity(), bounds.maxWaiters);
      fill();
    });
  }

  function acquire(signal: AbortSignal): Promise<Lease<S>> {
    const token = startSpan('data.pool.acquire');
    if (state !== 'open' || signal.aborted || beyondCapacity() >= bounds.maxWaiters) {
      endSpan(token);
      const code = state !== 'open' ? 'POOL_CLOSED' : signal.aborted ? 'CANCELLED' : 'POOL_FULL';
      return Promise.reject(new DataError(code));
    }
    const entry = idle.pop();
    if (entry !== undefined) {
      endSpan(token);
      return Promise.resolve(lend(entry));
    }
    return enqueue(signal, token);
  }

  async function open(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new DataError('CANCELLED');
    }
    connecting += 1;
    limit('data.pool.open', live.size + connecting, engine.maxSessions);
    let session: S;
    try {
      session = await engine.open(signal);
    } catch (error) {
      throw asFailure(error);
    } finally {
      connecting -= 1;
      notify();
    }
    const entry = track(session);
    if (state !== 'opening') {
      session.destroy();
      throw new DataError('CANCELLED');
    }
    idle.push(entry);
    state = 'open';
    opened = signal;
    signal.addEventListener('abort', stop, { once: true });
  }

  // Does:  Resolves once ready() holds or the bound passes, whichever comes first; with no bound it waits for ready().
  function until(ready: () => boolean, boundMs: number | null): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const check = (): void => {
        if (ready()) {
          done();
        }
      };
      const done = (): void => {
        changed.delete(check);
        clearTimeout(timer);
        resolve();
      };
      if (ready()) {
        resolve();
        return;
      }
      changed.add(check);
      if (boundMs !== null) {
        timer = setTimeout(done, boundMs);
      }
    });
  }

  async function shut(closeTimeoutMs: number): Promise<void> {
    const startedAt = performance.now();
    state = 'closing';
    for (const waiter of [...waiters]) {
      refuse(waiter, new DataError('POOL_CLOSED'));
    }
    stop();
    for (const entry of idle.splice(0)) {
      entry.session.end();
    }
    await until(() => held.size === 0, closeTimeoutMs * LEASE_SHARE);
    cut.abort();
    // Why: The second bound is measured from the start of close, so a late first timer does not push it further.
    const cancelUntil = startedAt + closeTimeoutMs * (LEASE_SHARE + CANCEL_SHARE);
    await until(() => held.size === 0, Math.max(0, cancelUntil - performance.now()));
    held.clear();
    for (const entry of live) {
      entry.session.destroy();
    }
    await until(() => live.size === 0 && connecting === 0, null);
  }

  return {
    open,
    acquire,
    stats: () => ({ open: live.size, checkedOut: held.size, waiting: waiters.size }),
    close(closeTimeoutMs) {
      closing ??= shut(closeTimeoutMs);
      return closing;
    },
  };
}
