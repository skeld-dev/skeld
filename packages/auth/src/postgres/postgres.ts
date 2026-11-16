// Does:  Exports @skeld/auth/postgres: createPostgresStore, the auth store over the application's pg Pool.
// Holds: The store never ends the Pool and adds or removes no Pool listener but its own error listener.

import { BootError } from '@skeld/core/boot-error';
import { StoreFailure } from '../store/store.ts';
import type { AuthStore, StoreEvent, StoreOperations } from '../store/types.ts';
import { createRunner } from './runner.ts';
import type { PostgresStoreOptions } from './types.ts';
import {
  apiKeyIssue,
  apiKeyList,
  apiKeyRead,
  apiKeyRevoke,
  attachVersion,
  attemptConsume,
  attemptCreate,
  expiredRemove,
  install,
  limitCharge,
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

export type { PgClient, PgPool, PostgresStoreOptions } from './types.ts';

const OPTION_KEYS: ReadonlySet<string> = new Set(['pool', 'maxClients', 'cleanupIntervalSeconds']);
const MAX_INTERVAL_SECONDS = 3_600;
const DEFAULT_INTERVAL_SECONDS = 60;
const CLEANUP_LIMIT = 1_000;
// Why: A pass that removed its whole bound leaves more expired rows, so the next runs after one second.
const BACKLOG_DELAY_MS = 1_000;

interface Checked {
  readonly maxClients: number;
  readonly intervalMs: number;
}

function invalidOption(name: string, rule: string): BootError {
  return new BootError('INVALID_OPTION', `Invalid postgres store option ${name}: ${rule}`, null, null);
}

function isFunction(value: unknown): boolean {
  return typeof value === 'function';
}

function checkOptions(options: PostgresStoreOptions): Checked {
  if (typeof options !== 'object' || options === null) {
    throw invalidOption('options', 'must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !OPTION_KEYS.has(key)) {
      throw invalidOption(String(key), 'is not a key of PostgresStoreOptions');
    }
  }
  const { pool } = options;
  if (
    typeof pool !== 'object' ||
    pool === null ||
    !isFunction(pool.connect) ||
    !isFunction(pool.on) ||
    !isFunction(pool.removeListener)
  ) {
    throw invalidOption('pool', 'must be a pg Pool');
  }
  const max = typeof pool.options === 'object' && pool.options !== null ? pool.options.max : undefined;
  if (!Number.isSafeInteger(max) || max === undefined || max < 1) {
    throw invalidOption('pool', 'options.max must be a positive integer');
  }
  const maxClients = options.maxClients ?? Math.max(1, Math.floor(max / 2));
  if (!Number.isSafeInteger(maxClients) || maxClients < 1 || maxClients > max) {
    throw invalidOption('maxClients', 'must be an integer from 1 to the pool max');
  }
  const seconds = options.cleanupIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_INTERVAL_SECONDS) {
    throw invalidOption('cleanupIntervalSeconds', `must be an integer from 1 to ${MAX_INTERVAL_SECONDS}`);
  }
  return { maxClients, intervalMs: seconds * 1_000 };
}

function eventOf(operation: string, failure: StoreFailure): StoreEvent {
  const cause =
    failure.reason === 'fault' || failure.reason === 'record'
      ? failure.reason
      : failure.applied === 'unknown'
        ? 'unknown'
        : 'unavailable';
  return { operation, cause, code: failure.code };
}

/**
 * Creates the auth store over the application's pg Pool; it queries nothing until `install` or `attach`.
 * Throws BootError `INVALID_OPTION` naming a bad option; the store never ends the Pool.
 * @see examples/auth/postgres-store.ts
 */
