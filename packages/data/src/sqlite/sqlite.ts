// Does:  Creates a SQLite database: its options checked once, its one-session engine and pool built, no file opened.
// Holds: The factory touches no file; the file is created and opened by the plugin.

import { BootError } from '@skeld/core/boot-error';
import type { Database } from '../database/types.ts';
import { createDatabase } from '../handle/internals.ts';
import { resolveBounds } from '../options/bounds.ts';
import { createPool } from '../pool/pool.ts';
import type { Engine, Session } from '../session/types.ts';
import { openSqliteSession } from './session.ts';
import type { SqliteOptions } from './types.ts';

export type { SqliteOptions } from './types.ts';

/**
 * Creates a SQLite database on a file, created owner-only when missing, or on `':memory:'`; it opens when its plugin runs.
 * Refuses an unknown or invalid option with BootError `INVALID_OPTION`; the boot fails when the file cannot be opened.
 * @example createSqliteDatabase({ path: ':memory:' })
 */
export function createSqliteDatabase(options: SqliteOptions): Database {
  const bounds = resolveBounds(options, 'sqlite');
  const { path } = options;
  if (typeof path !== 'string' || path === '') {
    throw new BootError('INVALID_OPTION', "Invalid option path: must be a file path or ':memory:'", null, null);
  }
  return createDatabase((booted, orphan) => {
    const engine: Engine<Session> & { readonly name: 'sqlite' } = Object.freeze({
      name: 'sqlite',
      style: 'question',
      maxSessions: bounds.maxConnections,
      lifetimeMs: null,
      open: (signal: AbortSignal) => openSqliteSession(path, bounds, signal),
    });
    return Object.freeze({
      engine,
      pool: createPool(engine, bounds, orphan),
      get events() {
        return booted.events;
      },
    });
  }, false);
}
