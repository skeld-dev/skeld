// Does:  Publishes limitRoutes, the one call that adds the limiter to a scope, and installLimitTable.
// Holds: A declaration is checked whole before anything is registered on the scope.

import { DataError } from '../data-error/data-error.ts';
import type { Database, Owner } from '../database/types.ts';
import { count } from '#diag';
import { createRefusedCache } from './cache.ts';
import { type LimitEvents, limitHook } from './hook.ts';
import { type CheckedLimits, checkLimits, routeKey } from './rules.ts';
import { BATCH, cleanupPass, INSTALL } from './store.ts';
import type { BootScope, LimitOptions, LimitScope } from './types.ts';

export type { LimitOptions, LimitRule, LimitScope } from './types.ts';

const BOOT_FAILED =
  "Limit table could not be read: call installLimitTable once, and register the database's plugin before limitRoutes";
const PASS_TIMEOUT_MS = 5_000;
const DRAIN_DELAY_MS = 100;
const IDLE_DELAY_MS = 60_000;

async function pass(database: Database, scope: BootScope): Promise<number> {
  const owner: Owner = {
    signal: AbortSignal.any([scope.signal, AbortSignal.timeout(PASS_TIMEOUT_MS)]),
    log: scope.log,
  };
  const removed = await cleanupPass(database, owner);
  for (let row = 0; row < removed; row++) {
    count('data.limit.cleanup_rows', 'removed');
  }
  return removed;
}

// Does:  Runs later passes, 100 ms after a full batch and 60 s after any other or a failed one, until the scope aborts.
function scheduleCleanup(database: Database, scope: BootScope, removed: number): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = (delay: number): void => {
    if (!scope.signal.aborted) {
      timer = setTimeout(run, delay);
    }
  };
  const run = async (): Promise<void> => {
    try {
      next((await pass(database, scope)) === BATCH[database.engine] ? DRAIN_DELAY_MS : IDLE_DELAY_MS);
    } catch (error) {
      if (!(error instanceof DataError)) {
        throw error;
      }
      // Why: The database's own handle has written the failure's record; the next pass is the retry.
      next(IDLE_DELAY_MS);
    }
  };
  scope.signal.addEventListener('abort', () => timer !== null && clearTimeout(timer), { once: true });
  next(removed === BATCH[database.engine] ? DRAIN_DELAY_MS : IDLE_DELAY_MS);
}

// Does:  Throws for the first rule route that no route the scope's hooks reach serves.
function checkRoutes(limits: CheckedLimits, routes: readonly { method: string; path: string }[]): void {
  const served = new Set(routes.map((route) => routeKey(route.method, route.path)));
  for (const route of limits.routes) {
    if (!served.has(routeKey(route.method, route.path))) {
      throw new Error(
        `Limit rule ${route.rule} names ${route.method} ${route.path}, which no route under this scope serves`,
      );
    }
  }
}

/**
 * Limits the scope's routes per client address, counted in the database whose plugin is registered first.
 * Throws BootError `INVALID_OPTION`; `listen` rejects for a rule on an unserved route or a missing table.
 * @see examples/data/app.ts
 */
export function limitRoutes(scope: LimitScope, options: LimitOptions): void {
  const limits = checkLimits(options);
  let events: LimitEvents | null = null;
  const written = (): LimitEvents => {
    if (events === null) {
      throw new Error('The limiter ran before its boot step');
    }
    return events;
  };
  scope.addHook('onRequest', limitHook(limits, createRefusedCache(), written));
  scope.register(
    async (boot) => {
      events = {
        refused: boot.event('data.limit.refused', 'warn'),
        unavailable: boot.event('data.limit.unavailable', 'error'),
      };
      let removed: number;
      try {
        removed = await pass(limits.database, boot);
      } catch (error) {
        if (!(error instanceof DataError)) {
          throw error;
        }
        throw new Error(BOOT_FAILED, { cause: error });
      }
      scheduleCleanup(limits.database, boot, removed);
    },
    { name: 'limitRoutes' },
  );
  scope.onRoutes((routes) => checkRoutes(limits, routes));
}

/**
 * Creates the limiter's table and its index when they do not exist; run it once, at migration, never per request.
 * Rejects with `DataError`; on PostgreSQL it needs the right to create the schema `skeld_data`.
 * @see examples/data/app.ts
 */
export async function installLimitTable(database: Database, owner: Owner): Promise<void> {
  const install = INSTALL[database.engine];
  await database.for(owner).transaction(async (tx) => {
    if (install.schema !== null) {
      await tx.query(install.schema);
    }
    await tx.query(install.table);
    await tx.query(install.index);
  });
}
