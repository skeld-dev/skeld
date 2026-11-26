// Does:  Creates a PostgreSQL database: its options parsed once, its engine and pool built, nothing connected.
// Holds: The factory opens no socket; the first connection is opened by the plugin, under the scope's signal.

import type { Database } from '../database/types.ts';
import { createDatabase } from '../handle/internals.ts';
import { resolveBounds } from '../options/bounds.ts';
import { createPool } from '../pool/pool.ts';
import type { Engine } from '../session/types.ts';
import { openPostgresConnection } from './connection.ts';
import type { PostgresConnection } from './connection-types.ts';
import { parsePostgresTarget } from './target.ts';
import type { PostgresOptions } from './types.ts';

export type { PostgresOptions } from './types.ts';

/**
 * Creates a PostgreSQL database; it connects when its plugin runs, over verified TLS unless `insecure` says otherwise.
 * Refuses an unknown or invalid option with BootError `INVALID_OPTION`; the boot fails when the first connect does.
 * @example createPostgresDatabase({ url: new Secret('postgres://app@db.internal/app') })
 */
export function createPostgresDatabase(options: PostgresOptions): Database {
  const target = parsePostgresTarget(options);
  const bounds = resolveBounds(options, 'postgres');
  return createDatabase((booted, orphan) => {
    const engine: Engine<PostgresConnection> & { readonly name: 'postgres' } = Object.freeze({
      name: 'postgres',
      style: 'dollar',
      maxSessions: bounds.maxConnections,
      lifetimeMs: bounds.maxLifetimeMs,
      open: (signal: AbortSignal) => openPostgresConnection(target, signal),
    });
    return Object.freeze({
      engine,
      pool: createPool(engine, bounds, orphan),
      get events() {
        return booted.events;
      },
    });
  }, options.insecure !== undefined);
}