export function createPostgresStore(options: PostgresStoreOptions): AuthStore {
  const { maxClients, intervalMs } = checkOptions(options);
  const { pool } = options;
  let state: 'idle' | 'attaching' | 'attached' | 'closed' = 'idle';
  let report: ((event: StoreEvent) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = 0;
  let drained: (() => void) | null = null;
  let closing: Promise<void> | null = null;

  const run = createRunner(pool, maxClients, (operation) => report?.({ operation, cause: 'fault', code: null }));
  const onPoolError = (error: Error): void => {
    const code =
      'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
    report?.({ operation: 'pool', cause: 'unavailable', code });
  };

  // Does:  Counts a unit as in flight until it settles, so close can wait for it.
  async function track<T>(work: () => Promise<T>): Promise<T> {
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      if (active === 0) {
        drained?.();
      }
    }
  }

  function schedule(delayMs: number): void {
    timer = setTimeout(pass, delayMs);
    timer.unref();
  }

  async function pass(): Promise<void> {
    timer = null;
    if (state !== 'attached') {
      return;
    }
    let next = intervalMs;
    try {
      const { removed } = await track(() => expiredRemove(run, { limit: CLEANUP_LIMIT }));
      if (removed === CLEANUP_LIMIT) {
        next = BACKLOG_DELAY_MS;
      }
    } catch (error) {
      if (!(error instanceof StoreFailure)) {
        throw error;
      }
      report?.(eventOf('expiredRemove', error));
    }
    if (state === 'attached') {
      schedule(next);
    }
  }

  const closedNow = (): boolean => state === 'closed';

  function guard<T>(name: keyof StoreOperations, call: () => Promise<T>): Promise<T> {
    if (state !== 'attached') {
      return Promise.reject(new StoreFailure(name, 'unavailable', 'no', null));
    }
    return track(call);
  }

  const ops = Object.freeze<StoreOperations>({
    subjectEnsure: (input, signal) => guard('subjectEnsure', () => subjectEnsure(run, input, signal)),
    subjectRead: (input, signal) => guard('subjectRead', () => subjectRead(run, input, signal)),
    subjectDisable: (input, signal) => guard('subjectDisable', () => subjectDisable(run, input, signal)),
    subjectEnable: (input, signal) => guard('subjectEnable', () => subjectEnable(run, input, signal)),
    subjectInvalidate: (input, signal) => guard('subjectInvalidate', () => subjectInvalidate(run, input, signal)),
    sessionIssue: (input, signal) => guard('sessionIssue', () => sessionIssue(run, input, signal)),
    sessionRead: (input, signal) => guard('sessionRead', () => sessionRead(run, input, signal)),
    sessionRenew: (input, signal) => guard('sessionRenew', () => sessionRenew(run, input, signal)),
    sessionRotate: (input, signal) => guard('sessionRotate', () => sessionRotate(run, input, signal)),
    sessionRevoke: (input, signal) => guard('sessionRevoke', () => sessionRevoke(run, input, signal)),
    apiKeyIssue: (input, signal) => guard('apiKeyIssue', () => apiKeyIssue(run, input, signal)),
    apiKeyRead: (input, signal) => guard('apiKeyRead', () => apiKeyRead(run, input, signal)),
    apiKeyList: (input, signal) => guard('apiKeyList', () => apiKeyList(run, input, signal)),
    apiKeyRevoke: (input, signal) => guard('apiKeyRevoke', () => apiKeyRevoke(run, input, signal)),
    limitCharge: (input, signal) => guard('limitCharge', () => limitCharge(run, input, signal)),
    attemptCreate: (input, signal) => guard('attemptCreate', () => attemptCreate(run, input, signal)),
    attemptConsume: (input, signal) => guard('attemptConsume', () => attemptConsume(run, input, signal)),
    expiredRemove: (input, signal) => guard('expiredRemove', () => expiredRemove(run, input, signal)),
  });

  return Object.freeze<AuthStore>({
    ops,
    install() {
      if (state === 'closed') {
        return Promise.reject(new StoreFailure('install', 'unavailable', 'no', null));
      }
      return track(() => install(run));
    },
    async attach(config) {
      if (state === 'closed') {
        throw new StoreFailure('attach', 'unavailable', 'no', null);
      }
      if (state !== 'idle') {
        return Object.freeze({ kind: 'in_use' });
      }
      state = 'attaching';
      let found: Awaited<ReturnType<typeof attachVersion>>;
      try {
        found = await track(() => attachVersion(run));
      } finally {
        if (state === 'attaching') {
          state = 'idle';
        }
      }
      // Why: close may run while the version read awaits, and a closed store attaches nothing.
      if (closedNow()) {
        throw new StoreFailure('attach', 'unavailable', 'no', null);
      }
      if (found.kind !== 'attached') {
        return found;
      }
      state = 'attached';
      report = config.onFailure;
      pool.on('error', onPoolError);
      // Why: A first pass drawn between half and the whole interval keeps instances that start together out of step.
      schedule(Math.floor(intervalMs / 2 + Math.random() * (intervalMs / 2)));
      return found;
    },
    close() {
      if (closing !== null) {
        return closing;
      }
      const listening = state === 'attached';
      state = 'closed';
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      run.refuseWaiters();
      const settled =
        active === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              drained = resolve;
            });
      closing = settled.then(() => {
        if (listening) {
          pool.removeListener('error', onPoolError);
        }
      });
      return closing;
    },
  });
}
