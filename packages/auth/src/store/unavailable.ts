// Does:  Answers a store rejection a caller received as Unavailable, after writing its one auth.store.failed.
// Holds: An unknown outcome is answered unknown, an aborted unit writes no record, and anything else is rethrown.

import type { Logger } from '@skeld/core/log';
import type { AuthEvents } from '../server/internal-types.ts';
import { StoreFailure } from './store.ts';
import type { Unavailable } from './types.ts';

const NOT_APPLIED: Unavailable = Object.freeze({ kind: 'unavailable', outcome: 'not_applied' });
const UNKNOWN: Unavailable = Object.freeze({ kind: 'unavailable', outcome: 'unknown' });

export function storeUnavailable(events: AuthEvents, log: Logger, error: unknown): Unavailable {
  if (!(error instanceof StoreFailure)) {
    throw error;
  }
  if (error.applied === 'unknown' || error.reason !== 'aborted') {
    events.storeFailed(log, {
      'auth.operation': error.operation,
      'auth.cause': error.applied === 'unknown' ? 'unknown' : error.reason,
      'auth.code': error.code ?? undefined,
    });
  }
  return error.applied === 'unknown' ? UNKNOWN : NOT_APPLIED;
}
